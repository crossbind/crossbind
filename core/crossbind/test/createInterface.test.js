import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { getFileHash } from '../src/utils/hash.js';
import calculateDependencyParameters from '../src/state/calculateDependencyParameters.js';
import { getCliCMakeListsFile } from '../src/utils/getCMakeListsFilePath.js';

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

    // The conformance kit reads a constant it did not import through AllSymbols and expects it unbound.
    test('asks only for the named constants when the app also imports AllSymbols', async () => {
        const { createBridgeFile } = await importFresh();
        writeApp("import { AllSymbols, initNative, ANSWER } from './native/fixture.h';\n");

        createBridgeFile(header, target);

        expect(interfaceText()).toContain('%feature("embind:constant") ANSWER;\n');
        expect(interfaceText()).not.toContain('%feature("embind:constant");');
    });

    test('asks for no constant when the app imports only initNative', async () => {
        const { createBridgeFile } = await importFresh();
        writeApp("import { initNative } from './native/fixture.h';\n");

        createBridgeFile(header, target);

        expect(interfaceText()).not.toContain('embind:constant');
    });

    test('asks for every constant when the app imports the whole header', async () => {
        const { createBridgeFile } = await importFresh();
        writeApp("import * as fixture from './native/fixture.h';\n");

        createBridgeFile(header, target);

        expect(interfaceText()).toContain('%feature("embind:constant");\n');
    });

    test('puts the SWIG lines its package lists in swigPreamble before the header', async () => {
        const { createBridgeFile } = await importFresh();
        holder.config.export = { swigPreamble: { 'fixture.h': ['#undef SWIG'] } };

        createBridgeFile(header, target);

        expect(interfaceText()).toContain('#undef SWIG\n\n%include "fixture.h"');
    });

    describe('with includes its package lists in swigInlineIncludes', () => {
        const values = () => path.join(path.dirname(header), 'values.inc');

        beforeEach(() => {
            fs.writeFileSync(values(), 'ValuePair(Two, 2)\n');
            fs.writeFileSync(header, '#define ValuePair(name, value) name = value,\ntypedef enum {\n#include "values.inc"\n  End = 9\n} value_t;\n');
            holder.config.export = { swigInlineIncludes: { 'fixture.h': ['values.inc'] } };
        });

        test('has SWIG read the header with those includes inlined, ahead of the real one', async () => {
            const { run, createBridgeFile } = await importFresh();

            createBridgeFile(header, target);

            const view = swigRuns(run).at(-1)[1].find((arg) => arg.startsWith('-I')).slice(2);
            expect(fs.readFileSync(upath.join(view, 'fixture.h'), 'utf8')).toContain('typedef enum {\nValuePair(Two, 2)\n');
        });

        test('regenerates the bridge when an inlined include changes', async () => {
            const { run, createBridgeFile } = await importFresh();
            createBridgeFile(header, target);
            fs.writeFileSync(values(), 'ValuePair(Two, 2)\nValuePair(Three, 3)\n');

            createBridgeFile(header, target);

            expect(swigRuns(run)).toHaveLength(2);
        });
    });

    // A package that ships a dependency header's bindings has no app importing it.
    test('asks for every constant of a header the build binds whole', async () => {
        const { createBridgeFile } = await importFresh();

        createBridgeFile(header, target, { wholeHeaders: [header] });

        expect(interfaceText()).toContain('%feature("embind:constant");\n');
    });

    // A header the build binds whole is generated again as the dependency of a later one that uses its types.
    test('keeps every constant of a header the build binds whole when another one uses its types', async () => {
        const { createBridgeFile } = await importFresh();
        // The include root is matched against the header as text, so both take upath's slashes on every OS.
        const root = upath.normalize(path.dirname(header));
        holder.config.paths.header = [root];
        const box = upath.join(root, 'box.h');
        fs.writeFileSync(box, '#define BOX_SIDES 4\nstruct Box {\n  int side;\n};\n');
        fs.writeFileSync(header, '#include "box.h"\nint area(struct Box *box);\n');

        const wholeHeaders = [box, header];

        const [boxBridge, bridge] = wholeHeaders.map((file) => createBridgeFile(file, target, { wholeHeaders }));

        expect(fs.readFileSync(`${bridge}.deps`, 'utf8')).toContain(boxBridge);
        expect(fs.readFileSync(cachedInterface(box), 'utf8')).toContain('%feature("embind:constant");\n');
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

// One bridge serves every desktop target, so SWIG reads a header in the web image's em++, which defines no
// operating system; an android bridge must match the NDK it compiles with.
describe('the image SWIG reads a header in', () => {
    const toolPlatforms = (run) => new Set(run.mock.calls.map(([, , , target]) => target.platform));

    test('is the web image for a desktop target', async () => {
        const { run, createBridgeFile } = await importFresh();
        fs.writeFileSync(header, 'int one();\n');

        createBridgeFile(header, { platform: 'linux', arch: 'x64', path: 'linux-x64-mt-release' });

        expect(toolPlatforms(run)).toEqual(new Set(['wasm']));
    });

    test('is the android image for an android target', async () => {
        const { run, createBridgeFile } = await importFresh();
        fs.writeFileSync(header, 'int one();\n');

        createBridgeFile(header, { platform: 'android', arch: 'arm64-v8a', path: 'android-arm64-v8a-mt-release' });

        expect(toolPlatforms(run)).toEqual(new Set(['android']));
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

// libpng installs its headers in include/ and again in include/libpng16/.
describe('a dependency header installed twice under one include root', () => {
    const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
    let include;

    beforeEach(() => {
        const base = upath.normalize(work);
        include = upath.join(base, 'deps', 'libpng', 'prebuilt', 'include');
        fs.mkdirSync(upath.join(include, 'libpng16'), { recursive: true });
        for (const dir of [include, upath.join(include, 'libpng16')]) {
            fs.writeFileSync(upath.join(dir, 'png.h'), 'typedef struct png_color_struct {\n  int red;\n} png_color;\nint png_count(png_color *color);\n');
        }
        fs.writeFileSync(upath.join(include, 'pngextra.h'), '#include "png.h"\nint png_extra(png_color *color);\n');
        holder.config.paths.base = base;
        holder.config.dependencyParameters.getCmakeDependsPathAndName = () => ({ pathsOfCmakeDepends: [upath.join(base, 'deps', 'libpng')] });
    });

    test.each(['png.h', 'libpng16/png.h'])('binds %s without its copy', async (headerPath) => {
        const { createBridgeFile } = await importFresh();

        const bridge = createBridgeFile(upath.join(include, headerPath), target);

        expect(fs.readFileSync(`${bridge}.deps`, 'utf8')).toBe('');
    });

    test('gives a header using its types one dependency bridge', async () => {
        const { createBridgeFile } = await importFresh();

        const bridge = createBridgeFile(upath.join(include, 'pngextra.h'), target);

        const dependencies = fs.readFileSync(`${bridge}.deps`, 'utf8').split('\n').filter(Boolean);
        expect(dependencies.map((file) => fs.readFileSync(`${file}.source`, 'utf8'))).toEqual([`${upath.join(include, 'png.h')}\n`]);
    });
});


// A dependency's header binds the free functions the app imports from it: binding them all links code the app never calls.
describe('free functions of a dependency header', () => {
    const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
    const IGNORE_FUNCTIONS = '%rename($ignore, %$isfunction, %$isglobal) "";';
    const SPECIFIER = '../deps/libfixture/prebuilt/include/lib.h';
    const writeApp = (text) => fs.writeFileSync(path.join(work, 'src', 'main.js'), text);
    const interfaceOf = (file) => fs.readFileSync(cachedInterface(file), 'utf8');
    let include;
    let libHeader;

    beforeEach(() => {
        const base = upath.normalize(work);
        include = upath.join(base, 'deps', 'libfixture', 'prebuilt', 'include');
        fs.mkdirSync(include, { recursive: true });
        libHeader = upath.join(include, 'lib.h');
        fs.writeFileSync(libHeader, 'int one();\nint two();\n');
        holder.config.paths.base = base;
        holder.config.dependencyParameters.getCmakeDependsPathAndName = () => ({ pathsOfCmakeDepends: [upath.join(base, 'deps', 'libfixture')] });
    });

    test('binds the functions the app imports and no other', async () => {
        const { createBridgeFile } = await importFresh();
        writeApp(`import { one } from '${SPECIFIER}';\n`);

        createBridgeFile(libHeader, target);

        expect(interfaceOf(libHeader)).toContain(`${IGNORE_FUNCTIONS}\n%rename("%s") one;\n\n%include "lib.h"`);
    });

    test.each([
        ['a namespace import', `import * as lib from '${SPECIFIER}';`],
        ['a dynamic import', `const lib = await import('${SPECIFIER}');`],
        ['initNative alone', `import { initNative } from '${SPECIFIER}';`],
        ['AllSymbols', `import { AllSymbols, one } from '${SPECIFIER}';`],
    ])('binds every function when the app takes the whole module through %s', async (_, line) => {
        const { createBridgeFile } = await importFresh();
        writeApp(`${line}\n`);

        createBridgeFile(libHeader, target);

        expect(interfaceOf(libHeader)).not.toContain('%rename');
    });

    // A boot file takes initNative, the features import what they call.
    test('binds the named functions when another source imports only initNative', async () => {
        const { createBridgeFile } = await importFresh();
        fs.writeFileSync(path.join(work, 'src', 'boot.js'), `import { initNative } from '${SPECIFIER}';\n`);
        writeApp(`import { one } from '${SPECIFIER}';\n`);

        createBridgeFile(libHeader, target);

        expect(interfaceOf(libHeader)).toContain(`${IGNORE_FUNCTIONS}\n%rename("%s") one;\n\n%include "lib.h"`);
    });

    // A package's own .i says what the header binds.
    test('leaves a header that ships its own interface to that file, without a warning', async () => {
        const { createBridgeFile } = await importFresh();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fs.writeFileSync(upath.join(include, 'lib.i'), '%module LIB\n%{\n#include "lib.h"\n%}\n%include "lib.h"\n');

        createBridgeFile(libHeader, target);

        expect(warn.mock.calls.filter(([message]) => message.includes('lib.h'))).toHaveLength(0);
    });

    test('binds every function of a header the build binds whole', async () => {
        const { createBridgeFile } = await importFresh();
        writeApp(`import { one } from '${SPECIFIER}';\n`);

        createBridgeFile(libHeader, target, { wholeHeaders: [libHeader] });

        expect(interfaceOf(libHeader)).not.toContain('%rename');
    });

    test('binds every function of the project\'s own headers, whatever the app imports', async () => {
        const { createBridgeFile } = await importFresh();
        fs.writeFileSync(header, 'int one();\nint two();\n');
        writeApp("import { one } from './native/fixture.h';\n");

        createBridgeFile(header, target);

        expect(interfaceOf(header)).not.toContain('%rename');
    });

    test('regenerates the bridge when the app imports another function', async () => {
        const { run, createBridgeFile } = await importFresh();
        writeApp(`import { one } from '${SPECIFIER}';\n`);
        createBridgeFile(libHeader, target);

        writeApp(`import { one, two } from '${SPECIFIER}';\n`);
        createBridgeFile(libHeader, target);

        expect(swigRuns(run)).toHaveLength(2);
        expect(interfaceOf(libHeader)).toContain('%rename("%s") one;\n%rename("%s") two;\n');
    });

    // The header bound for the types another one uses registers them; its functions wait for an import of their own.
    test('binds no function of a header bound only for the types another one uses', async () => {
        const { createBridgeFile } = await importFresh();
        const boxHeader = upath.join(include, 'box.h');
        fs.writeFileSync(boxHeader, 'struct Box {\n  int side;\n};\nstruct Box *box_new();\n');
        fs.writeFileSync(libHeader, '#include "box.h"\nint area(struct Box *box);\n');
        writeApp(`import { area } from '${SPECIFIER}';\n`);

        const bridge = createBridgeFile(libHeader, target);

        expect(fs.readFileSync(`${bridge}.deps`, 'utf8')).toContain('box.i.cpp');
        expect(interfaceOf(boxHeader)).toContain(`${IGNORE_FUNCTIONS}\n\n%include "box.h"`);
    });

    // A package that imports the header in its own JavaScript sits in node_modules, which the scan of the app skips.
    test('warns once when nothing the app imports names the header', async () => {
        const { createBridgeFile } = await importFresh();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        createBridgeFile(libHeader, target);
        createBridgeFile(libHeader, target);

        expect(warn.mock.calls.filter(([message]) => message.includes('lib.h'))).toHaveLength(1);
        expect(interfaceOf(libHeader)).toContain(`${IGNORE_FUNCTIONS}\n\n%include "lib.h"`);
    });
});

// The editor's types of a conan: import come from a SWIG run over the whole header, apart from the bridge.
describe('a header staged from Conan', () => {
    const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
    const SPECIFIER = `../.crossbind/conan/packages/zlib/dist/prebuilt/${target.path}/include/zlib.h`;
    const writeApp = (file, text) => fs.writeFileSync(path.join(work, 'src', file), text);
    const declarationsRuns = (run) => swigRuns(run).filter(([, args]) => args.at(-1).includes('/declarations/'));
    let zlibHeader;

    beforeEach(() => {
        const base = upath.normalize(work);
        const packageDir = upath.join(base, '.crossbind', 'conan', 'packages', 'zlib');
        const include = upath.join(packageDir, 'dist', 'prebuilt', target.path, 'include');
        fs.mkdirSync(include, { recursive: true });
        zlibHeader = upath.join(include, 'zlib.h');
        fs.writeFileSync(zlibHeader, 'int zlibVersion();\nint compressBound(int length);\nint gzprintf(void *file, const char *format, ...);\n');
        holder.config.paths.base = base;
        holder.config.paths.cache = upath.join(base, '.crossbind');
        holder.config.dependencyParameters.getCmakeDependsPathAndName = () => ({ pathsOfCmakeDepends: [packageDir] });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    // SWIG reports the variadic function it skips, and writes its pointer runtime only for a pointer binding.
    async function importWithSwig() {
        const fresh = await importFresh();
        fresh.run.mockImplementation((program, args) => {
            const out = args[args.indexOf('-o') + 1];
            if (program !== 'swig') {
                fs.writeFileSync(out, '');
                return '';
            }
            const pointers = fs.readFileSync(args.at(-1), 'utf8').includes('crossbindPointerRuntime');
            fs.writeFileSync(out, pointers ? 'struct NativePointer {};\n' : 'EMSCRIPTEN_BINDINGS(fixture) {}\n');
            fs.writeFileSync(`${out}.exports.json`, '[]\n');
            fs.writeFileSync(`${out}.warnings`, `${zlibHeader}:3: Variable length arguments are not supported by embind, gzprintf skipped.\n`);
            return '';
        });
        return fresh;
    }

    test('runs SWIG over the whole header again for a header change, not for another name imported by name', async () => {
        const { run, createBridgeFile } = await importWithSwig();
        writeApp('boot.js', `import * as zlib from '${SPECIFIER}';\n`);
        writeApp('main.js', `import { zlibVersion } from '${SPECIFIER}';\n`);
        createBridgeFile(zlibHeader, target);

        writeApp('main.js', `import { compressBound, zlibVersion } from '${SPECIFIER}';\n`);
        createBridgeFile(zlibHeader, target);

        expect(swigRuns(run).length - declarationsRuns(run).length).toBe(2);
        expect(declarationsRuns(run)).toHaveLength(1);
    });

    test('leaves the binding that brings in SWIG\'s pointer runtime out of the editor\'s declarations', async () => {
        const { createBridgeFile } = await importWithSwig();
        writeApp('main.js', `import { gzprintf } from '${SPECIFIER}';\n`);

        createBridgeFile(zlibHeader, target);

        expect(fs.readFileSync(cachedInterface(zlibHeader), 'utf8')).toContain('crossbindPointerRuntime');
        expect(fs.readFileSync(path.join(work, '.crossbind', 'build', 'declarations', 'zlib.i'), 'utf8')).not.toContain('crossbindPointerRuntime');
    });
});

// A Metro server started before the port was built for its platform.
describe('a dependency built after the process loaded', () => {
    test('binds the functions the app imports from its header', async () => {
        const { createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        const output = upath.join(upath.normalize(work), 'deps', 'libfixture', 'dist');
        const lib = {
            general: { name: 'libfixture' },
            export: { type: 'cmake' },
            paths: {
                project: upath.dirname(output), output, header: [], cmake: getCliCMakeListsFile(), cmakeDir: upath.dirname(getCliCMakeListsFile()), cliCMakeListsTxt: getCliCMakeListsFile(),
            },
            dependencies: [],
            functions: { isEnabled: (t) => fs.existsSync(`${lib.paths.cmakeDir}/${t.path}`) },
        };
        Object.assign(holder.config, {
            dependencies: [lib], allDependencies: [lib], ext: { ...holder.config.ext, source: ['cpp'] },
        });
        holder.config.paths.base = upath.normalize(work);
        holder.config.paths.cliCMakeListsTxt = getCliCMakeListsFile();
        holder.config.dependencyParameters = calculateDependencyParameters(holder.config);
        const include = upath.join(output, 'prebuilt', target.path, 'include');
        fs.mkdirSync(include, { recursive: true });
        fs.writeFileSync(upath.join(output, 'prebuilt', 'CMakeLists.txt'), '');
        const libHeader = upath.join(include, 'lib.h');
        fs.writeFileSync(libHeader, 'int one();\nint two();\n');
        fs.writeFileSync(path.join(work, 'src', 'main.js'), `import { one } from '../deps/libfixture/dist/prebuilt/${target.path}/include/lib.h';\n`);

        createBridgeFile(libHeader, target);

        expect(fs.readFileSync(cachedInterface(libHeader), 'utf8')).toContain('%rename("%s") one;\n\n%include "lib.h"');
    });
});

// Metro transforms in worker processes, so two of them can bind one header at once.
describe('binding a header from parallel processes', () => {
    const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
    const lockFile = () => path.join(holder.config.paths.build, 'bridge.lock');

    test('holds a lock in the build directory while SWIG runs, and leaves none behind', async () => {
        const { run, createBridgeFile } = await importFresh();
        let isHeldDuringSwig = false;
        run.mockImplementation((program, args) => {
            if (program === 'swig') isHeldDuringSwig = fs.existsSync(lockFile());
            fs.writeFileSync(args[args.indexOf('-o') + 1], program === 'swig' ? 'EMSCRIPTEN_BINDINGS(fixture) {}\n' : '');
            return '';
        });
        fs.writeFileSync(header, 'int one();\n');

        createBridgeFile(header, target);

        expect(isHeldDuringSwig).toBe(true);
        expect(fs.existsSync(lockFile())).toBe(false);
    });

    test('takes over a lock whose holder died', async () => {
        const { createBridgeFile } = await importFresh();
        fs.mkdirSync(path.dirname(lockFile()), { recursive: true });
        fs.writeFileSync(lockFile(), '999999999');
        fs.writeFileSync(header, 'int one();\n');

        expect(createBridgeFile(header, target)).toBeTruthy();
        expect(fs.existsSync(lockFile())).toBe(false);
    });

    // CI restores a committed cache on runners that have no Docker for SWIG.
    test('reuses the interface and bridge a cache from before the keys holds', async () => {
        const { run, createBridgeFile } = await importFresh();
        fs.writeFileSync(header, 'int one();\n');
        const bridge = createBridgeFile(header, target);
        fs.rmSync(`${cachedInterface(header)}.key`);
        fs.rmSync(`${bridge}.key`);

        createBridgeFile(header, target);

        expect(swigRuns(run)).toHaveLength(1);
    });

    // Each process keeps the cache it loaded: the one that bound the header first must not take the interface and bridge
    // another process has rebuilt since for other imports as its own.
    test('rebuilds an interface and bridge another process replaced', async () => {
        const { run, createBridgeFile } = await importFresh();
        run.mockImplementation((program, args) => {
            fs.writeFileSync(args[args.indexOf('-o') + 1], program === 'swig' ? fs.readFileSync(args.at(-1), 'utf8') : '');
            return '';
        });
        const include = upath.join(upath.normalize(work), 'deps', 'libfixture', 'prebuilt', 'include');
        fs.mkdirSync(include, { recursive: true });
        const libHeader = upath.join(include, 'lib.h');
        fs.writeFileSync(libHeader, 'int one();\nint two();\n');
        holder.config.paths.base = upath.normalize(work);
        holder.config.dependencyParameters.getCmakeDependsPathAndName = () => ({ pathsOfCmakeDepends: [upath.join(upath.normalize(work), 'deps', 'libfixture')] });
        const writeApp = (names) => fs.writeFileSync(path.join(work, 'src', 'main.js'), `import { ${names} } from '../deps/libfixture/prebuilt/include/lib.h';\n`);
        writeApp('one, two');
        createBridgeFile(libHeader, target);
        const firstProcess = holder.cache;
        holder.cache = structuredClone(firstProcess);
        writeApp('one');
        createBridgeFile(libHeader, target);
        holder.cache = firstProcess;

        writeApp('one, two');
        const bridge = createBridgeFile(libHeader, target);

        expect(fs.readFileSync(bridge, 'utf8')).toContain('%rename("%s") two;');
    });
});

// The lib-cmake template ships its sources: the app compiles them through the package's own CMakeLists, which
// no prebuilt include directory stands for.
describe('a cmake package that ships its sources', () => {
    test('lends SWIG its header directory', async () => {
        const { run, createBridgeFile } = await importFresh();
        const lib = path.join(work, 'deps', 'lib-cmake');
        const libHeaders = path.join(lib, 'src', 'native');
        fs.mkdirSync(libHeaders, { recursive: true });
        fs.writeFileSync(path.join(lib, 'CMakeLists.txt'), 'add_library(lib STATIC src/native/lib.cpp)\n');
        holder.config.allDependencies = [{
            export: { type: 'cmake' },
            paths: { output: lib, header: [libHeaders], cmake: path.join(lib, 'CMakeLists.txt'), cmakeDir: lib, cliCMakeListsTxt: '/cli/assets/cmake/CMakeLists.txt' },
        }];
        fs.writeFileSync(header, '#include <lib/lib.h>\nint one();\n');

        createBridgeFile(header, { platform: 'wasm', path: 'wasm-wasm32-st-release' });

        expect(swigRuns(run)[0][1]).toContain(`-I${libHeaders}`);
    });
});
