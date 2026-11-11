import { describe, test, expect } from 'vitest';
import { conanPackagesOf } from '../../../extensions/conan/src/graph.js';

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

describe('the packages of a conan graph', () => {
    test('lists the host packages with what each requires, without the consumer or build tools', () => {
        const graph = graphOf({
            0: { ref: 'conanfile', recipe: 'Cli', context: 'host', dependencies: { 1: edge(), 2: edge({ direct: false }), 3: edge({ build: true }) } },
            1: packageNode({ name: 'libpng', version: '1.6.58', libs: ['png'], license: 'libpng-2.0', dependencies: { 2: edge(), 3: edge({ build: true }) } }),
            2: packageNode({ name: 'zlib', version: '1.3.2', libs: ['z'] }),
            3: { ...packageNode({ name: 'cmake', version: '3.31.6', libs: [] }), context: 'build' },
        });

        const packages = conanPackagesOf(graph);

        expect(packages.map((p) => p.name)).toEqual(['libpng', 'zlib']);
        expect(packages[0]).toEqual({
            name: 'libpng',
            version: '1.6.58',
            ref: 'libpng/1.6.58#0123456789abcdef0123456789abcdef',
            license: 'libpng-2.0',
            homepage: 'https://libpng.example',
            source: { url: 'https://libpng.example/libpng-1.6.58.tar.gz', sha256: 'a'.repeat(64) },
            libs: ['png'],
            requires: ['zlib'],
            systemLibs: [],
            frameworks: [],
            defines: [],
            packageFolder: `${CONTAINER}/libpng/p`,
            includedirs: [`${CONTAINER}/libpng/p/include`],
            libdirs: [`${CONTAINER}/libpng/p/lib`],
        });
        expect(packages[1].requires).toEqual([]);
    });

    test("a recipe's licenses come as the recipe wrote them, one or a list", () => {
        const graph = graphOf({ 1: packageNode({ name: 'pcre2', version: '10.46', libs: ['pcre2-8'], license: ['BSD-3-Clause', 'Unicode-DFS-2016'] }) });
        expect(conanPackagesOf(graph)[0].license).toEqual(['BSD-3-Clause', 'Unicode-DFS-2016']);
    });

    test('names the first source of the version, by its first mirror', () => {
        const sources = [
            { url: ['https://zlib.example/zlib-1.3.2.tar.gz', 'https://mirror.example/zlib-1.3.2.tar.gz'], sha256: 'b'.repeat(64) },
            { url: 'https://zlib.example/extra.tar.gz', sha256: 'c'.repeat(64) },
        ];
        const withSources = (conandata) => conanPackagesOf(graphOf({ 1: packageNode({ name: 'zlib', version: '1.3.2', libs: ['z'], conandata }) }))[0].source;

        expect(withSources({ sources: { '1.3.2': sources } })).toEqual({ url: 'https://zlib.example/zlib-1.3.2.tar.gz', sha256: 'b'.repeat(64) });
        expect(withSources({ sources: { '1.3.2': { url: 'https://zlib.example/zlib-1.3.2.tar.gz' } } })).toEqual({ url: 'https://zlib.example/zlib-1.3.2.tar.gz', sha256: null });
        expect(withSources({ sources: { '1.3.1': sources } })).toBeNull();
        expect(withSources(undefined)).toBeNull();
    });

    test('collects the libraries and folders of every component, each once', () => {
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
        expect(openssl.libdirs).toEqual([`${CONTAINER}/openssl/p/lib`]);
    });

    test('collects what every component asks the link and its consumers for', () => {
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
                        defines: ['CURL_STATICLIB=1', 'X=a b'],
                    },
                },
            }),
        });

        const [curl] = conanPackagesOf(graph);

        expect(curl.systemLibs).toEqual(['rt', 'pthread']);
        expect(curl.frameworks).toEqual(['CoreFoundation', 'SystemConfiguration']);
        // As the recipe wrote them: crossbind decides which of them it passes on.
        expect(curl.defines).toEqual(['CURL_STATICLIB=1', 'X=a b']);
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
});
