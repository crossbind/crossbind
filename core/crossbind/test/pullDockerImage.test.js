import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import crypto from 'node:crypto';

vi.mock('node:child_process', () => ({
    execFileSync: vi.fn(),
}));

// The module keeps availability state (pulledRefs) and warns once per message, so every test
// imports a fresh copy alongside the mocked child_process from the same module graph.
async function importFresh() {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    const mod = await import('../src/utils/pullDockerImage.js');
    return { mod, execFileSync };
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('imageRoleFor', () => {
    test('sends android to its own image and everything else to web', async () => {
        const { mod } = await importFresh();
        expect(mod.imageRoleFor({ platform: 'android' })).toBe('android');
        expect(mod.imageRoleFor({ platform: 'wasm' })).toBe('web');
        // wasi shares the web image; ios never reaches docker but still resolves to something valid.
        expect(mod.imageRoleFor({ platform: 'wasi' })).toBe('web');
        expect(mod.imageRoleFor(null)).toBe('web');
    });
});

describe('getDockerImage', () => {
    test('returns the digest-pinned image ref', async () => {
        const { mod } = await importFresh();
        expect(mod.getDockerImage()).toMatch(/^ghcr\.io\/crossbind\/web@sha256:[0-9a-f]{64}$/);
        expect(mod.getDockerImage('android')).toMatch(/^ghcr\.io\/crossbind\/android@sha256:[0-9a-f]{64}$/);
    });

    test('returns a distinct digest-pinned amd64 leaf for linux/amd64', async () => {
        const { mod } = await importFresh();
        expect(mod.getDockerImage('android', 'linux/amd64')).toMatch(/^ghcr\.io\/crossbind\/android@sha256:[0-9a-f]{64}$/);
        expect(mod.getDockerImage('android', 'linux/amd64')).not.toBe(mod.getDockerImage('android'));
    });

    test('rejects an unknown role instead of silently falling back to web', async () => {
        const { mod } = await importFresh();
        expect(() => mod.getDockerImage('ios')).toThrow(/unknown docker image role/);
    });
});

describe('image overrides', () => {
    test('a mirror keeps the release digest and only moves the registry', async () => {
        const { mod } = await importFresh();
        const expected = mod.getDockerImage();
        vi.stubEnv('CROSSBIND_REGISTRY_MIRROR', 'registry.example.dev/crossbind/');

        const ref = mod.getDockerImage();

        expect(ref).toBe(`registry.example.dev/crossbind/web${expected.slice(expected.indexOf('@'))}`);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('registry mirror'));
    });

    test('an explicit ref wins over the mirror', async () => {
        const { mod } = await importFresh();
        vi.stubEnv('CROSSBIND_REGISTRY_MIRROR', 'registry.example.dev/crossbind');
        vi.stubEnv('CROSSBIND_IMAGE_WEB', 'crossbind/web:dev');

        expect(mod.getDockerImage('web')).toBe('crossbind/web:dev');
    });

    test('a tag override says the reproducibility guarantee is gone', async () => {
        const { mod } = await importFresh();
        vi.stubEnv('CROSSBIND_IMAGE_ANDROID', 'crossbind/android:dev');

        expect(mod.getDockerImage('android')).toBe('crossbind/android:dev');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('mutable override'));
    });

    test('a foreign digest is called unsupported, not mutable', async () => {
        const { mod } = await importFresh();
        const foreign = `other/image@sha256:${'a'.repeat(64)}`;
        vi.stubEnv('CROSSBIND_IMAGE_WEB', foreign);

        expect(mod.getDockerImage('web')).toBe(foreign);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('unsupported toolchain override'));
    });

    test('re-pointing at the release digest itself warns about nothing', async () => {
        const { mod } = await importFresh();
        const expected = mod.getDockerImage('web');
        vi.stubEnv('CROSSBIND_IMAGE_WEB', expected);

        expect(mod.getDockerImage('web')).toBe(expected);
        expect(console.warn).not.toHaveBeenCalled();
    });
});

describe('getDockerContainerName', () => {
    test('builds a valid docker container name from the tag, the role and the base hash', async () => {
        const { mod } = await importFresh();
        const name = mod.getDockerContainerName('/some/base', 'web');
        expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
        expect(name).not.toContain('@');
        expect(name.startsWith('crossbind-')).toBe(true);
        const baseHash = crypto.createHash('sha256').update('/some/base').digest('hex');
        expect(name.endsWith(`-${baseHash}`)).toBe(true);
    });

    test('gives each image its own container', async () => {
        // A web container carries no NDK, so reusing one name across images would exec the
        // android toolchain inside a container that does not have it.
        const { mod } = await importFresh();
        expect(mod.getDockerContainerName('/a/b', 'web')).not.toBe(mod.getDockerContainerName('/a/b', 'android'));
    });

    test('is deterministic for the same base path', async () => {
        const { mod } = await importFresh();
        expect(mod.getDockerContainerName('/a/b')).toBe(mod.getDockerContainerName('/a/b'));
        expect(mod.getDockerContainerName('/a/b')).not.toBe(mod.getDockerContainerName('/a/c'));
    });
});

describe('pullDockerImage', () => {
    test('skips docker pull when the image is already present', async () => {
        const { mod, execFileSync } = await importFresh();
        execFileSync.mockReturnValue('');

        mod.default();

        expect(execFileSync).toHaveBeenCalledWith(
            'docker',
            ['image', 'inspect', mod.getDockerImage()],
            expect.objectContaining({ stdio: 'ignore' }),
        );
        const pullCalls = execFileSync.mock.calls.filter(([, args]) => args[0] === 'pull');
        expect(pullCalls).toHaveLength(0);
    });

    test('pulls the image by digest when it is not present locally', async () => {
        const { mod, execFileSync } = await importFresh();
        execFileSync.mockImplementation((cmd, args) => {
            if (args[0] === 'image' && args[1] === 'inspect') {
                throw new Error('No such image');
            }
            return '';
        });

        mod.default();

        expect(execFileSync).toHaveBeenCalledWith(
            'docker',
            ['pull', mod.getDockerImage()],
            expect.objectContaining({ stdio: 'inherit' }),
        );
    });

    test('looks again after a failed pull, which has started a stopped Docker Desktop engine', async () => {
        // Docker Desktop's Resource Saver stops the engine after a few idle minutes and answers
        // `image inspect` from a cache with "No such image" meanwhile; only the pull starts the engine.
        const { mod, execFileSync } = await importFresh();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        let lookups = 0;
        execFileSync.mockImplementation((cmd, args) => {
            if (args[0] === 'image' && args[1] === 'inspect' && lookups++ === 0) throw new Error('No such image');
            if (args[0] === 'pull') throw new Error('Command failed: docker pull');
            return '';
        });

        expect(() => mod.default()).not.toThrow();

        expect(lookups).toBe(2);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('is present locally'));
        mod.default();
        expect(lookups).toBe(2);
    });

    test('reports the pull failure when the image is still absent afterwards', async () => {
        const { mod, execFileSync } = await importFresh();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        execFileSync.mockClear();
        execFileSync.mockImplementation((cmd, args) => {
            if (args[0] === 'image' && args[1] === 'inspect') throw new Error('No such image');
            if (args[0] === 'pull') throw new Error('Command failed: docker pull');
            return '';
        });

        expect(() => mod.default()).toThrow(/docker pull/);
        expect(execFileSync.mock.calls.filter(([, args]) => args[1] === 'inspect')).toHaveLength(2);
    });

    test('checks availability only once per process', async () => {
        const { mod, execFileSync } = await importFresh();
        execFileSync.mockReturnValue('');

        mod.default();
        const callsAfterFirst = execFileSync.mock.calls.length;
        mod.default();

        expect(execFileSync.mock.calls.length).toBe(callsAfterFirst);
    });

    test('tracks each platform ref separately', async () => {
        const { mod, execFileSync } = await importFresh();
        execFileSync.mockReturnValue('');

        mod.default();
        const callsAfterDefault = execFileSync.mock.calls.length;
        mod.default('android', 'linux/amd64');
        expect(execFileSync).toHaveBeenCalledWith(
            'docker',
            ['image', 'inspect', mod.getDockerImage('android', 'linux/amd64')],
            expect.objectContaining({ stdio: 'ignore' }),
        );
        expect(execFileSync.mock.calls.length).toBeGreaterThan(callsAfterDefault);

        const callsAfterAmd64 = execFileSync.mock.calls.length;
        mod.default('android', 'linux/amd64');
        expect(execFileSync.mock.calls.length).toBe(callsAfterAmd64);
    });
});
