import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { getFileHash } from '../src/utils/hash.js';

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
vi.mock('../src/state/refreshConanDependencies.js', () => ({ default: vi.fn(() => false) }));

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
// createBridgeFile keys its cache by the header path as upath resolves it: forward slashes on every OS.
const cachedInterface = (file) => holder.cache.interfaces[upath.resolve(file)];

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

    // SWIG binds fields since the bridge format swig-fields-1, so a bridge an older crossbind cached is generated again.
    test('regenerates a bridge cached in the format before SWIG bound fields', async () => {
        const { run, createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'struct S { int kept; };\n');
        createBridgeFile(header, target);
        const interfaceFile = cachedInterface(header);
        holder.cache.hashes[interfaceFile] = `${getFileHash(interfaceFile)}\n${getFileHash(upath.resolve(header))}`;

        createBridgeFile(header, target);

        expect(swigRuns(run)).toHaveLength(2);
    });

    // Every bridge carries the SWIG fork's runtime, and all bridges of a module must carry the same one.
    test('regenerates a bridge cached in the format before SWIG bound constants', async () => {
        const { run, createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'struct S { int kept; };\n');
        createBridgeFile(header, target);
        const interfaceFile = cachedInterface(header);
        holder.cache.hashes[interfaceFile] = ['swig-fields-1', getFileHash(interfaceFile), getFileHash(upath.resolve(header))].join('\n');

        createBridgeFile(header, target);

        expect(swigRuns(run)).toHaveLength(2);
    });

    // A package that stops shipping its .i, or ships another one, must not keep binding through the old copy.
    test('regenerates an interface copied from a shipped .i once that file goes', async () => {
        const { createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'int one();\n');
        const shipped = header.replace(/\.h$/, '.i');
        fs.writeFileSync(shipped, '%module FIXTURE\n%inline %{ int wrapped() { return 1; } %}\n');
        createBridgeFile(header, target);
        expect(fs.readFileSync(cachedInterface(header), 'utf8')).toContain('wrapped');

        fs.rmSync(shipped);
        createBridgeFile(header, target);

        expect(fs.readFileSync(cachedInterface(header), 'utf8')).not.toContain('wrapped');
    });

    // A build hides SWIG's output, so the SWIG fork writes the bindings it skipped beside the bridge.
    test('shows the bindings SWIG skipped when it generates the bridge, and stays quiet for a cached one', async () => {
        const { run, createBridgeFile } = await importFresh();
        run.mockImplementation((program, args) => {
            const out = args[args.indexOf('-o') + 1];
            fs.writeFileSync(out, program === 'swig' ? 'EMSCRIPTEN_BINDINGS(fixture) {}\n' : '');
            if (program === 'swig') fs.writeFileSync(`${out}.warnings`, '/tmp/crossbind/live/src/native/fixture.h:1: Static method length cannot become a property of a JavaScript class, skipped.\n');
            return '';
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'struct C { static int length(); };\n');

        createBridgeFile(header, target);
        createBridgeFile(header, target);

        expect(warn.mock.calls.filter(([message]) => message.includes('Static method'))).toEqual([
            ['crossbind: fixture.h:1: Static method length cannot become a property of a JavaScript class, skipped.'],
        ]);
    });

    test('regenerates the interface once Conan packages are staged, and when one moves to another version', async () => {
        const { run, createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'int one();\n');
        holder.config.conanDependencies = { zlib: { version: '[>=1.3 <2]', options: {} } };
        const zlib = (ref) => ({ general: { name: 'conan_zlib', conan: { name: 'zlib', ref } }, paths: { output: path.join(work, 'zlib', 'dist') }, export: {} });

        createBridgeFile(header, target);
        holder.config.allDependencies = [zlib('zlib/1.3.1#a')];
        createBridgeFile(header, target);
        createBridgeFile(header, target);
        holder.config.allDependencies = [zlib('zlib/1.3.2#b')];
        createBridgeFile(header, target);

        expect(swigRuns(run)).toHaveLength(3);
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
        expect(cachedInterface(plain)).not.toBe(cachedInterface(cpp));
        expect(fs.readFileSync(first, 'utf8')).toContain(cachedInterface(plain));
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
        expect(cachedInterface(android)).toBe(cachedInterface(ios));
    });
});

// SWIG binds a constant only when the app imports it, so the interface carries the names the app's sources take.
describe('constants the app imports', () => {
    const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
    const writeApp = (text) => fs.writeFileSync(path.join(work, 'src', 'main.js'), text);
    const interfaceText = () => fs.readFileSync(cachedInterface(header), 'utf8');

    beforeEach(() => {
        fs.writeFileSync(header, '#define ANSWER 42\n#define OTHER 7\nint one();\n');
    });

    test('asks SWIG to bind the names the app imports from the header', async () => {
        const { createBridgeFile } = await importFresh();
        writeApp("import { initNative, ANSWER, one } from './native/fixture.h';\n");

        createBridgeFile(header, target);

        expect(interfaceText()).toContain('%feature("embind:constant") ANSWER;\n%feature("embind:constant") one;\n');
        expect(interfaceText()).not.toContain('initNative');
    });

    test('regenerates the interface when the app imports another name', async () => {
        const { createBridgeFile } = await importFresh();
        writeApp("import { ANSWER } from './native/fixture.h';\n");
        createBridgeFile(header, target);

        writeApp("import { ANSWER, OTHER } from './native/fixture.h';\n");
        createBridgeFile(header, target);

        expect(interfaceText()).toContain('%feature("embind:constant") OTHER;');
    });

    test('asks for nothing when the app imports only from other headers', async () => {
        const { createBridgeFile } = await importFresh();
        writeApp("import { ANSWER } from './native/other.h';\n");

        createBridgeFile(header, target);

        expect(interfaceText()).not.toContain('embind:constant');
    });

    // The conformance kit is a plain workspace package, not a crossbind dependency: Node resolves its headers.
    test('asks for the names the app imports through a package that is not a crossbind dependency', async () => {
        const { createBridgeFile } = await importFresh();
        const kitHeader = path.join(work, 'kit', 'native', 'kit.h');
        fs.mkdirSync(path.dirname(kitHeader), { recursive: true });
        fs.writeFileSync(path.join(work, 'kit', 'package.json'), '{ "name": "kitpkg" }\n');
        fs.writeFileSync(kitHeader, '#define KIT_ANSWER 42\n');
        fs.mkdirSync(path.join(work, 'node_modules'));
        fs.symlinkSync(path.join(work, 'kit'), path.join(work, 'node_modules', 'kitpkg'), 'dir');
        writeApp("import { KIT_ANSWER } from 'kitpkg/native/kit.h';\n");

        createBridgeFile(kitHeader, target);

        expect(fs.readFileSync(cachedInterface(kitHeader), 'utf8')).toContain('%feature("embind:constant") KIT_ANSWER;');
    });

    test('asks for every constant when the app imports the whole header', async () => {
        const { createBridgeFile } = await importFresh();
        writeApp("import * as fixture from './native/fixture.h';\n");

        createBridgeFile(header, target);

        expect(interfaceText()).toContain('%feature("embind:constant");\n');
    });

    test('defines an imported constant that a header the header includes provides', async () => {
        const { run, createBridgeFile } = await importFresh();
        run.mockImplementation((program, args) => {
            const out = args[args.indexOf('-o') + 1];
            fs.writeFileSync(out, program === 'swig' ? 'EMSCRIPTEN_BINDINGS(fixture) {}\n' : (out.endsWith('fixture.macros.h') ? '#define MAX_WBITS 15\n' : ''));
            return '';
        });
        writeApp("import { MAX_WBITS } from './native/fixture.h';\n");

        createBridgeFile(header, target);

        expect(interfaceText()).toContain('%feature("embind:constant") MAX_WBITS;');
        expect(interfaceText()).toContain('#define MAX_WBITS 15\n');
    });
});

// A dependency root is matched as text: a project path can hold regex characters.
describe('a dependency header under a path with regex characters', () => {
    // crossbind's state holds paths with forward slashes on every OS (getAbsolutePath resolves them with upath).
    test.each(['c++', 'Work (old)'])('is included by its path under the include root (%s)', async (dir) => {
        const { createBridgeFile } = await importFresh();
        const base = upath.join(upath.normalize(work), dir);
        const include = upath.join(base, 'deps', 'libfixture', 'prebuilt', 'include');
        fs.mkdirSync(upath.join(include, 'sub'), { recursive: true });
        const dependencyHeader = upath.join(include, 'sub', 'lib.h');
        fs.writeFileSync(dependencyHeader, 'struct S {\n  int kept;\n};\n');
        holder.config.paths.base = base;
        holder.config.dependencyParameters.getCmakeDependsPathAndName = () => ({ pathsOfCmakeDepends: [upath.join(base, 'deps', 'libfixture')] });

        createBridgeFile(dependencyHeader, { platform: 'wasm', path: 'wasm-wasm32-st-release' });

        expect(fs.readFileSync(cachedInterface(dependencyHeader), 'utf8')).toContain('%include "sub/lib.h"');
    });
});

