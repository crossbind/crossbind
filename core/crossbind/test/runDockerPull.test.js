import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The android image is amd64-only, so its multi-arch index carries no arm64 leaf and pulling that
// index on an arm64 host fails with "no matching manifest". Every call site forced the platform
// except this one, which shipped in 2.0.0-beta.50 and broke android builds on every Apple Silicon
// machine that did not already have the image cached.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const holder = { config: {} };
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; } } }));

let work;

async function importFresh() {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    execFileSync.mockReset();
    // pullDockerImage only shells out to `docker pull` when `docker image inspect` reports the ref
    // absent, so the fixture has to answer that every image is missing.
    execFileSync.mockImplementation((cmd, args) => {
        if (args?.[0] === 'image' && args?.[1] === 'inspect') throw new Error('no such image');
        return '';
    });
    const run = (await import('../src/actions/run.js')).default;
    const images = await import('../src/utils/pullDockerImage.js');
    return { run, images, execFileSync };
}

const pulledRefs = (execFileSync) => execFileSync.mock.calls
    .filter(([cmd, args]) => cmd === 'docker' && args?.[0] === 'pull')
    .map(([, args]) => args[1]);

// run() carries on into the container once the image is there; only the pull is under test.
function runIgnoringContainer(run, target) {
    try {
        run(null, [], null, target);
    } catch {
        // The mocked docker cannot produce a usable container, and does not need to.
    }
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-rundocker-'));
    holder.config = {
        paths: { base: work, build: path.join(work, 'build') },
        system: { RUNNER: 'DOCKER_RUN' },
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
});

describe('run: which image ref reaches docker pull', () => {
    test('android asks for the amd64 leaf, never the index that has no arm64', async () => {
        const { run, images, execFileSync } = await importFresh();

        runIgnoringContainer(run, { platform: 'android' });

        const pulled = pulledRefs(execFileSync);
        expect(pulled).toContain(images.getDockerImage('android', 'linux/amd64'));
        expect(pulled).not.toContain(images.getDockerImage('android'));
    });

    test('wasm keeps asking for the index so each host resolves its own leaf', async () => {
        const { run, images, execFileSync } = await importFresh();

        runIgnoringContainer(run, { platform: 'wasm' });

        const pulled = pulledRefs(execFileSync);
        expect(pulled).toContain(images.getDockerImage('web'));
        expect(pulled).not.toContain(images.getDockerImage('web', 'linux/amd64'));
    });
});
