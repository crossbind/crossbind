import { DurableObject } from 'cloudflare:workers';
import { createAccounts } from './accounts.js';
import { handleRequest } from './api.js';
import { createQuota } from './quota.js';

// The runners' outbound traffic goes through ContainerProxy, which holds it to their allowed hosts.
export { ContainerProxy } from '@cloudflare/containers';
export {
    CloudRunnerWeb, CloudRunnerAndroid, CloudRunnerLinux, CloudRunnerWindows,
} from './runner.js';

const COMPILER_PORT = 8080;
// A compile waits this long for a container that is starting. The first start after a deploy can take minutes
// while the image spreads; the page then asks to try again.
const READY_ATTEMPTS = 120;
const READY_WAIT_MS = 500;
// Work inside a container is no activity for its Durable Object, and an idle object takes its container down: an
// alarm keeps both up while compiles run, and a little after, so a visitor's next compile finds the container warm.
const KEEPALIVE_MS = 10_000;
const KEEP_WARM_MS = 120_000;
const PRUNE_EVERY_MS = 24 * 3600 * 1000;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// Tokens this isolate found valid moments ago (worker/runner-api.js).
const recentTokens = new Map();

export class PlaygroundCompiler extends DurableObject {
    async fetch(request) {
        if (!this.ctx.container.running) this.ready = null;
        this.ready ??= this.start().catch((error) => {
            this.ready = null;
            throw error;
        });
        try {
            await this.ready;
        } catch (error) {
            // Nothing ran yet, so the Worker gives the compile back (worker/api.js counts a 503 as not started).
            console.log(JSON.stringify({ event: 'compiler-start-failed', message: error.message }));
            return Response.json({ error: 'The compiler is starting.' }, { status: 503 });
        }
        this.running = (this.running ?? 0) + 1;
        this.keepAlive();
        try {
            // The container port takes plain http.
            const url = new URL(request.url);
            url.protocol = 'http:';
            return await this.ctx.container.getTcpPort(COMPILER_PORT).fetch(new Request(url, request));
        } finally {
            this.running -= 1;
            this.lastCompile = Date.now();
        }
    }

    keepAlive() {
        if (this.alarmSet) return;
        this.alarmSet = true;
        this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_MS).catch(() => {
            this.alarmSet = false;
        });
    }

    async alarm() {
        this.alarmSet = false;
        if (this.running > 0 || Date.now() - (this.lastCompile ?? 0) < KEEP_WARM_MS) this.keepAlive();
    }

    async start() {
        // No internet: a compile needs nothing from outside, and a compromised compiler can reach nothing.
        if (!this.ctx.container.running) this.ctx.container.start({ enableInternet: false });
        const port = this.ctx.container.getTcpPort(COMPILER_PORT);
        for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
            try {
                if ((await port.fetch('http://compiler/health')).ok) return;
            } catch {
                // The server inside is still starting.
            }
            await wait(READY_WAIT_MS);
        }
        throw new Error('the compiler container did not start');
    }
}

export class PlaygroundQuota extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        this.quota = createQuota(ctx.storage);
    }

    async reserve(args) {
        if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + PRUNE_EVERY_MS);
        return this.quota.reserve(args);
    }

    refund(args) {
        return this.quota.refund(args);
    }

    remaining(args) {
        return this.quota.remaining(args);
    }

    async alarm() {
        await this.quota.prune();
    }
}

export default {
    fetch(request, env, ctx) {
        return handleRequest(request, env, {
            limits: { api: env.API_LIMITER, login: env.LOGIN_LIMITER, runner: env.RUNNER_LIMITER },
            accounts: createAccounts(env.DB),
            runner: (image, userId) => env[`RUNNER_${image.toUpperCase()}`].getByName(userId),
            recentTokens,
            quota: env.QUOTA.getByName('quota'),
            compiler: env.COMPILER.getByName('compiler'),
            cache: caches.default,
            fetcher: (url, init) => fetch(url, init),
            waitUntil: (promise) => ctx.waitUntil(promise),
        });
    },

    // Daily (`triggers` in wrangler.jsonc): what accounts keep only for a while goes (worker/accounts.js).
    scheduled(controller, env, ctx) {
        ctx.waitUntil(createAccounts(env.DB).prune());
    },
};
