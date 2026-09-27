import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';

// The bridge depends on the header's declarations, but the interface text only names the header:
// a cache keyed on the interface alone kept stale bindings across header edits.
vi.mock('../src/actions/run.js', () => ({
    default: vi.fn(),
    cxxPreprocessorFor: () => 'em++',
}));

const holder = { config: {}, cache: {} };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() { return holder.config; },
        get cache() { return holder.cache; },
        get targets() { return [{ platform: 'wasm', path: 'wasm-wasm32-st-release' }]; },
    },
    saveCache: vi.fn(),
}));

let work;
let header;

async function importFresh() {
    vi.resetModules();
    const { default: run } = await import('../src/actions/run.js');
    run.mockReset();
    run.mockImplementation((program, args) => {
        const out = args[args.indexOf('-o') + 1];
        fs.writeFileSync(out, program === 'swig' ? 'EMSCRIPTEN_BINDINGS(fixture) {}\n' : '');
        return '';
    });
    const { default: createBridgeFile } = await import('../src/actions/createInterface.js');
    return { run, createBridgeFile };
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridge-'));
    const native = path.join(work, 'src', 'native');
    fs.mkdirSync(native, { recursive: true });
    header = path.join(native, 'fixture.h');
    holder.config = {
        paths: { project: work, build: path.join(work, '.crossbind', 'build'), cache: path.join(work, '.crossbind'), header: [native] },
        ext: { header: ['h', 'hpp', 'hxx', 'hh'], module: ['i'] },
        dts: 'sync',
        export: {},
        allDependencies: [],
        dependencyParameters: { headerPathWithDepends: '', getCmakeDependsPathAndName: () => ({ pathsOfCmakeDepends: [] }) },
    };
    holder.cache = { interfaces: {}, hashes: {}, bridges: {} };
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
});

const swigRuns = (run) => run.mock.calls.filter(([program]) => program === 'swig');

describe('createBridgeFile', () => {
    test('regenerates the bridge when the header changes but the interface text does not', async () => {
        const { run, createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'int one();\n');
        createBridgeFile(header, target);
        expect(swigRuns(run)).toHaveLength(1);

        fs.writeFileSync(header, 'int one();\nint two();\n');
        createBridgeFile(header, target);

        expect(swigRuns(run)).toHaveLength(2);
    });

    test('reuses the bridge while the header is unchanged', async () => {
        const { run, createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'int one();\n');
        createBridgeFile(header, target);
        createBridgeFile(header, target);

        expect(swigRuns(run)).toHaveLength(1);
    });

    test('reads the header with NDEBUG defined, as the release compile does, but not the predefined macros', async () => {
        const { run, createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'int one();\n');
        createBridgeFile(header, target);

        const dumps = run.mock.calls.filter(([, args]) => args.includes('-dM'));
        const [headerDump] = dumps.filter(([, args]) => args.at(-2).endsWith('fixture.macros.h'));
        const [predefinedDump] = dumps.filter(([, args]) => args.at(-2).includes('predefined-'));
        expect(headerDump[1]).toContain('-DNDEBUG');
        expect(predefinedDump[1]).not.toContain('-DNDEBUG');
    });
});

// tiffio.h and tiffio.hxx, or one name in two directories: each header keeps its own interface and bridge.
describe('headers with the same base name', () => {
    test('get separate interfaces and bridges', async () => {
        const { run, createBridgeFile } = await importFresh();
        run.mockImplementation((program, args) => {
            const out = args[args.indexOf('-o') + 1];
            fs.writeFileSync(out, program === 'swig' ? `// from ${args.at(-1)}\n` : '');
            return '';
        });
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        const plain = path.join(path.dirname(header), 'tiffio.h');
        const cpp = path.join(path.dirname(header), 'tiffio.hxx');
        fs.writeFileSync(plain, 'int TIFFOpen();\n');
        fs.writeFileSync(cpp, 'int TIFFStreamOpen();\n');

        const first = createBridgeFile(plain, target);
        const second = createBridgeFile(cpp, target);

        expect(second).not.toBe(first);
        expect(holder.cache.interfaces[plain]).not.toBe(holder.cache.interfaces[cpp]);
        expect(fs.readFileSync(first, 'utf8')).toContain(holder.cache.interfaces[plain]);
        expect(createBridgeFile(plain, target)).toBe(first);
    });

    // An app built for iOS and Android imports one package header, which each platform's build of the package ships.
    test('from the platform builds of one package share an interface and a bridge', async () => {
        const { run, createBridgeFile } = await importFresh();
        run.mockImplementation((program, args) => {
            const out = args[args.indexOf('-o') + 1];
            fs.writeFileSync(out, program === 'swig' ? `// from ${args.at(-1)}\n` : '');
            return '';
        });
        const copy = (platform, target) => {
            const include = path.join(work, 'deps', 'libfixture', platform, 'dist', 'prebuilt', target, 'include');
            fs.mkdirSync(include, { recursive: true });
            fs.writeFileSync(path.join(include, 'lib.h'), 'int libVersion();\n');
            return path.join(include, 'lib.h');
        };
        const ios = copy('ios', 'ios-iphonesimulator-mt-release');
        const android = copy('android', 'android-arm64-v8a-mt-release');

        const fromIos = createBridgeFile(ios, { platform: 'ios', path: 'ios-iphonesimulator-mt-release' });
        const fromAndroid = createBridgeFile(android, { platform: 'android', path: 'android-arm64-v8a-mt-release' });

        expect(fromAndroid).toBe(fromIos);
        expect(holder.cache.interfaces[android]).toBe(holder.cache.interfaces[ios]);
    });
});

// A dependency's header binds the fields the compiler sees: an #if branch the build leaves out stays out,
// and a field typed through a typedef of another header still reads as a number.
describe('fields of a dependency header', () => {
    // crossbind's state holds paths with forward slashes on every OS (getAbsolutePath resolves them with upath).
    function dependencyFixture(headerText, root = work) {
        const base = upath.normalize(root);
        const include = upath.join(base, 'deps', 'libfixture', 'prebuilt', 'include');
        fs.mkdirSync(include, { recursive: true });
        const dependencyHeader = upath.join(include, 'lib.h');
        fs.writeFileSync(dependencyHeader, headerText);
        holder.config.paths.base = base;
        holder.config.dependencyParameters.getCmakeDependsPathAndName = () => ({ pathsOfCmakeDepends: [upath.join(base, 'deps', 'libfixture')] });
        return { include, dependencyHeader };
    }

    test('come from the preprocessed header', async () => {
        const { run, createBridgeFile } = await importFresh();
        const { include, dependencyHeader } = dependencyFixture('#include "types.h"\nstruct S {\n#if VERSION >= 70\n  int gone;\n#endif\n  int kept;\n  uInt avail;\n};\n');
        run.mockImplementation((program, args) => {
            const out = args[args.indexOf('-o') + 1];
            if (program === 'swig') fs.writeFileSync(out, 'EMSCRIPTEN_BINDINGS(S) {\n  emscripten::class_<S>("S")\n  ;\n}\n');
            else if (args.includes('-dM')) fs.writeFileSync(out, '');
            else fs.writeFileSync(out, `# 1 "${include}/types.h" 1\ntypedef unsigned int uInt;\n# 2 "${include}/lib.h" 2\nstruct S {\n  int kept;\n  uInt avail;\n};\n`);
            return '';
        });

        const bridge = fs.readFileSync(createBridgeFile(dependencyHeader, { platform: 'wasm', path: 'wasm-wasm32-st-release' }), 'utf8');

        expect(bridge).toContain('.property("kept", &S::kept)');
        expect(bridge).toContain('.property("avail", &S::avail)');
        expect(bridge).not.toContain('"gone"');
    });

    test('bind pointer fields as handles and enum fields as integers', async () => {
        const { run, createBridgeFile } = await importFresh();
        const { include, dependencyHeader } = dependencyFixture('typedef enum { OFF, ON } Mode;\ntypedef struct S *S_ptr;\nstruct S {\n  const void *data;\n  Mode mode;\n  S_ptr next;\n};\n');
        const prelude = 'namespace crossbind {\ntemplate<typename Q> PointerHandle toHandle(Q *p) { return nullptr; }\n}\n';
        run.mockImplementation((program, args) => {
            const out = args[args.indexOf('-o') + 1];
            if (program === 'swig') fs.writeFileSync(out, `${prelude}EMSCRIPTEN_BINDINGS(S) {\n  emscripten::class_<S>("S")\n  ;\n}\n`);
            else if (args.includes('-dM')) fs.writeFileSync(out, '');
            else fs.writeFileSync(out, `# 1 "${include}/lib.h" 1\ntypedef enum { OFF, ON } Mode;\ntypedef struct S *S_ptr;\nstruct S {\n  const void *data;\n  Mode mode;\n  S_ptr next;\n};\n`);
            return '';
        });

        const bridge = fs.readFileSync(createBridgeFile(dependencyHeader, { platform: 'wasm', path: 'wasm-wasm32-st-release' }), 'utf8');

        expect(bridge).toContain('crossbind_fields::set<decltype(S::data)>(v)');
        expect(bridge).toContain('std::underlying_type_t<decltype(S::mode)>');
        expect(bridge).toContain('crossbind_fields::set<decltype(S::next)>(v)');
    });

    // A dependency root is matched as text: a project path can hold regex characters.
    test.each(['c++', 'Work (old)'])('come from the preprocessed header under a path with %s in it', async (dir) => {
        const { run, createBridgeFile } = await importFresh();
        const { include, dependencyHeader } = dependencyFixture('struct S {\n  int kept;\n};\n', upath.join(work, dir));
        run.mockImplementation((program, args) => {
            const out = args[args.indexOf('-o') + 1];
            if (program === 'swig') fs.writeFileSync(out, 'EMSCRIPTEN_BINDINGS(S) {\n  emscripten::class_<S>("S")\n  ;\n}\n');
            else if (args.includes('-dM')) fs.writeFileSync(out, '');
            else fs.writeFileSync(out, `# 1 "${include}/lib.h" 1\nstruct S {\n  int kept;\n  int avail;\n};\n`);
            return '';
        });

        const bridge = fs.readFileSync(createBridgeFile(dependencyHeader, { platform: 'wasm', path: 'wasm-wasm32-st-release' }), 'utf8');

        expect(bridge).toContain('.property("avail", &S::avail)');
    });
});

