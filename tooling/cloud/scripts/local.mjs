// The crossbind cloud API on this machine, for the landing's dev server and `crossbind login`: the Worker's own
// request handling (worker/api.js) in front of the compiler image in Docker, with the quota, the cache and the
// accounts in memory. Turnstile's server-side check is answered here; the page still runs the real widget, on
// Cloudflare's always-passing test key. With a GitHub OAuth app's client id (its device flow enabled), `crossbind login`
// signs in for real: CROSSBIND_CLOUD_URL=http://localhost:8686 crossbind login.
// `wrangler dev` cannot run the compiler: bubblewrap needs Docker's seccomp filter and /proc masking lifted.
// usage: node scripts/local.mjs [--port 8686] [--tag <image>] [--anonymous-daily <n>] [--github-client-id <id>]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { createAccounts } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import { createQuota } from '../worker/quota.js';
import { memoryStorage } from './memory-storage.mjs';
import { sqliteD1 } from './sqlite-d1.mjs';

const argValue = (name, fallback) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? fallback : process.argv[at + 1];
};
// Below the ports `crossbind runner start` takes (8787 and up).
const PORT = Number(argValue('--port', '8686'));
const TAG = argValue('--tag', 'crossbind-playground-compiler:dev');
const CONTAINER = 'crossbind-playground-local';
const COMPILER_URL = 'http://127.0.0.1:18081';
const PAGE = 'http://localhost:5173';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const env = {
    PLAYGROUND_ENABLED: 'true',
    ALLOWED_ORIGINS: PAGE,
    PLAYGROUND_URL: `${PAGE}/playground/`,
    ANONYMOUS_DAILY: argValue('--anonymous-daily', '5'),
    USER_DAILY: '100',
    GLOBAL_DAILY: '1000',
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    TURNSTILE_SECRET: 'local',
    TURNSTILE_HOSTNAMES: 'localhost',
    SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    COMPILER_VERSION: `local-${Date.now()}`,
    GITHUB_CLIENT_ID: argValue('--github-client-id', ''),
};

const cache = new Map();
const unlimited = { limit: async () => ({ success: true }) };
const deps = {
    limits: { api: unlimited, login: unlimited },
    accounts: createAccounts(sqliteD1()),
    quota: createQuota(memoryStorage()),
    compiler: {
        fetch: async (request) => fetch(`${COMPILER_URL}/compile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await request.text() }),
    },
    cache: {
        match: async (request) => cache.get(request.url)?.clone(),
        put: async (request, response) => { cache.set(request.url, response); },
    },
    fetcher: async (url, init) => (url === SITEVERIFY_URL ? Response.json({ success: true, action: 'compile', hostname: 'localhost' }) : fetch(url, init)),
    waitUntil: () => {},
};

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function stopCompiler() {
    try {
        docker(['rm', '-f', CONTAINER]);
    } catch {
        // Not running.
    }
}

async function startCompiler() {
    stopCompiler();
    docker([
        'run', '-d', '--name', CONTAINER, '--memory', '3g', '--pids-limit', '512',
        '--security-opt', 'seccomp=unconfined', '--security-opt', 'systempaths=unconfined', '-p', '127.0.0.1:18081:8080', TAG,
    ]);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${COMPILER_URL}/health`)).ok) return;
        } catch {
            // Still starting.
        }
        await new Promise((resolve) => { setTimeout(resolve, 500); });
    }
    throw new Error(`the compiler did not answer on ${COMPILER_URL}/health within 30 s`);
}

function toRequest(req) {
    const headers = new Headers();
    Object.entries(req.headers).forEach(([name, value]) => headers.set(name, Array.isArray(value) ? value.join(', ') : value));
    headers.set('cf-connecting-ip', req.socket.remoteAddress ?? '127.0.0.1');
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    return new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers, body: hasBody ? req : undefined, duplex: 'half' });
}

async function send(res, response) {
    const headers = {};
    response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') headers[name] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) headers['set-cookie'] = cookies;
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
}

await startCompiler();
const server = http.createServer((req, res) => {
    handleRequest(toRequest(req), env, deps).then((response) => send(res, response)).catch((error) => {
        process.stderr.write(`${error.stack}\n`);
        res.writeHead(500).end();
    });
});
server.listen(PORT, '127.0.0.1', () => process.stdout.write(`crossbind cloud API on http://localhost:${PORT} (playground under /playground), compiler ${TAG}\n`));
['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => {
    stopCompiler();
    process.exit(0);
}));
