import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const holder = { config: {} };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() {
            return holder.config;
        },
    },
}));

const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
let work;
let home;

// The lock's holder, read at the moment each command runs: the PID inside it, or null when no lock is held.
async function importRun() {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    const lock = path.join(home, '.crossbind', 'docker-compile.lock');
    const holders = [];
    execFileSync.mockReset();
    execFileSync.mockImplementation((cmd, args) => {
        if (cmd === 'docker' && args?.[0] === 'image') return '';
        holders.push(fs.existsSync(lock) ? fs.readFileSync(lock, 'utf8').split('\n')[0] : null);
        return '';
    });
    const run = (await import('../src/actions/run.js')).default;
    return { run, holders, lock };
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-compile-lock-'));
    home = path.join(work, 'home');
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    holder.config = {
        paths: { base: work, build: path.join(work, 'build') },
        system: { RUNNER: 'DOCKER_RUN' },
    };
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(work, { recursive: true, force: true });
});

describe('run: compile steps of parallel builds take turns in Docker', () => {
    test('an exclusive step holds the compile lock while its container runs, then frees it', async () => {
        const { run, holders, lock } = await importRun();

        run(null, ['make', '-j15', 'install'], 'Source-Release', target, { exclusive: true });

        expect(holders).toEqual([String(process.pid)]);
        expect(fs.existsSync(lock)).toBe(false);
    });

    test('every other step runs without it', async () => {
        const { run, holders } = await importRun();

        run(null, ['cmake', '/src'], 'Source-Release', target);

        expect(holders).toEqual([null]);
    });

    test('a step of a long-lived build container takes turns too', async () => {
        holder.config.system.RUNNER = 'DOCKER_EXEC';
        const { run, holders } = await importRun();

        run(null, ['make', '-j15', 'install'], 'Source-Release', target, { exclusive: true });

        expect(holders).toEqual([String(process.pid)]);
    });

    test('a build on the host leaves Docker\'s turns alone', async () => {
        holder.config.system.RUNNER = 'LOCAL';
        const { run, holders } = await importRun();

        run(null, ['make', '-j15', 'install'], 'Source-Release', target, { exclusive: true });

        expect(holders).toEqual([null]);
    });
});
