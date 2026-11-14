import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const holder = { config: {} };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() {
            return holder.config;
        },
    },
}));

let work;

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runcache-'));
    holder.config = {
        general: { name: 'sample' },
        paths: { base: work, build: path.join(work, 'build'), cli: '/cli' },
        system: { RUNNER: 'DOCKER_RUN' },
    };
    vi.stubEnv('CROSSBIND_SCCACHE', '1');
    vi.stubEnv('SCCACHE_BUCKET', 'bucket');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'secret-value');
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
});

async function runTarget(target, params) {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    execFileSync.mockReset();
    execFileSync.mockReturnValue('');
    const run = (await import('../src/actions/run.js')).default;
    run(null, params, null, target);
    const [program, args, options] = execFileSync.mock.calls.at(-1);
    return { program, args, env: options.env };
}

function fakeSccache() {
    const bin = path.join(work, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'sccache'), '#!/bin/sh\n', { mode: 0o755 });
    return bin;
}

describe('run: CROSSBIND_SCCACHE', () => {
    test("a container build compiles through the image's sccache, which it stops before the container ends", async () => {
        const { program, args } = await runTarget({ platform: 'linux', arch: 'x64' }, ['cmake', '/src']);

        expect(program).toBe('docker');
        expect(args).toEqual(expect.arrayContaining(['CMAKE_C_COMPILER_LAUNCHER=sccache', 'CMAKE_CXX_COMPILER_LAUNCHER=sccache']));
        expect(args).not.toContain('EM_COMPILER_WRAPPER=sccache');
        const shell = args.indexOf('sh');
        expect(args.slice(shell, shell + 2)).toEqual(['sh', '-c']);
        expect(args[shell + 2]).toContain('sccache --stop-server');
        expect(args[shell + 3]).toBe('cmake');
        expect(args).toContain('/src');
    });

    test("a wasm build compiles without it, as sccache neither recognizes emscripten's compilers nor caches the flags emcc passes", async () => {
        const { args } = await runTarget({ platform: 'wasm', arch: 'wasm32' }, ['emcmake', 'cmake', '/src']);

        expect(args).not.toContain('sh');
        expect(args.some((arg) => /COMPILER_LAUNCHER|EM_COMPILER_WRAPPER|SCCACHE|AWS_/.test(arg))).toBe(false);
    });

    test('its settings reach the container by name, so no key sits on the command line', async () => {
        const { args } = await runTarget({ platform: 'linux', arch: 'x64' }, ['cmake', '/src']);

        expect(args).toEqual(expect.arrayContaining(['SCCACHE_BUCKET', 'AWS_SECRET_ACCESS_KEY']));
        expect(args.join(' ')).not.toContain('secret-value');
    });

    test('a container build mounts SCCACHE_DIR and names it as the container sees it', async () => {
        const dir = path.join(work, 'cache');
        vi.stubEnv('SCCACHE_DIR', dir);
        const { args } = await runTarget({ platform: 'linux', arch: 'x64' }, ['cmake', '/src']);

        expect(args).toEqual(expect.arrayContaining(['-v', `${dir}:/tmp/crossbind/sccache`, 'SCCACHE_DIR=/tmp/crossbind/sccache']));
        expect(args).not.toContain('SCCACHE_DIR');
        expect(fs.existsSync(dir)).toBe(true);
    });

    test('under DOCKER_EXEC a SCCACHE_DIR outside the project stops the build, as the container cannot reach it', async () => {
        holder.config.system = { RUNNER: 'DOCKER_EXEC' };
        vi.stubEnv('SCCACHE_DIR', '/elsewhere/cache');

        await expect(runTarget({ platform: 'linux', arch: 'x64' }, ['cmake', '/src'])).rejects.toThrow(/SCCACHE_DIR/);
    });

    test('a long-lived DOCKER_EXEC container keeps its server, which other commands in it share', async () => {
        holder.config.system = { RUNNER: 'DOCKER_EXEC' };
        const { args } = await runTarget({ platform: 'linux', arch: 'x64' }, ['cmake', '/src']);

        const shell = args.indexOf('sh');
        expect(args[shell + 2]).toContain('command -v sccache');
        expect(args[shell + 2]).not.toContain('--stop-server');
    });

    test.each(['0', 'false', 'no', 'off', ''])('CROSSBIND_SCCACHE=%s leaves the cache off', async (value) => {
        vi.stubEnv('CROSSBIND_SCCACHE', value);
        const { args } = await runTarget({ platform: 'linux', arch: 'x64' }, ['cmake', '/src']);

        expect(args).not.toContain('sh');
    });

    test('without it a container build runs its command alone', async () => {
        vi.stubEnv('CROSSBIND_SCCACHE', '');
        const { args } = await runTarget({ platform: 'linux', arch: 'x64' }, ['cmake', '/src']);

        expect(args).not.toContain('sh');
        expect(args.some((arg) => /COMPILER_LAUNCHER|EM_COMPILER_WRAPPER|SCCACHE|AWS_/.test(arg))).toBe(false);
    });

    // A Mac build runs on a Mac alone, whose PATH holds no drive letter.
    test.skipIf(process.platform === 'win32')('a Mac build compiles through the sccache on its PATH, named in full, as the build narrows the PATH', async () => {
        const bin = fakeSccache();
        vi.stubEnv('PATH', `${bin}:/usr/bin:/bin`);
        const { env } = await runTarget({ platform: 'darwin', arch: 'arm64' }, ['cmake', '/src']);

        expect(env.CMAKE_C_COMPILER_LAUNCHER).toBe(path.join(bin, 'sccache'));
        expect(env.CMAKE_CXX_COMPILER_LAUNCHER).toBe(path.join(bin, 'sccache'));
        expect(env.SCCACHE_BUCKET).toBe('bucket');
        expect(env.AWS_SECRET_ACCESS_KEY).toBe('secret-value');
    });

    test('a Mac build without sccache stops and names how to install it', async () => {
        vi.stubEnv('PATH', '/usr/bin:/bin');

        await expect(runTarget({ platform: 'darwin', arch: 'arm64' }, ['cmake', '/src'])).rejects.toThrow(/brew install sccache/);
    });

    test("a remote build refuses it, as the runner would need the cache's keys", async () => {
        holder.config.system = { RUNNER: 'REMOTE', REMOTE_URL_LINUX: 'https://linux.example' };

        await expect(runTarget({ platform: 'linux', arch: 'x64' }, ['cmake', '/src'])).rejects.toThrow(/CROSSBIND_SCCACHE/);
    });
});
