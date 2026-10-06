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
        expect(args.find((arg) => arg.endsWith(':/opt/crossbind/runner:ro'))).toMatch(/src\/runner:\/opt\/crossbind\/runner:ro$/);
        expect(args).toContain(`CROSSBIND_RUNNER_IMAGE=${getDockerImage('web')}`);
        expect(args.slice(-2)).toEqual([getDockerImage('web'), '/opt/crossbind/runner/server.js']);
        expect(args[args.indexOf('CROSSBIND_RUNNER_TOKEN') - 1]).toBe('-e');
    });

    test('runs an android runner on amd64, the only platform the NDK ships for', () => {
        const args = runnerStartArgs({ role: 'android', port: 8787, host: '127.0.0.1' });

        expect(args).toEqual(expect.arrayContaining(['--platform', 'linux/amd64', getDockerImage('android', 'linux/amd64')]));
    });

    test('hands docker the token through the environment and makes one when none is given', () => {
        const given = startRunner({ role: 'web', token: 'given-token' });
        const made = startRunner({ role: 'web' });

        expect(given.token).toBe('given-token');
        expect(execFileSync.mock.calls[0][2].env.CROSSBIND_RUNNER_TOKEN).toBe('given-token');
        expect(made.token).toMatch(/^[\w-]{32}$/);
        expect(execFileSync.mock.calls.flatMap((call) => call[1])).not.toContain('given-token');
    });

    test('refuses an image role crossbind does not have', () => {
        expect(() => startRunner({ role: 'ios' })).toThrow(/web, android, linux, windows/);
    });

    test('gives each role its own host port, so the runners of one build can share a machine', () => {
        const web = startRunner({ role: 'web', token: 't' });
        const linux = startRunner({ role: 'linux', token: 't' });

        expect(web.url).toBe('http://127.0.0.1:8787');
        expect(linux.url).toBe('http://127.0.0.1:8789');
        expect(execFileSync.mock.calls[1][1]).toContain('127.0.0.1:8789:8787');
    });

    test('names the address and token variables of the runner\'s own image', () => {
        expect(runnerEnv('linux', 'http://127.0.0.1:8789', 't')).toBe('CROSSBIND_REMOTE_URL_LINUX=http://127.0.0.1:8789 CROSSBIND_TOKEN_LINUX=t');
        expect(deploySteps('fly', 'deploy', 't', 'android').at(-1)).toContain('CROSSBIND_REMOTE_URL_ANDROID=https://<app>.fly.dev CROSSBIND_TOKEN_ANDROID=t');
        expect(deploySteps('cloudflare', 'deploy', 't', 'web').at(-1)).toContain('CROSSBIND_REMOTE_URL_WEB=https://crossbind-runner-web.<account>.workers.dev CROSSBIND_TOKEN_WEB=t');
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
        initRunner({ platform: 'fly', role: 'web', dir });

        const dockerfile = fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8');
        const flyToml = fs.readFileSync(path.join(dir, 'fly.toml'), 'utf8');
        expect(dockerfile).toContain(`FROM ${getDockerImage('web')}`);
        expect(dockerfile).toContain(`CROSSBIND_RUNNER_IMAGE=${getDockerImage('web')}`);
        expect(dockerfile).toContain('ENTRYPOINT ["node", "/opt/crossbind/runner/server.js"]');
        expect(flyToml).toContain('internal_port = 8787');
        expect(flyToml).toContain('auto_stop_machines = "stop"');
        expect(fs.readdirSync(path.join(dir, 'runner')).sort()).toEqual(['blobs.js', 'files.js', 'server.js']);
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
        expect(fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8')).toContain(`FROM ${getDockerImage('web')}`);
    });

    test('refuses to write into a folder that already has files', () => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');

        expect(() => initRunner({ platform: 'fly', role: 'web', dir })).toThrow(/not empty/);
    });
});
