import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    conanPackagesOf, stageConanPackage, writeConanManifest, readConanManifest, conanManifestsStamp,
} from '../src/utils/conanStage.js';
import makeTreeWritable from '../src/utils/makeTreeWritable.js';
import logger from '../src/utils/logger.js';

const CONTAINER = '/var/cache/crossbind/conan/store/p';
const edge = (overrides = {}) => ({ build: false, test: false, ...overrides });
const packageNode = ({
    name, version, libs, dependencies = {}, license = 'Zlib', cppInfo, ...rest
}) => ({
    ref: `${name}/${version}#0123456789abcdef0123456789abcdef`,
    name,
    version,
    recipe: 'Downloaded',
    context: 'host',
    test: false,
    binary: 'Cache',
    license,
    homepage: `https://${name}.example`,
    conandata: { sources: { [version]: { url: `https://${name}.example/${name}-${version}.tar.gz`, sha256: 'a'.repeat(64) } } },
    package_folder: `${CONTAINER}/${name}/p`,
    cpp_info: cppInfo ?? { root: { includedirs: [`${CONTAINER}/${name}/p/include`], libdirs: [`${CONTAINER}/${name}/p/lib`], libs } },
    dependencies,
    ...rest,
});
const graphOf = (nodes) => ({ root: { 0: 'None' }, nodes: { 0: { ref: 'conanfile', recipe: 'Cli', context: 'host' }, ...nodes } });

const libpngGraph = () => graphOf({
    0: { ref: 'conanfile', recipe: 'Cli', context: 'host', dependencies: { 1: edge(), 2: edge({ direct: false }), 3: edge({ build: true }) } },
    1: packageNode({ name: 'libpng', version: '1.6.58', libs: ['png'], license: 'libpng-2.0', dependencies: { 2: edge(), 3: edge({ build: true }) } }),
    2: packageNode({ name: 'zlib', version: '1.3.2', libs: ['z'] }),
    3: { ...packageNode({ name: 'cmake', version: '3.31.6', libs: [] }), context: 'build' },
});

describe('the packages of a conan graph', () => {
    test('lists host packages before the packages they require, without the consumer or build tools', () => {
        const packages = conanPackagesOf(libpngGraph());
        expect(packages.map((p) => p.name)).toEqual(['libpng', 'zlib']);
        expect(packages[0]).toMatchObject({
            version: '1.6.58',
            ref: 'libpng/1.6.58#0123456789abcdef0123456789abcdef',
            license: 'libpng-2.0',
            libs: ['png'],
            requires: ['zlib'],
            source: { url: 'https://libpng.example/libpng-1.6.58.tar.gz', sha256: 'a'.repeat(64) },
        });
    });

    test('a recipe with several licenses declares all of them', () => {
        const graph = graphOf({ 1: packageNode({ name: 'pcre2', version: '10.46', libs: ['pcre2-8'], license: ['BSD-3-Clause', 'Unicode-DFS-2016'] }) });
        expect(conanPackagesOf(graph)[0].license).toBe('BSD-3-Clause AND Unicode-DFS-2016');
    });

    test('a license of the list that offers a choice keeps it as one term', () => {
        const graph = graphOf({ 1: packageNode({ name: 'zlib', version: '1.3.2', libs: ['z'], license: ['MIT OR Apache-2.0', 'BSD-3-Clause'] }) });
        expect(conanPackagesOf(graph)[0].license).toBe('(MIT OR Apache-2.0) AND BSD-3-Clause');
    });

    test('collects the libraries of every component', () => {
        const graph = graphOf({
            1: packageNode({
                name: 'openssl',
                version: '3.6.0',
                cppInfo: {
                    root: { includedirs: [], libdirs: [], libs: [] },
                    ssl: { includedirs: [`${CONTAINER}/openssl/p/include`], libdirs: [`${CONTAINER}/openssl/p/lib`], libs: ['ssl'] },
                    crypto: { includedirs: [`${CONTAINER}/openssl/p/include`], libdirs: [`${CONTAINER}/openssl/p/lib`], libs: ['crypto'] },
                },
            }),
        });
        const [openssl] = conanPackagesOf(graph);
        expect(openssl.libs).toEqual(['ssl', 'crypto']);
        expect(openssl.includedirs).toEqual([`${CONTAINER}/openssl/p/include`]);
    });

    test('collects the system libraries and frameworks every component asks the link for', () => {
        const graph = graphOf({
            1: packageNode({
                name: 'libcurl',
                version: '8.22.0',
                cppInfo: {
                    root: { includedirs: [], libdirs: [], libs: [] },
                    curl: {
                        includedirs: [`${CONTAINER}/libcurl/p/include`],
                        libdirs: [`${CONTAINER}/libcurl/p/lib`],
                        libs: ['curl'],
                        system_libs: ['rt', 'pthread'],
                        frameworks: ['CoreFoundation', 'SystemConfiguration'],
                    },
                },
            }),
        });
        const [curl] = conanPackagesOf(graph);
        expect(curl.systemLibs).toEqual(['rt', 'pthread']);
        expect(curl.frameworks).toEqual(['CoreFoundation', 'SystemConfiguration']);
    });

    test('collects the defines every component asks its consumers to compile with', () => {
        const graph = graphOf({
            1: packageNode({
                name: 'libcurl',
                version: '8.22.0',
                cppInfo: {
                    root: { includedirs: [], libdirs: [], libs: [] },
                    curl: {
                        includedirs: [`${CONTAINER}/libcurl/p/include`], libdirs: [`${CONTAINER}/libcurl/p/lib`], libs: ['curl'], defines: ['CURL_STATICLIB=1', 'NOMINMAX'],
                    },
                },
            }),
        });
        expect(conanPackagesOf(graph)[0].defines).toEqual(['CURL_STATICLIB=1', 'NOMINMAX']);
    });

    // A define becomes one compiler argument, in a list CMake splits on ';'. One that cannot was left out
    // before crossbind took defines at all, so it stays out instead of stopping the build.
    test('a define that is no plain name with a plain value is left out, with a notice', () => {
        const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
        const asking = (defines) => conanPackagesOf(graphOf({
            1: packageNode({
                name: 'zlib', version: '1.3.2', cppInfo: { root: { includedirs: [], libdirs: [], libs: ['z'], defines } },
            }),
        }))[0].defines;

        const defines = asking(['X;-fplugin=/tmp/evil.so', 'X=a b', 'FOO="x"', '1X', 'KEPT']);
        const notices = info.mock.calls.map(([text]) => text);
        info.mockRestore();

        expect(defines).toEqual(['KEPT']);
        expect(notices).toHaveLength(4);
        expect(notices[0]).toMatch(/zlib\/1\.3\.2.*"X;-fplugin=\/tmp\/evil\.so"/);
    });

    test('a define may carry a path or a list as its value', () => {
        const graph = graphOf({
            1: packageNode({
                name: 'boost', version: '1.90.0', libs: [], cppInfo: { root: { includedirs: [], libdirs: [], libs: [], defines: ['BOOST_STACKTRACE_ADDR2LINE_LOCATION=/usr/bin/addr2line', 'X=a,b:c'] } },
            }),
        });
        expect(conanPackagesOf(graph)[0].defines).toEqual(['BOOST_STACKTRACE_ADDR2LINE_LOCATION=/usr/bin/addr2line', 'X=a,b:c']);
    });

    // They become linker arguments.
    test('a system library or framework that is no plain name is refused', () => {
        const asking = (field, value) => graphOf({
            1: packageNode({
                name: 'zlib', version: '1.3.2', cppInfo: { root: { includedirs: [], libdirs: [], libs: ['z'], [field]: [value] } },
            }),
        });
        expect(() => conanPackagesOf(asking('system_libs', '-Wl,--wrap=open'))).toThrow(/invalid systemLibs/);
        expect(() => conanPackagesOf(asking('frameworks', '../Evil'))).toThrow(/invalid frameworks/);
    });

    test('leaves out what conan skipped and test requirements', () => {
        // A header-only requirement of a static library that is already built: the consumer needs none of it.
        const graph = graphOf({
            1: packageNode({ name: 'lib', version: '1.0', libs: ['lib'], dependencies: { 2: edge(), 3: edge({ test: true }) } }),
            2: packageNode({
                name: 'hdr', version: '1.0', libs: [], binary: 'Skip', package_folder: null,
            }),
            3: packageNode({
                name: 'gtest', version: '1.17.0', libs: ['gtest'], test: true,
            }),
        });

        const packages = conanPackagesOf(graph);

        expect(packages.map((p) => p.name)).toEqual(['lib']);
        expect(packages[0].requires).toEqual([]);
    });

    test('a graph without nodes or a root is refused', () => {
        expect(() => conanPackagesOf({ nodes: {} })).toThrow(/without nodes or a root/);
        expect(() => conanPackagesOf(undefined)).toThrow(/without nodes or a root/);
    });

    test('a package conan reports without a package folder is named', () => {
        const graph = graphOf({ 1: packageNode({ name: 'zlib', version: '1.3.2', libs: ['z'], package_folder: null }) });
        expect(() => conanPackagesOf(graph)).toThrow(/zlib\/1\.3\.2#[0-9a-f]+.*without a package folder/);
    });

    test.each([
        ['a name that climbs out of the stage', { name: '../../OUTSIDE' }, /invalid name/],
        ['a version with a path in it', { version: '1.0/../..' }, /invalid version/],
        ['a reference to another package', { ref: 'openssl/3.6.0#0123' }, /invalid ref/],
        ['a library name that is a path', { cppInfo: { root: { includedirs: [], libdirs: [], libs: ['/../../x'] } } }, /invalid libs/],
        ['a library name that closes a CMake string', { cppInfo: { root: { includedirs: [], libdirs: [], libs: ['z")\nfile(WRITE /tmp/x "y'] } } }, /invalid libs/],
        ['include directories that are not paths', { cppInfo: { root: { includedirs: [{ path: '/' }], libdirs: [], libs: [] } } }, /invalid includedirs/],
    ])('%s is refused', (title, overrides, error) => {
        const graph = graphOf({ 1: packageNode({ name: 'zlib', version: '1.3.2', libs: ['z'], ...overrides }) });
        expect(() => conanPackagesOf(graph)).toThrow(error);
    });

    test('recipe text bound for notices keeps no control characters or non-web links', () => {
        const graph = graphOf({
            1: packageNode({
                name: 'zlib',
                version: '1.3.2',
                libs: ['z'],
                license: 'Zlib\u001b]8;;https://evil.example\u0007',
                homepage: 'javascript:alert(1)',
                conandata: { sources: { '1.3.2': { url: 'file:///etc/passwd', sha256: 'a'.repeat(64) } } },
            }),
        });

        expect(conanPackagesOf(graph)[0]).toMatchObject({ license: null, homepage: null, source: null });
    });
});

describe('staging a conan package as a crossbind prebuilt', () => {
    let scratch;
    const store = () => path.join(scratch, 'store');
    const stageDir = () => path.join(scratch, 'app', '.crossbind', 'conan');
    const packageDir = (name) => path.join(stageDir(), 'packages', name);
    const toHost = (p) => p.replace('/var/cache/crossbind/conan/store', store());
    const distCmake = 'hosts=___PROJECT_HOST___ name=___PROJECT_NAME___ libs=___PROJECT_LIBS___ keep=___PROJECT_WHOLE_ARCHIVE___';
    const HOST_LIBS = `\${CROSSBIND_CONAN_LIBS_\${PROJECT_TARGET_HOST}}`;
    const options = (targetPath = 'wasm-wasm32-st-release') => ({
        stageDir: stageDir(), targetPath, toHost, store: store(), distCmake,
    });
    const inPackage = (name, file) => path.join(store(), 'p', name, 'p', file);

    const writeConanPackage = (name, files) => {
        Object.entries(files).forEach(([file, content]) => {
            fs.mkdirSync(path.dirname(inPackage(name, file)), { recursive: true });
            fs.writeFileSync(inPackage(name, file), content);
        });
    };

    const zlibWith = (overrides = {}) => conanPackagesOf(graphOf({ 2: packageNode({ name: 'zlib', version: '1.3.2', libs: ['z'], ...overrides }) }))[0];

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conanstage-'));
        writeConanPackage('zlib', { 'include/zlib.h': '/* zlib */', 'lib/libz.a': 'archive', 'licenses/LICENSE': 'zlib license' });
        fs.mkdirSync(path.join(scratch, 'secret'));
        fs.writeFileSync(path.join(scratch, 'secret', 'id_rsa'), 'private key');
    });

    afterEach(() => {
        makeTreeWritable(scratch);
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    test('lays the headers, archives and license texts out like a published port', () => {
        stageConanPackage(zlibWith(), options());

        const dir = packageDir('zlib');
        expect(fs.readFileSync(path.join(dir, 'dist/prebuilt/wasm-wasm32-st-release/include/zlib.h'), 'utf8')).toBe('/* zlib */');
        expect(fs.readFileSync(path.join(dir, 'dist/prebuilt/wasm-wasm32-st-release/lib/libz.a'), 'utf8')).toBe('archive');
        expect(fs.readFileSync(path.join(dir, 'licenses/LICENSE'), 'utf8')).toBe('zlib license');
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))).toMatchObject({
            name: 'conan:zlib', version: '1.3.2', nativeVersion: '1.3.2', license: 'Zlib',
        });
        expect(fs.readFileSync(path.join(dir, 'dist/prebuilt/CMakeLists.txt'), 'utf8'))
            .toBe(`set(CROSSBIND_CONAN_LIBS_wasm-wasm32-st-release "z")\nhosts=wasm-wasm32-st-release name=conan_zlib libs=${HOST_LIBS} keep=`);
    });

    test('a second target joins the targets the package already serves', () => {
        stageConanPackage(zlibWith(), options('wasm-wasm32-st-release'));
        stageConanPackage(zlibWith(), options('wasm-wasm32-mt-release'));

        expect(fs.readFileSync(path.join(packageDir('zlib'), 'dist/prebuilt/CMakeLists.txt'), 'utf8')).toBe([
            'set(CROSSBIND_CONAN_LIBS_wasm-wasm32-mt-release "z")',
            'set(CROSSBIND_CONAN_LIBS_wasm-wasm32-st-release "z")',
            `hosts=wasm-wasm32-mt-release;wasm-wasm32-st-release name=conan_zlib libs=${HOST_LIBS} keep=`,
        ].join('\n'));
    });

    // The generated list is named by the host dist.cmake settles on, so it has to be read after the fallback.
    test("dist.cmake reads a host's libraries only after a debug host falls back to its release one", () => {
        const template = fs.readFileSync(new URL('../src/assets/cmake/dist.cmake', import.meta.url), 'utf8');

        expect(template.indexOf('___PROJECT_LIBS___')).toBeGreaterThan(template.indexOf(`set(PROJECT_TARGET_HOST "\${PROJECT_TARGET_HOST_RELEASE}")`));
    });

    // libpng is png16 on Windows.
    test('each target links the archives staged for it, as its recipe names them there', () => {
        writeConanPackage('zlib', { 'lib/libzlibstatic.a': 'archive' });
        stageConanPackage(zlibWith(), options('darwin-arm64-mt-release'));
        stageConanPackage(zlibWith({ libs: ['zlibstatic'] }), options('win32-x64-mt-release'));

        const cmake = fs.readFileSync(path.join(packageDir('zlib'), 'dist/prebuilt/CMakeLists.txt'), 'utf8');
        expect(cmake).toContain('set(CROSSBIND_CONAN_LIBS_darwin-arm64-mt-release "z")');
        expect(cmake).toContain('set(CROSSBIND_CONAN_LIBS_win32-x64-mt-release "zlibstatic")');
    });

    test('a library the recipe declares but did not package fails the staging', () => {
        fs.rmSync(inPackage('zlib', 'lib/libz.a'));

        expect(() => stageConanPackage(zlibWith(), options())).toThrow(/libz\.a/);
    });

    test('restaging drops license texts the package no longer ships', () => {
        stageConanPackage(zlibWith(), options());
        fs.renameSync(inPackage('zlib', 'licenses/LICENSE'), inPackage('zlib', 'licenses/COPYING'));

        stageConanPackage(zlibWith(), options());

        expect(fs.readdirSync(path.join(packageDir('zlib'), 'licenses'))).toEqual(['COPYING']);
    });

    test('an include directory that climbs out of the package is refused', () => {
        const pkg = zlibWith({ cppInfo: { root: { includedirs: [`${CONTAINER}/zlib/p/../../../../secret`], libdirs: [], libs: [] } } });

        expect(() => stageConanPackage(pkg, options())).toThrow(/resolves outside/);
        expect(fs.existsSync(path.join(packageDir('zlib'), 'dist/prebuilt/wasm-wasm32-st-release/include/id_rsa'))).toBe(false);
    });

    test('a package folder outside the store is refused', () => {
        const pkg = zlibWith({ package_folder: `${CONTAINER}/../../secret` });

        expect(() => stageConanPackage(pkg, options())).toThrow(/resolves outside/);
    });

    test('a package folder that is the store itself is refused', () => {
        const pkg = zlibWith({ package_folder: `${CONTAINER}/..` });

        expect(() => stageConanPackage(pkg, options())).toThrow(/no package folder crossbind can use/);
    });

    test('a package folder that is a link is refused, even to a folder in the store', () => {
        fs.renameSync(path.join(store(), 'p', 'zlib', 'p'), path.join(store(), 'p', 'zlib', 'real'));
        fs.symlinkSync('real', path.join(store(), 'p', 'zlib', 'p'), 'dir');

        expect(() => stageConanPackage(zlibWith(), options())).toThrow(/no package folder crossbind can use/);
    });

    test('links back up the tree are not followed, so the copy ends', () => {
        writeConanPackage('zlib', { 'include/sub/extra.h': '/* extra */' });
        fs.symlinkSync('.', inPackage('zlib', 'include/loop'), 'dir');
        fs.symlinkSync('.', inPackage('zlib', 'include/again'), 'dir');
        fs.symlinkSync('..', inPackage('zlib', 'include/sub/up'), 'dir');

        stageConanPackage(zlibWith(), options());

        const include = path.join(packageDir('zlib'), 'dist/prebuilt/wasm-wasm32-st-release/include');
        expect(fs.readdirSync(include).sort()).toEqual(['sub', 'zlib.h']);
        expect(fs.readdirSync(path.join(include, 'sub'))).toEqual(['extra.h']);
    });

    test('directories linked over and over are copied a bounded number of times', () => {
        // Every level links twice to the next one: copied without a bound, that is 2^12 copies.
        const DEPTH = 12;
        Array.from({ length: DEPTH }, (unused, level) => writeConanPackage('zlib', { [`include/c${level}/h${level}.h`]: '' }));
        Array.from({ length: DEPTH - 1 }, (unused, level) => ['a', 'b'].forEach((name) => {
            fs.symlinkSync(`../c${level + 1}`, inPackage('zlib', `include/c${level}/${name}`), 'dir');
        }));

        stageConanPackage(zlibWith(), options());

        const include = path.join(packageDir('zlib'), 'dist/prebuilt/wasm-wasm32-st-release/include');
        const headers = fs.readdirSync(include, { recursive: true }).filter((file) => file.endsWith('.h'));
        expect(headers.length).toBeLessThan(4 * DEPTH);
    });

    test.skipIf(process.platform === 'win32')('a read-only directory of the package does not block the next restage', () => {
        writeConanPackage('zlib', { 'include/locked/inner.h': '/* inner */' });
        fs.chmodSync(inPackage('zlib', 'include/locked'), 0o555);

        stageConanPackage(zlibWith(), options());
        stageConanPackage(zlibWith(), options());

        expect(fs.readFileSync(path.join(packageDir('zlib'), 'dist/prebuilt/wasm-wasm32-st-release/include/locked/inner.h'), 'utf8')).toBe('/* inner */');
    });

    test('a licenses entry that is a file stages no license folder', () => {
        fs.rmSync(inPackage('zlib', 'licenses'), { recursive: true });
        writeConanPackage('zlib', { licenses: 'not a folder' });

        stageConanPackage(zlibWith(), options());

        expect(fs.existsSync(path.join(packageDir('zlib'), 'licenses'))).toBe(false);
    });

    test('links inside the package are staged as what they point at, and a broken one is left out', () => {
        writeConanPackage('zlib', { 'include/sub/extra.h': '/* extra */' });
        fs.symlinkSync('zlib.h', inPackage('zlib', 'include/zlib-compat.h'));
        fs.symlinkSync('sub', inPackage('zlib', 'include/alias'), 'dir');
        fs.symlinkSync('missing.h', inPackage('zlib', 'include/gone.h'));

        stageConanPackage(zlibWith(), options());

        const include = path.join(packageDir('zlib'), 'dist/prebuilt/wasm-wasm32-st-release/include');
        expect(fs.readdirSync(include).sort()).toEqual(['alias', 'sub', 'zlib-compat.h', 'zlib.h']);
        expect(fs.lstatSync(path.join(include, 'zlib-compat.h')).isFile()).toBe(true);
        expect(fs.readFileSync(path.join(include, 'alias', 'extra.h'), 'utf8')).toBe('/* extra */');
    });

    test('a link out of the package is refused', () => {
        fs.symlinkSync(path.join(scratch, 'secret', 'id_rsa'), inPackage('zlib', 'include/key.h'));

        expect(() => stageConanPackage(zlibWith(), options())).toThrow(/resolves outside/);
    });

    test('a licenses folder that links outside the package is refused', () => {
        fs.rmSync(inPackage('zlib', 'licenses'), { recursive: true });
        fs.symlinkSync(path.join(scratch, 'secret'), inPackage('zlib', 'licenses'), 'dir');

        expect(() => stageConanPackage(zlibWith(), options())).toThrow(/resolves outside/);
    });

    test('an archive linked to another archive of the package is taken, as libpng installs its own', () => {
        fs.renameSync(inPackage('zlib', 'lib/libz.a'), inPackage('zlib', 'lib/libz1.a'));
        fs.symlinkSync('libz1.a', inPackage('zlib', 'lib/libz.a'));

        stageConanPackage(zlibWith(), options());

        expect(fs.readFileSync(path.join(packageDir('zlib'), 'dist/prebuilt/wasm-wasm32-st-release/lib/libz.a'), 'utf8')).toBe('archive');
    });

    test('an archive linked out of the package is refused', () => {
        fs.rmSync(inPackage('zlib', 'lib/libz.a'));
        fs.symlinkSync(path.join(scratch, 'secret', 'id_rsa'), inPackage('zlib', 'lib/libz.a'));

        expect(() => stageConanPackage(zlibWith(), options())).toThrow(/resolves outside/);
    });
});

describe('the stage manifest', () => {
    let scratch;
    const entry = {
        name: 'zlib', version: '1.3.2', ref: 'zlib/1.3.2#1cb806da49011867778ffb6ac7190fcb', license: 'Zlib', libs: ['z'], requires: [],
    };

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conanmanifest-'));
    });

    afterEach(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    const WASM = 'wasm-wasm32-st-release';
    const ANDROID = 'android-arm64-v8a-mt-release';
    const pkg = (name, requires = []) => ({
        ...entry, name, ref: `${name}/1.0`, version: '1.0', requires,
    });

    test('a manifest made for other dependencies is not read', () => {
        writeConanManifest(scratch, WASM, { key: 'one', packages: [entry] });

        expect(readConanManifest(scratch, 'one').packages).toEqual([{
            ...entry, homepage: null, source: null, systemLibs: [], frameworks: [], defines: [],
        }]);
        expect(readConanManifest(scratch, 'two')).toBeNull();
    });

    test('each target keeps its own list, and together they hold every package in link order', () => {
        // A recipe can require other packages on another platform.
        writeConanManifest(scratch, WASM, { key: 'one', packages: [pkg('png', ['zlib']), pkg('zlib')] });
        writeConanManifest(scratch, ANDROID, { key: 'one', packages: [pkg('curl', ['zlib']), pkg('zlib')] });

        expect(readConanManifest(scratch, 'one', WASM).packages.map((p) => p.name)).toEqual(['png', 'zlib']);
        expect(readConanManifest(scratch, 'one', ANDROID).packages.map((p) => p.name)).toEqual(['curl', 'zlib']);
        const all = readConanManifest(scratch, 'one').packages.map((p) => p.name);
        expect([...all].sort()).toEqual(['curl', 'png', 'zlib']);
        expect(all.at(-1)).toBe('zlib');
        const { targets } = readConanManifest(scratch, 'one');
        expect(Object.keys(targets).sort()).toEqual([ANDROID, WASM]);
        expect(targets[ANDROID].map((p) => p.name)).toEqual(['curl', 'zlib']);
    });

    test('a target not staged yet has no manifest', () => {
        writeConanManifest(scratch, WASM, { key: 'one', packages: [entry] });

        expect(readConanManifest(scratch, 'one', ANDROID)).toBeNull();
    });

    test('the stamp changes when a build stages a target', () => {
        const before = conanManifestsStamp(scratch);
        writeConanManifest(scratch, WASM, { key: 'one', packages: [entry] });

        expect(conanManifestsStamp(scratch)).not.toBe(before);
    });

    test('a manifest whose packages crossbind would not stage is refused, with the way out', () => {
        writeConanManifest(scratch, WASM, { key: 'one', packages: [{ ...entry, name: '../../x' }] });

        expect(() => readConanManifest(scratch, 'one')).toThrow(/will not use - delete .* and build again/);
    });

    test('requirements that loop do not hang the reading', () => {
        writeConanManifest(scratch, WASM, { key: 'one', packages: [pkg('a', ['b']), pkg('b', ['a'])] });

        expect(readConanManifest(scratch, 'one').packages.map((p) => p.name).sort()).toEqual(['a', 'b']);
    });
});
