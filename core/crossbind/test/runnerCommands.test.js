import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('../src/utils/pullDockerImage.js', async (importOriginal) => ({ ...(await importOriginal()), default: vi.fn() }));

const { execFileSync } = await import('node:child_process');
const { getDockerImage } = await import('../src/utils/pullDockerImage.js');
const {
    runnerStartArgs, startRunner, stopRunner, initRunner, runnerEnv, deploySteps,
} = await import('../src/actions/runnerCommands.js');

describe('crossbind runner start', () => {
    beforeEach(() => {
        execFileSync.mockClear();
        vi.unstubAllEnvs();
    });

    test('runs the pinned toolchain image with this CLI\'s runner mounted read-only and the token passed by name', () => {
        const args = runnerStartArgs({ role: 'web', port: 9000, host: '127.0.0.1' });

        expect(args).toEqual(expect.arrayContaining(['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '-p', '127.0.0.1:9000:8787']));
        expect(args).toContain(getDockerImage('web'));
        expect(args.find((arg) => arg.endsWith(':/opt/crossbind/runner:ro'))).toMatch(/src[\\/]runner:\/opt\/crossbind\/runner:ro$/);
        expect(args).toContain(`CROSSBIND_RUNNER_IMAGE=${getDockerImage('web')}`);
        expect(args.slice(-2)).toEqual([getDockerImage('web'), '/opt/crossbind/runner/server.js']);
        expect(args[args.indexOf('CROSSBIND_RUNNER_TOKEN') - 1]).toBe('-e');
    });

    test('runs an android runner on amd64, the only platform the NDK ships for', () => {
        const args = runnerStartArgs({ role: 'android', port: 8787, host: '127.0.0.1' });

        expect(args).toEqual(expect.arrayContaining(['--platform', 'linux/amd64', getDockerImage('android', 'linux/amd64')]));
    });

    test('hands docker the token through the environment and makes one when none is given', () => {
        const given = startRunner({ role: 'web', token: 'given-token-for-tests' });
        const made = startRunner({ role: 'web' });

        expect(given.token).toBe('given-token-for-tests');
        expect(execFileSync.mock.calls[0][2].env.CROSSBIND_RUNNER_TOKEN).toBe('given-token-for-tests');
        expect(made.token).toMatch(/^[\w-]{32}$/);
        expect(execFileSync.mock.calls.flatMap((call) => call[1])).not.toContain('given-token-for-tests');
    });

    test('refuses an image role crossbind does not have', () => {
        expect(() => startRunner({ role: 'ios' })).toThrow(/web, android, linux, windows/);
    });

    test('gives each role its own host port, so the runners of one build can share a machine', () => {
        const web = startRunner({ role: 'web', token: 'token-for-the-port-test' });
        const linux = startRunner({ role: 'linux', token: 'token-for-the-port-test' });

        expect(web.url).toBe('http://127.0.0.1:8787');
        expect(linux.url).toBe('http://127.0.0.1:8789');
        expect(execFileSync.mock.calls[1][1]).toContain('127.0.0.1:8789:8787');
    });

    test('names the address and token variables of the runner\'s own image', () => {
        expect(runnerEnv('linux', 'http://127.0.0.1:8789', 't')).toBe('CROSSBIND_REMOTE_URL_LINUX=http://127.0.0.1:8789 CROSSBIND_TOKEN_LINUX=t');
        expect(deploySteps('cloudflare', 'deploy', 't', 'web', 'https://crossbind-runner-web.<account>.workers.dev').at(-1))
            .toContain('CROSSBIND_REMOTE_URL_WEB=https://crossbind-runner-web.<account>.workers.dev CROSSBIND_TOKEN_WEB=t');
    });

    test('refuses a token too short to resist guessing before it starts anything', () => {
        expect(() => startRunner({ role: 'web', token: 'short' })).toThrow(/at least 16 characters/);
        expect(execFileSync).not.toHaveBeenCalled();
    });

    test('shows a token taken from the environment by its variable, so the line it prints carries no secret into a log', () => {
        vi.stubEnv('CROSSBIND_RUNNER_TOKEN', 'token-from-the-environment');

        const runner = startRunner({ role: 'web' });

        expect(runner.token).toBe('token-from-the-environment');
        expect(runner.displayToken).toBe('$CROSSBIND_RUNNER_TOKEN');
        expect(startRunner({ role: 'web', token: 'token-given-on-the-line' }).displayToken).toBe('token-given-on-the-line');
    });

    test('stop removes the runner container of that role', () => {
        stopRunner({ role: 'web' });

        expect(execFileSync.mock.calls[0][1]).toEqual(['rm', '-f', 'crossbind-runner-web']);
    });
});

describe('crossbind runner init fly', () => {
    let dir;

    beforeEach(() => {
        dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runner-init-')), 'deploy');
    });

    afterEach(() => {
        fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    });

    test('writes a folder fly deploy builds: the pinned image plus the runner, and a single machine that stops when idle', () => {
        const { url } = initRunner({ platform: 'fly', role: 'web', dir });

        const dockerfile = fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8');
        const flyToml = fs.readFileSync(path.join(dir, 'fly.toml'), 'utf8');
        expect(dockerfile).toContain(`FROM ${getDockerImage('web')}`);
        expect(dockerfile).toContain(`CROSSBIND_RUNNER_IMAGE=${getDockerImage('web')}`);
        expect(dockerfile).toContain('ENTRYPOINT ["node", "/opt/crossbind/runner/server.js"]');
        expect(flyToml).toContain('internal_port = 8787');
        expect(flyToml).toContain('auto_stop_machines = "stop"');
        expect(fs.readdirSync(path.join(dir, 'runner')).sort()).toEqual(['blobs.js', 'files.js', 'server.js']);
        const app = flyToml.match(/^app = "(crossbind-runner-web-[0-9a-f]{6})"$/m)[1];
        expect(url).toBe(`https://${app}.fly.dev`);
        expect(deploySteps('fly', dir, 't', 'web', url).at(-1)).toContain(`CROSSBIND_REMOTE_URL_WEB=https://${app}.fly.dev CROSSBIND_TOKEN_WEB=t`);
    });

    test('pins the amd64 image for an android runner', () => {
        initRunner({ platform: 'fly', role: 'android', dir });

        expect(fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8')).toContain(`FROM --platform=linux/amd64 ${getDockerImage('android', 'linux/amd64')}`);
    });

    test('writes a cloudflare folder: one standard-4 container behind a Worker that checks the token first', () => {
        initRunner({ platform: 'cloudflare', role: 'web', dir });

        const config = fs.readFileSync(path.join(dir, 'wrangler.jsonc'), 'utf8');
        const worker = fs.readFileSync(path.join(dir, 'src/worker.js'), 'utf8');
        expect(config).toContain('"image": "./Dockerfile"');
        expect(config).toContain('"instance_type": "standard-4"');
        expect(config).toContain('"max_instances": 1');
        expect(worker).toContain("import { DurableObject } from 'cloudflare:workers'");
        expect(worker).toContain('enableInternet: true');
        expect(worker.indexOf('invalid token')).toBeLessThan(worker.indexOf("getByName('runner')"));
        expect(worker).toContain('crypto.subtle.timingSafeEqual');
        // The container port takes plain http, while a deployed Worker receives its requests over https.
        expect(worker).toContain("url.protocol = 'http:'");
        expect(worker).not.toContain('getTcpPort(RUNNER_PORT).fetch(request)');
        // Work inside a container is no activity for its Durable Object: an alarm keeps both up while a step streams.
        expect(worker).toContain('async alarm()');
        expect(worker).toContain('this.ctx.storage.setAlarm(');
        const idleAfterMs = Number(worker.match(/IDLE_AFTER_MS = (\d+)/)[1]);
        expect(idleAfterMs).toBeGreaterThanOrEqual(30_000);
        expect(Number(worker.match(/KEEPALIVE_MS = (\d+)/)[1])).toBeLessThan(idleAfterMs);
        const startWaitMs = Number(worker.match(/READY_ATTEMPTS = (\d+)/)[1]) * Number(worker.match(/READY_WAIT_MS = (\d+)/)[1]);
        expect(startWaitMs).toBeGreaterThanOrEqual(120_000);
        expect(startWaitMs).toBeLessThan(300_000);
        expect(worker).not.toMatch(/!==\s*'Bearer '/);
        expect(fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8')).toContain(`FROM ${getDockerImage('web')}`);
    });

    test('sizes a cloudflare container by its vCPUs, with the least memory and the most disk Cloudflare allows them', () => {
        initRunner({
            platform: 'cloudflare', role: 'web', dir, vcpu: 1,
        });

        expect(fs.readFileSync(path.join(dir, 'wrangler.jsonc'), 'utf8')).toContain('"instance_type": { "vcpu": 1, "memory_mib": 3072, "disk_mb": 6000 },');
    });

    test('caps the disk of a 4-vCPU cloudflare container at the 20 GB Cloudflare allows', () => {
        initRunner({
            platform: 'cloudflare', role: 'web', dir, vcpu: 4,
        });

        expect(fs.readFileSync(path.join(dir, 'wrangler.jsonc'), 'utf8')).toContain('"instance_type": { "vcpu": 4, "memory_mib": 12288, "disk_mb": 20000 },');
    });

    test('refuses a vCPU count cloudflare does not offer, and a vCPU count for fly, before writing anything', () => {
        expect(() => initRunner({
            platform: 'cloudflare', role: 'web', dir, vcpu: 5,
        })).toThrow(/1 to 4 vCPUs/);
        expect(() => initRunner({
            platform: 'cloudflare', role: 'web', dir, vcpu: 1.5,
        })).toThrow(/1 to 4 vCPUs/);
        expect(() => initRunner({
            platform: 'fly', role: 'web', dir, vcpu: 2,
        })).toThrow(/--vcpu sizes a cloudflare container/);
        expect(fs.existsSync(dir)).toBe(false);
    });

    test('refuses to write into a folder that already has files', () => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');

        expect(() => initRunner({ platform: 'fly', role: 'web', dir })).toThrow(/not empty/);
    });
});
