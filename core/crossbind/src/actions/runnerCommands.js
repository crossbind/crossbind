import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pullDockerImage, { getDockerImage } from '../utils/pullDockerImage.js';
import { DOCKER_RUN_SECURITY_ARGS } from '../utils/dockerSecurity.js';
import { remoteVariables } from '../utils/remoteRunner.js';
import { MIN_TOKEN_LENGTH } from '../runner/server.js';

// `crossbind runner`: a runner is the toolchain image this CLI pins plus the server in src/runner, which
// reaches the image mounted (start), copied by a generated Dockerfile or packed into Cloud Run variables (init);
// no runner image is published.

export const RUNNER_ROLES = ['web', 'android', 'linux', 'windows'];
const RUNNER_PORT = 8787;
const RUNNER_SOURCE = fileURLToPath(new URL('../runner', import.meta.url));
const CONTAINER_RUNNER = '/opt/crossbind/runner';
const TOKEN_BYTES = 24;
const FLY_SUFFIX_BYTES = 3;
// Cloudflare sizes a custom container by its vCPUs: at least 3 GiB of memory each, at most 2 GB of disk per GiB,
// up to 20 GB. Memory is most of the price while a container runs, so a runner takes the least.
const CLOUDFLARE_MAX_VCPU = 4;
const CLOUDFLARE_MIB_PER_VCPU = 3072;
const CLOUDFLARE_DISK_MB_PER_VCPU = 6000;
const CLOUDFLARE_MAX_DISK_MB = 20000;
// Cloud Run deploys the pinned image straight from its registry. env.yaml carries the runner gzipped into one
// variable (Cloud Run allows 32 KB each) and, in another, a boot script that unpacks it and starts the server.
const CLOUD_RUN_SOURCE = '/tmp/crossbind-runner-src';
const CLOUD_RUN_UNPACK = 'const fs = require("node:fs"); const path = require("node:path"); '
    + 'for (const [name, text] of Object.entries(JSON.parse(fs.readFileSync(0, "utf8")))) fs.writeFileSync(path.join(process.argv[1], name), text);';
const CLOUD_RUN_BOOT = [
    'set -e',
    `dir=${CLOUD_RUN_SOURCE}`,
    'mkdir -p "$dir"',
    `printf %s "$CROSSBIND_RUNNER_BUNDLE" | base64 -d | gunzip | node -e '${CLOUD_RUN_UNPACK}' "$dir"`,
    'exec node "$dir/server.js"',
].join('\n');
const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

const runnerName = (role) => `crossbind-runner-${role}`;
const runnerFiles = () => fs.readdirSync(RUNNER_SOURCE).filter((file) => file.endsWith('.js'));
// Google ships the linux NDK for x86_64 only, so an android runner is always amd64.
const platformOf = (role) => (role === 'android' ? 'linux/amd64' : undefined);
const runnerImage = (role) => getDockerImage(role, platformOf(role));

export const newRunnerToken = () => crypto.randomBytes(TOKEN_BYTES).toString('base64url');

// Each image has its own host port, so the runners one build needs can share a machine.
export const runnerHostPort = (role) => RUNNER_PORT + RUNNER_ROLES.indexOf(role);

export function runnerEnv(role, url, token) {
    const variables = remoteVariables(role);
    return `${variables.url}=${url} ${variables.token}=${token}`;
}

function assertRole(role) {
    if (!RUNNER_ROLES.includes(role)) throw new Error(`crossbind: unknown image "${role}" - expected one of ${RUNNER_ROLES.join(', ')}.`);
}

export function runnerStartArgs({ role, port, host }) {
    const platform = platformOf(role);
    return [
        'run', '-d', '--name', runnerName(role), '--restart', 'unless-stopped',
        ...(platform ? ['--platform', platform] : []),
        ...DOCKER_RUN_SECURITY_ARGS,
        '-p', `${host}:${port}:${RUNNER_PORT}`,
        '-v', `${RUNNER_SOURCE}:${CONTAINER_RUNNER}:ro`,
        // By name only: docker reads the value from its own environment, so the token stays off the command line.
        '-e', 'CROSSBIND_RUNNER_TOKEN',
        '-e', `CROSSBIND_RUNNER_IMAGE=${runnerImage(role)}`,
        '-e', `CROSSBIND_RUNNER_ROLE=${role}`,
        '--entrypoint', 'node',
        runnerImage(role),
        `${CONTAINER_RUNNER}/server.js`,
    ];
}

export function startRunner({ role = 'web', port = runnerHostPort(role), host = '127.0.0.1', token } = {}) {
    assertRole(role);
    const fromEnvironment = !token && process.env.CROSSBIND_RUNNER_TOKEN;
    const secret = token || fromEnvironment || newRunnerToken();
    if (secret.length < MIN_TOKEN_LENGTH) throw new Error(`crossbind: a runner token needs at least ${MIN_TOKEN_LENGTH} characters.`);
    pullDockerImage(role, platformOf(role));
    execFileSync('docker', runnerStartArgs({ role, port, host }), {
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, CROSSBIND_RUNNER_TOKEN: secret },
    });
    // A token taken from the environment is shown by its variable, so the line printed for it puts no secret in a log.
    return {
        name: runnerName(role), url: `http://${host}:${port}`, token: secret, displayToken: fromEnvironment ? '$CROSSBIND_RUNNER_TOKEN' : secret,
    };
}

export function stopRunner({ role = 'web' } = {}) {
    assertRole(role);
    execFileSync('docker', ['rm', '-f', runnerName(role)], { stdio: 'inherit' });
}

function dockerfile(role) {
    const platform = platformOf(role);
    return [
        `# Generated by crossbind ${VERSION}: the ${role} toolchain image this CLI pins, plus its runner.`,
        `FROM ${platform ? `--platform=${platform} ` : ''}${runnerImage(role)}`,
        `COPY runner ${CONTAINER_RUNNER}`,
        `ENV CROSSBIND_RUNNER_IMAGE=${runnerImage(role)} CROSSBIND_RUNNER_ROLE=${role}`,
        `EXPOSE ${RUNNER_PORT}`,
        `ENTRYPOINT ["node", "${CONTAINER_RUNNER}/server.js"]`,
        '',
    ].join('\n');
}

// One machine: a runner keeps its build tree on its own disk, so a second machine would hold another tree.
function flyToml(app) {
    return [
        `# Generated by crossbind ${VERSION}. Create the app with \`fly launch --copy-config --no-deploy --ha=false\`,`,
        '# set its token with `fly secrets set CROSSBIND_RUNNER_TOKEN=<token>`, then run `fly deploy --ha=false`.',
        `app = "${app}"`,
        '',
        '[build]',
        '  dockerfile = "Dockerfile"',
        '',
        '[http_service]',
        `  internal_port = ${RUNNER_PORT}`,
        '  force_https = true',
        '  auto_stop_machines = "stop"',
        '  auto_start_machines = true',
        '  min_machines_running = 0',
        '',
        '[[vm]]',
        '  size = "performance-4x"',
        '  memory = "16gb"',
        '',
    ].join('\n');
}

// Cloudflare's GA scheduling (`default` policy), driven through the Durable Object container API, so the
// folder needs no npm dependency. One container: a runner keeps one build tree.
function cloudflareInstance(vcpu) {
    if (vcpu === undefined) return '"standard-4"';
    const disk = Math.min(CLOUDFLARE_MAX_DISK_MB, vcpu * CLOUDFLARE_DISK_MB_PER_VCPU);
    return `{ "vcpu": ${vcpu}, "memory_mib": ${vcpu * CLOUDFLARE_MIB_PER_VCPU}, "disk_mb": ${disk} }`;
}

function wranglerConfig(app, vcpu) {
    return [
        `// Generated by crossbind ${VERSION}. \`npx wrangler deploy\` builds the image with the local Docker, then`,
        '// `npx wrangler secret put CROSSBIND_RUNNER_TOKEN` sets the token builds must send.',
        '{',
        `    "name": "${app}",`,
        '    "main": "src/worker.js",',
        '    "compatibility_date": "2026-09-01",',
        '    "containers": [',
        '        {',
        '            "class_name": "CrossbindRunner",',
        '            "image": "./Dockerfile",',
        `            "instance_type": ${cloudflareInstance(vcpu)},`,
        '            "max_instances": 1',
        '        }',
        '    ],',
        '    "durable_objects": {',
        '        "bindings": [{ "name": "RUNNER", "class_name": "CrossbindRunner" }]',
        '    },',
        '    "exports": {',
        '        "CrossbindRunner": { "type": "durable-object", "storage": "sqlite" }',
        '    }',
        '}',
        '',
    ].join('\n');
}

function cloudflareWorker(role) {
    return [
        `// Generated by crossbind ${VERSION}: a Worker in front of one ${role} runner container.`,
        "import { DurableObject } from 'cloudflare:workers';",
        '',
        `const RUNNER_PORT = ${RUNNER_PORT};`,
        '// A cold start pulls the toolchain image first; the wait stays below the 300 s a client waits for an answer.',
        'const READY_ATTEMPTS = 480;',
        'const READY_WAIT_MS = 500;',
        '// A step streams a line at least every 15 s, its heartbeat; a minute without one means no step is running.',
        'const KEEPALIVE_MS = 10000;',
        'const IDLE_AFTER_MS = 60000;',
        '',
        'const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });',
        'const encoder = new TextEncoder();',
        '',
        '// Constant time, so the answer does not tell how much of a guess was right.',
        'function tokenMatches(header, token) {',
        "    const actual = encoder.encode(header ?? '');",
        "    const expected = encoder.encode('Bearer ' + token);",
        '    return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected);',
        '}',
        '',
        'export class CrossbindRunner extends DurableObject {',
        '    async fetch(request) {',
        '        if (!this.ctx.container.running) this.ready = null;',
        '        this.ready ??= this.start().catch((error) => {',
        '            this.ready = null;',
        '            throw error;',
        '        });',
        '        await this.ready;',
        '        // The container port takes plain http; the Worker itself is reached over https.',
        '        const url = new URL(request.url);',
        "        url.protocol = 'http:';",
        '        const response = await this.ctx.container.getTcpPort(RUNNER_PORT).fetch(new Request(url, request));',
        '        if (!response.body) return response;',
        '        this.streamed();',
        '        const body = response.body.pipeThrough(new TransformStream({',
        '            transform: (chunk, controller) => {',
        '                this.streamed();',
        '                controller.enqueue(chunk);',
        '            },',
        '        }));',
        '        return new Response(body, response);',
        '    }',
        '',
        '    // Work inside the container is no activity for this object, and an idle object takes its container down',
        '    // with it: while a step streams, an alarm keeps both up.',
        '    streamed() {',
        '        this.lastStreamed = Date.now();',
        '        if (this.alarmSet) return;',
        '        this.alarmSet = true;',
        '        this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_MS).catch(() => {',
        '            this.alarmSet = false;',
        '        });',
        '    }',
        '',
        '    async alarm() {',
        '        this.alarmSet = false;',
        '        if (Date.now() - this.lastStreamed < IDLE_AFTER_MS) {',
        '            this.alarmSet = true;',
        '            await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_MS);',
        '        }',
        '    }',
        '',
        '    async start() {',
        '        // Builds fetch crates, conan packages and library sources, so the container reaches the internet.',
        '        if (!this.ctx.container.running) {',
        '            this.ctx.container.start({ enableInternet: true, env: { CROSSBIND_RUNNER_TOKEN: this.env.CROSSBIND_RUNNER_TOKEN } });',
        '        }',
        '        const port = this.ctx.container.getTcpPort(RUNNER_PORT);',
        '        for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {',
        '            try {',
        "                if ((await port.fetch('http://runner/v1/health')).ok) return;",
        '            } catch {',
        '                // The runner inside is still starting.',
        '            }',
        '            await wait(READY_WAIT_MS);',
        '        }',
        "        throw new Error('crossbind runner: the container did not start');",
        '    }',
        '}',
        '',
        'export default {',
        '    async fetch(request, env) {',
        '        // The runner checks the token too; checking it here keeps a stranger from waking the container.',
        "        if (!env.CROSSBIND_RUNNER_TOKEN || !tokenMatches(request.headers.get('authorization'), env.CROSSBIND_RUNNER_TOKEN)) {",
        "            return Response.json({ error: 'invalid token' }, { status: 401 });",
        '        }',
        "        return env.RUNNER.getByName('runner').fetch(request);",
        '    },',
        '};',
        '',
    ].join('\n');
}

function cloudRunEnv(role) {
    const files = Object.fromEntries(runnerFiles().map((file) => [file, fs.readFileSync(path.join(RUNNER_SOURCE, file), 'utf8')]));
    const variables = {
        CROSSBIND_RUNNER_IMAGE: runnerImage(role),
        CROSSBIND_RUNNER_ROLE: role,
        CROSSBIND_RUNNER_BOOT: CLOUD_RUN_BOOT,
        CROSSBIND_RUNNER_BUNDLE: zlib.gzipSync(JSON.stringify(files)).toString('base64'),
    };
    return [
        `# Generated by crossbind ${VERSION}: the variables of a Cloud Run ${role} runner. The container runs`,
        '# CROSSBIND_RUNNER_BOOT, which unpacks the runner from CROSSBIND_RUNNER_BUNDLE and starts it.',
        ...Object.entries(variables).map(([name, value]) => `${name}: ${JSON.stringify(value)}`),
        '',
    ].join('\n');
}

// One instance (--max is the service's limit, which the regional CPU quota is checked against; --max-instances the
// revision's), an hour per step, and the token in Secret Manager, read by an account that may read nothing else:
// the default compute account can hold broad roles, and a build step could take its token from the metadata server.
function cloudRunSteps(dir, token, role) {
    const app = runnerName(role);
    const account = `${app}@$PROJECT.iam.gserviceaccount.com`;
    return [
        `cd ${dir}`,
        'PROJECT=$(gcloud config get-value project) REGION=europe-west1   (any Cloud Run region)',
        'gcloud services enable run.googleapis.com secretmanager.googleapis.com iam.googleapis.com',
        `gcloud iam service-accounts create ${app}`,
        `printf %s ${token} | gcloud secrets create ${app}-token --data-file=-`,
        `gcloud secrets add-iam-policy-binding ${app}-token --member=serviceAccount:${account} --role=roles/secretmanager.secretAccessor`,
        `gcloud run deploy ${app} --image ${runnerImage(role)} --region $REGION --execution-environment gen2 --cpu 4 --memory 8Gi`
            + ` --port ${RUNNER_PORT} --max 1 --max-instances 1 --timeout 3600 --allow-unauthenticated --service-account ${account}`
            + ` --set-secrets CROSSBIND_RUNNER_TOKEN=${app}-token:latest --env-vars-file env.yaml --command sh --args='-c,eval "$CROSSBIND_RUNNER_BOOT"'`,
    ];
}

const PLATFORMS = {
    cloudflare: {
        appName: (role) => `crossbind-runner-${role}`,
        url: (app) => `https://${app}.<account>.workers.dev`,
        files: (role, app, vcpu) => ({ Dockerfile: dockerfile(role), 'wrangler.jsonc': wranglerConfig(app, vcpu), 'src/worker.js': cloudflareWorker(role) }),
        steps: (dir, token) => [
            `cd ${dir}`,
            'npx wrangler deploy   (Docker must be running: wrangler builds the image locally)',
            `npx wrangler secret put CROSSBIND_RUNNER_TOKEN   (paste ${token})`,
        ],
    },
    cloudrun: {
        appName: runnerName,
        url: (app) => `https://${app}-<project-number>.<region>.run.app`,
        files: (role) => ({ 'env.yaml': cloudRunEnv(role) }),
        steps: cloudRunSteps,
    },
    fly: {
        // Fly app names are global, and fly starts the machine for any request, one without the token too: the
        // random part keeps the name free and the address hard to guess.
        appName: (role) => `crossbind-runner-${role}-${crypto.randomBytes(FLY_SUFFIX_BYTES).toString('hex')}`,
        url: (app) => `https://${app}.fly.dev`,
        files: (role, app) => ({ Dockerfile: dockerfile(role), 'fly.toml': flyToml(app) }),
        steps: (dir, token) => [
            `cd ${dir}`,
            'fly launch --copy-config --no-deploy --ha=false',
            `fly secrets set CROSSBIND_RUNNER_TOKEN=${token}`,
            'fly deploy --ha=false',
        ],
    },
};

export const RUNNER_PLATFORMS = Object.keys(PLATFORMS);

export const deploySteps = (platform, dir, token, role, url) => [
    ...PLATFORMS[platform].steps(dir, token, role),
    `then build with ${runnerEnv(role, url, token)}`,
];

export function initRunner({
    platform, role = 'web', dir, vcpu,
}) {
    assertRole(role);
    if (!PLATFORMS[platform]) throw new Error(`crossbind: runner init knows ${RUNNER_PLATFORMS.join(', ')}, not ${platform}.`);
    if (vcpu !== undefined && platform !== 'cloudflare') {
        throw new Error('crossbind: --vcpu sizes a cloudflare container; fly.toml sets the size of a fly machine, and the deploy command\'s --cpu and --memory that of a Cloud Run service.');
    }
    if (vcpu !== undefined && !(Number.isInteger(vcpu) && vcpu >= 1 && vcpu <= CLOUDFLARE_MAX_VCPU)) {
        throw new Error(`crossbind: a cloudflare runner takes 1 to ${CLOUDFLARE_MAX_VCPU} vCPUs, not ${vcpu}.`);
    }
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new Error(`crossbind: ${dir} is not empty; runner init writes a fresh folder.`);
    const app = PLATFORMS[platform].appName(role);
    fs.mkdirSync(path.join(dir, 'runner'), { recursive: true });
    runnerFiles().forEach((file) => fs.copyFileSync(path.join(RUNNER_SOURCE, file), path.join(dir, 'runner', file)));
    Object.entries(PLATFORMS[platform].files(role, app, vcpu)).forEach(([name, text]) => {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), text);
    });
    return { dir, url: PLATFORMS[platform].url(app) };
}
