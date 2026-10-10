import { Container } from '@cloudflare/containers';
import { createAccounts, userKey } from './accounts.js';
import { jsonResponse, log } from './http.js';
import { createMeter } from './metering.js';
import { RUNNER_IDLE_SECONDS, USER_HEADER } from './runner-api.js';
import { settingsOf } from './settings.js';

const RUNNER_PORT = 8787;
const METER_EVERY_SECONDS = 60;
const MIN_SECRET_LENGTH = 32;
// D1 may fail for a moment; a runner that cannot be metered this many minutes running is stopped.
const MAX_METER_FAILURES = 3;
// Whatever D1 says, no run outlives a whole month's allowance and this much more.
const RUN_SLACK_SECONDS = 120;
// Where a build may reach: crates.io for cargo, ConanCenter for conan, and GitHub, where most recipes fetch their
// sources. Inside the container every name resolves to Cloudflare's egress proxy, which answers any other one with 520;
// no other TCP or UDP leaves (probed on staging, 10 October 2026).
export const ALLOWED_HOSTS = Object.freeze([
    'crates.io', 'index.crates.io', 'static.crates.io',
    'center2.conan.io',
    'github.com', 'codeload.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'raw.githubusercontent.com',
]);

const utf8 = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

// What the runner inside expects, one per user and image and derived, so nothing is stored. Its build steps can read
// it from the runner process, but it opens nothing else: only this object reaches the container.
async function runnerToken(secret, image, userId) {
    const key = await crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, utf8.encode(`${image}:${userId}`)));
}

// A build downloads sources, crates and packages and sends nothing anywhere, so the allowed hosts take no pushes,
// form posts or uploads. git fetches with a POST to git-upload-pack.
function downloadsOnly(request) {
    const { method } = request;
    if (method === 'GET' || method === 'HEAD' || (method === 'POST' && new URL(request.url).pathname.endsWith('/git-upload-pack'))) {
        return fetch(request);
    }
    return new Response('crossbind cloud runners only download.', { status: 403 });
}

const isStep = (request) => request.method === 'POST' && new URL(request.url).pathname === '/v1/exec';

function spent(reason, settings) {
    if (reason === 'quota') {
        const minutes = Math.round(settings.buildSecondsMonthly / 60);
        return jsonResponse(429, { error: `This month's ${minutes} cloud build minutes are used up; they come back on the 1st (UTC). crossbind usage shows them.` });
    }
    const until = reason === 'today' ? 'today\'s build time; it comes back tomorrow' : 'this month\'s build time; it comes back on the 1st';
    return jsonResponse(503, { error: `crossbind cloud has used up ${until} (UTC). Build with CROSSBIND_RUNNER=DOCKER_RUN meanwhile.` });
}

// One user's runner of one toolchain image (worker/runner-api.js routes to it by the user's id): a Firecracker microVM
// of its own, up from a build's first request until a minute after its last, reaching only ALLOWED_HOSTS, and
// those only to download. The time it is up counts against the user's month (worker/metering.js). Every stop is a
// destroy: the runner is PID 1, which ignores a SIGTERM it has no handler for, and its build steps run as its user
// and could stop it from handling one.
class CloudRunner extends Container {
    defaultPort = RUNNER_PORT;

    sleepAfter = RUNNER_IDLE_SECONDS;

    enableInternet = false;

    interceptHttps = true;

    allowedHosts = [...ALLOWED_HOSTS];

    meter(settings = settingsOf(this.env)) {
        return createMeter({
            storage: this.ctx.storage,
            accounts: createAccounts(this.env.DB),
            image: this.constructor.image,
            limits: { userSeconds: settings.buildSecondsMonthly, globalSeconds: settings.globalBuildSeconds, globalDailySeconds: settings.globalDailySeconds },
        });
    }

    async fetch(request) {
        const userId = request.headers.get(USER_HEADER);
        // The Worker names this object after the user it serves; a request naming anyone else did not come from it.
        if (!userId || !this.ctx.id.equals(this.env[this.constructor.binding].idFromName(userId))) {
            return jsonResponse(403, { error: 'This runner serves another account.' });
        }
        const secret = this.env.RUNNER_SECRET;
        if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
            log({ event: 'runner-secret-unset' });
            return jsonResponse(503, { error: 'crossbind cloud builds are not set up; build with CROSSBIND_RUNNER=DOCKER_RUN meanwhile.' });
        }
        const settings = settingsOf(this.env);
        const { running } = this.container;
        // A runner starts only while there is time left, and every step asks again.
        if (!running || isStep(request)) {
            let allowed;
            try {
                allowed = await this.meter(settings).mayStart(userId);
            } catch (error) {
                log({ event: 'runner-budget-unreadable', who: userKey(userId), message: error.message });
                return jsonResponse(503, { error: 'crossbind cloud cannot read your build minutes right now; try again in a moment.' });
            }
            if (!allowed.ok) {
                if (running) await this.destroy();
                return spent(allowed.reason, settings);
            }
        }
        const token = await runnerToken(secret, this.constructor.image, userId);
        if (!running) {
            // What an earlier run left, after a stop that went unrecorded, is neither counted nor ticked on.
            await this.ctx.storage.delete(['run', 'segment']);
            await this.ctx.storage.put({ user: userId });
            this.envVars = { CROSSBIND_RUNNER_TOKEN: token };
        }
        const headers = new Headers(request.headers);
        headers.delete(USER_HEADER);
        headers.set('authorization', `Bearer ${token}`);
        const response = await this.containerFetch(new Request(request, { headers }), RUNNER_PORT);
        if (response.status === 503 && !this.container.running) {
            return jsonResponse(503, { error: `crossbind cloud has no ${this.constructor.image} runner free right now; try again in a few minutes.` });
        }
        return response;
    }

    // A run that cannot be metered does not run. Requests that arrive together may each start one: the last one
    // counts, and the ticks of the others find another run and stop.
    async onStart() {
        try {
            const run = {
                id: crypto.randomUUID(), userId: await this.ctx.storage.get('user'), startedAt: Date.now(), failures: 0,
            };
            await this.ctx.storage.put({ run });
            await this.meter().begin(run.userId);
            await this.schedule(METER_EVERY_SECONDS, 'meterTick', { runId: run.id });
        } catch (error) {
            log({ event: 'runner-unmetered', stage: 'start', message: error.message });
            await this.destroy();
        }
    }

    async meterTick({ runId } = {}) {
        const run = await this.ctx.storage.get('run');
        if (!this.container.running || run?.id !== runId) return;
        const reason = await this.reasonToStop(run);
        if (reason) {
            log({
                event: 'runner-stopped', reason, who: userKey(run.userId), image: this.constructor.image,
            });
            await this.destroy();
            return;
        }
        try {
            await this.schedule(METER_EVERY_SECONDS, 'meterTick', { runId });
        } catch (error) {
            log({ event: 'runner-unmetered', stage: 'schedule', message: error.message });
            await this.destroy();
        }
    }

    // Null while the run may go on.
    async reasonToStop(run) {
        const settings = settingsOf(this.env);
        if (Date.now() - run.startedAt > (settings.buildSecondsMonthly + RUN_SLACK_SECONDS) * 1000) return 'run-limit';
        try {
            const { exhausted } = await this.meter(settings).flush();
            await this.ctx.storage.put({ run: { ...run, failures: 0 } });
            if (exhausted) return 'allowance';
            if (!settings.cloudBuildsEnabled) return 'paused';
            const { exists, blocked } = await createAccounts(this.env.DB).standing(run.userId);
            if (!exists) return 'deleted';
            return blocked ? 'blocked' : null;
        } catch (error) {
            const failures = run.failures + 1;
            await this.ctx.storage.put({ run: { ...run, failures } });
            log({
                event: 'runner-meter-failed', who: userKey(run.userId), failures, message: error.message,
            });
            return failures >= MAX_METER_FAILURES ? 'unmetered' : null;
        }
    }

    async onActivityExpired() {
        await this.destroy();
    }

    async onStop() {
        try {
            await this.ctx.storage.delete(['run']);
            await this.meter().end();
        } catch (error) {
            // The last minute goes uncounted; the next start opens a run of its own.
            log({ event: 'runner-meter-failed', stage: 'stop', message: error.message });
        }
    }
}

export class CloudRunnerWeb extends CloudRunner {
    static image = 'web';

    static binding = 'RUNNER_WEB';
}

export class CloudRunnerAndroid extends CloudRunner {
    static image = 'android';

    static binding = 'RUNNER_ANDROID';
}

export class CloudRunnerLinux extends CloudRunner {
    static image = 'linux';

    static binding = 'RUNNER_LINUX';
}

export class CloudRunnerWindows extends CloudRunner {
    static image = 'windows';

    static binding = 'RUNNER_WINDOWS';
}

// The library keeps an outbound handler per class name, through its setter.
[CloudRunnerWeb, CloudRunnerAndroid, CloudRunnerLinux, CloudRunnerWindows].forEach((runner) => {
    runner.outbound = downloadsOnly;
});
