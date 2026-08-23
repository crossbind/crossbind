import {
    describe, test, expect, vi, beforeEach,
} from 'vitest';

// A cargo dependency carries every target in one package, so a missing prebuilt always means it
// was never built - never "this sibling is for another platform". Nothing else builds these, and
// the cmake link only notices while it is being configured: a cached native build skipped the
// check entirely, and the module then died at init (measured: BUILD=0, 22 of 43 conformance
// features dead). These pin both halves - the build, and the guard behind it.

const holder = { config: null, targets: [], onBuild: null };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() { return holder.config; },
        set config(v) { holder.config = v; },
        get targets() { return holder.targets; },
    },
    setAllDependecyPaths: vi.fn(),
}));

const built = [];
// The real buildLib is what puts the prebuilt on disk, which is what flips isEnabled.
vi.mock('../src/actions/buildLib.js', () => ({
    default: (params) => { built.push(params); holder.onBuild?.(); },
}));
vi.mock('../src/state/loadConfig.js', () => ({ default: async () => ({ scoped: true }) }));
vi.mock('../src/utils/dirLock.js', () => ({ default: async (_lock, fn) => fn() }));
vi.mock('../src/actions/target.js', () => ({ getBuildTargets: () => holder.targets }));
vi.mock('../src/utils/rustSysroot.js', () => ({ prepareRustSysroot: async () => null }));
vi.mock('../src/actions/buildExternal.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/createXCFramework.js', () => ({ default: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), doneStep: vi.fn() } }));

const TARGET = { path: 'wasm-wasm32-mt-release', platform: 'wasm' };

function cargoDep(name, { enabled = false } = {}) {
    const own = { enabled };
    return {
        general: { name },
        export: { type: 'cargo', libName: [name] },
        paths: { project: `/pkgs/${name}`, output: `/pkgs/${name}/dist` },
        functions: { isEnabled: () => own.enabled },
        markBuilt: () => { own.enabled = true; },
    };
}

async function run(deps) {
    vi.resetModules();
    built.length = 0;
    holder.targets = [TARGET];
    holder.config = { paths: { base: '/app', cache: '/app/.crossbind' }, allDependencies: deps, system: {} };
    const { default: buildDependencies } = await import('../src/actions/buildDependencies.js');
    return buildDependencies({ targetParams: {} });
}

beforeEach(() => { holder.onBuild = null; });

describe('cargo dependencies build themselves', () => {
    test('builds a cargo dependency that has no prebuilt for this target', async () => {
        // The requirement: an app with a plugin must not need a manual pre-build step.
        const dep = cargoDep('demo');
        holder.onBuild = () => dep.markBuilt();

        await expect(run([dep])).resolves.toBeUndefined();

        expect(built.length).toBe(1);
        expect(dep.functions.isEnabled(TARGET)).toBe(true);
    });

    test('leaves an already-built cargo dependency alone', async () => {
        const dep = cargoDep('demo', { enabled: true });
        await run([dep]);
        expect(built.length).toBe(0);
    });

    test('ignores dependencies that are not cargo packages', async () => {
        // A platform-split port legitimately serves only some targets, so a miss is not an error.
        await run([{
            general: { name: 'zlib' },
            export: { type: 'cmake', libName: ['z'] },
            paths: { project: '/pkgs/zlib', output: '/pkgs/zlib/dist' },
            functions: { isEnabled: () => false },
        }]);
        expect(built.length).toBe(0);
    });

    test('refuses to continue when the build produced no prebuilt', async () => {
        // Without this the link silently drops the dependency: the module builds clean and dies at
        // init, which is far worse than a failed build.
        const dep = cargoDep('demo');
        holder.onBuild = null; // the build ran but produced nothing

        await expect(run([dep])).rejects.toThrow(/"demo" still has no prebuilt[\s\S]*dies at init/);
        expect(built.length).toBe(1);
    });
});
