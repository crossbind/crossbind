import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn() } }));

const holder = { config: {} };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() {
            return holder.config;
        },
    },
}));

const wasm = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
const wasi = { platform: 'wasi', path: 'wasi-wasm32-st-release' };
let work;

// Each command run() starts, and whether the Docker compile lock was held while it ran.
async function importRun() {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    const lock = path.join(work, 'home', '.crossbind', 'docker-compile.lock');
    const commands = [];
    execFileSync.mockReset();
    execFileSync.mockImplementation((program, args, options) => {
        commands.push({ program, args, options, locked: fs.existsSync(lock) });
        return '';
    });
    const run = (await import('../src/actions/run.js')).default;
    return { run, commands };
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-run-runner-'));
    vi.stubEnv('HOME', path.join(work, 'home'));
    vi.stubEnv('USERPROFILE', path.join(work, 'home'));
    vi.stubEnv('CROSSBIND_WASI_SDK_PATH', '');
    vi.stubEnv('CROSSBIND_TOKEN_WEB', 'token-for-the-web-runner');
    holder.config = {
        paths: {
            base: work,
            build: path.join(work, 'build'),
            native: [path.join(work, 'src')],
            header: [path.join(work, 'src')],
            cache: path.join(work, '.crossbind'),
            output: path.join(work, 'dist'),
            cli: path.join(work, 'cli'),
        },
        allDependencies: [],
        system: { RUNNER: 'DOCKER_RUN' },
    };
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(work, { recursive: true, force: true });
});

describe('run: where a step runs', () => {
    test('RUNNER=REMOTE sends the step to its image\'s runner, with no pull, no container and no turn at the Docker lock', async () => {
        holder.config.system = { RUNNER: 'REMOTE', REMOTE_URL_WEB: 'https://web.example' };
        const { run, commands } = await importRun();

        run(null, ['make', '-j4'], 'Source-Release', wasm, { exclusive: true });

        expect(commands.map(({ program }) => program)).toEqual([process.execPath]);
        const [{ args, options, locked }] = commands;
        expect(JSON.parse(args[1]).url).toBe('https://web.example');
        expect(options.env.CROSSBIND_TOKEN).toBe('token-for-the-web-runner');
        expect(locked).toBe(false);
    });

    test('a runner address alone keeps the step in the local Docker', async () => {
        vi.stubEnv('CROSSBIND_REMOTE_URL_WEB', 'https://web.example');
        const { run, commands } = await importRun();

        run(null, ['make'], 'Source-Release', wasm);

        expect(commands.at(-1).program).toBe('docker');
        expect(commands.at(-1).args[0]).toBe('run');
        expect(commands.some(({ program }) => program === process.execPath)).toBe(false);
    });

    test('under RUNNER=REMOTE a step whose image has no address stops before anything runs', async () => {
        holder.config.system = { RUNNER: 'REMOTE', REMOTE_URL_LINUX: 'https://linux.example' };
        const { run, commands } = await importRun();

        expect(() => run(null, ['make'], 'Source-Release', wasm)).toThrow(/the web image has no runner address - set REMOTE_URL_WEB/);
        expect(commands).toEqual([]);
    });

    test('a wasi build uses the sdk in the image unless RUNNER is LOCAL, whatever WASI_SDK_PATH says', async () => {
        const sdk = path.join(work, 'wasi-sdk');
        holder.config.system = { RUNNER: 'DOCKER_RUN', WASI_SDK_PATH: sdk };
        vi.stubEnv('CROSSBIND_WASI_SDK_PATH', sdk);
        const { run, commands } = await importRun();

        run(null, ['cmake', '/src'], 'Source-Release', wasi);

        const { program, args } = commands.at(-1);
        expect(program).toBe('docker');
        expect(args).toContain('CC=/opt/wasi-sdk/bin/clang');
        expect(args).toContain('-DCMAKE_TOOLCHAIN_FILE=/opt/wasi-sdk/share/cmake/wasi-sdk-p3.cmake');
    });

    test('RUNNER=LOCAL builds wasi with the wasi-sdk WASI_SDK_PATH names', async () => {
        const sdk = path.join(work, 'wasi-sdk');
        fs.mkdirSync(path.join(sdk, 'share', 'wasi-sysroot', 'lib', 'wasm32-wasip3'), { recursive: true });
        holder.config.system = { RUNNER: 'LOCAL', WASI_SDK_PATH: sdk };
        const { run, commands } = await importRun();

        run(null, ['cmake', '/src'], 'Source-Release', wasi);

        const { program, args, options } = commands.at(-1);
        expect(program).toBe('cmake');
        expect(options.env.CC).toBe(`${sdk}/bin/clang`);
        expect(args).toContain(`-DCMAKE_TOOLCHAIN_FILE=${sdk}/share/cmake/wasi-sdk-p3.cmake`);
    });
});
