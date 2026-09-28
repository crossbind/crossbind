import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
vi.mock('../src/state/calculateDependencyParameters.js', () => ({ default: () => ({ recalculated: true }) }));
vi.mock('../src/utils/dirLock.js', () => ({ default: async (_lock, fn) => fn() }));
vi.mock('../src/actions/target.js', () => ({ getBuildTargets: () => holder.targets }));
vi.mock('../src/utils/rustSysroot.js', () => ({ prepareRustSysroot: async () => null }));
vi.mock('../src/actions/buildExternal.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/createXCFramework.js', () => ({ default: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), doneStep: vi.fn() } }));
vi.mock('../src/utils/embindRsFingerprint.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getEmbindRsFingerprint: () => 'current',
}));

const TARGET = { path: 'wasm-wasm32-mt-release', platform: 'wasm' };

let work;

// A built target's prebuilt, stamped with the embind-rs it was built from.
function writePrebuilt(dep, fingerprint = 'current') {
    const dir = `${dep.paths.output}/prebuilt/${TARGET.path}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/crossbind-embind-rs.fingerprint`, fingerprint);
}

function cargoDep(name, { enabled = false, fingerprint = 'current' } = {}) {
    const own = { enabled };
    const dep = {
        general: { name },
        export: { type: 'cargo', libName: [name] },
        paths: { project: `${work}/${name}`, output: `${work}/${name}/dist` },
        functions: { isEnabled: () => own.enabled },
        markBuilt: () => { own.enabled = true; writePrebuilt(dep); },
    };
    if (enabled) writePrebuilt(dep, fingerprint);
    return dep;
}

async function run(deps) {
    vi.resetModules();
    built.length = 0;
    holder.targets = [TARGET];
    holder.config = { paths: { base: '/app', cache: '/app/.crossbind' }, allDependencies: deps, system: {} };
    const { default: buildDependencies } = await import('../src/actions/buildDependencies.js');
    return buildDependencies({ targetParams: {} });
}

beforeEach(() => {
    holder.onBuild = null;
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cargo-deps-'));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

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

    // An archive from another embind-rs carries its old glue, and next to one built after it every embind_rs
    // symbol is defined twice.
    test('rebuilds a cargo dependency built from another embind-rs', async () => {
        const dep = cargoDep('demo', { enabled: true, fingerprint: 'older' });
        holder.onBuild = () => dep.markBuilt();

        await expect(run([dep])).resolves.toBeUndefined();

        expect(built.length).toBe(1);
    });

    test('refuses a cargo dependency still built from another embind-rs after building', async () => {
        const dep = cargoDep('demo', { enabled: true, fingerprint: 'older' });

        await expect(run([dep])).rejects.toThrow(/"demo" still has no prebuilt built from the current embind-rs/);
    });

    // loadConfig resolves a package's CMakeLists before its first build, when only the CLI's own exists.
    test('reads a never-built cargo dependency from the prebuilt its build writes', async () => {
        const cli = `${work}/cli/assets/cmake`;
        const dep = {
            general: { name: 'demo' },
            export: { type: 'cargo', libName: ['demo'] },
            paths: { project: `${work}/demo`, output: `${work}/demo/dist`, cmake: `${cli}/CMakeLists.txt`, cmakeDir: cli },
            functions: { isEnabled: (target) => fs.existsSync(`${dep.paths.cmakeDir}/${target.path}`) },
        };
        holder.onBuild = () => {
            writePrebuilt(dep);
            fs.writeFileSync(`${dep.paths.output}/prebuilt/CMakeLists.txt`, '');
        };

        await expect(run([dep])).resolves.toBeUndefined();

        expect(dep.paths.cmakeDir.endsWith('/demo/dist/prebuilt')).toBe(true);
        expect(holder.config.dependencyParameters).toEqual({ recalculated: true });
    });
});
