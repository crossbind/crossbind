import { SHOWCASE_COUNT } from '../../data.js';
import { RELEASE } from '../../release.js';

const DIST_TAG_SUFFIX = RELEASE.distTagSuffix;

export default {
    slug: 'libraries',
    title: 'Libraries',
    description: 'Use a prebuilt C++ library from npm, or publish your own the same way.',
    lede: `Native libraries travel through npm like any other dependency. ${SHOWCASE_COUNT} are already published prebuilt - GDAL, OpenSSL, SQLite, GEOS, PROJ, libTIFF and more - and the same mechanism packages your own C++, whether it ships as binaries, as sources, as a CMake project or as a Rust crate.`,
    blocks: [
        { type: 'h2', id: 'use', text: 'Using a prebuilt library' },
        {
            type: 'p',
            text: 'Install the variant for the platform you build, declare it as a dependency in `crossbind.config.js`, and import its header. Nothing is compiled on your machine - the binaries are in the package. A project that builds for several platforms lists one variant per platform, for example `-android` and `-ios` in a React Native app.',
        },
        { type: 'code', file: 'shell', code: `npm install @crossbind/port-gdal-wasm${DIST_TAG_SUFFIX}` },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `import gdal from '@crossbind/port-gdal-wasm/crossbind.config.js';

export default {
    general: { name: 'my-geo-app' },
    dependencies: [gdal],
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, GDALVersionInfo } from '@crossbind/port-gdal/gdal.h';

await initNative();
console.log(GDALVersionInfo('RELEASE_NAME'));`,
        },
        {
            type: 'p',
            text: "Headers live under the package's `dist/prebuilt/<target>/include`, and the import path is relative to that - `@crossbind/port-gdal/gdal.h` is GDAL's own `gdal.h`.",
        },

        { type: 'h2', id: 'platform-split', text: 'Meta package, platform variants' },
        {
            type: 'p',
            text: "A package family is a thin meta package plus one package per platform, so you only download artifacts for the platforms you build. Every variant depends on `@crossbind/port-gdal`, which carries the family's shared build metadata and the `@crossbind/port-gdal/<header>.h` alias; you install `-wasm`, `-android`, `-ios` or `-wasi` for the platforms you build and list each one in `dependencies`. Importing the meta package pulls in the right variant for the target.",
        },
        {
            type: 'table',
            head: ['Package', 'Carries'],
            rows: [
                ['`@crossbind/port-gdal`', 'the meta package: shared metadata and the header alias, pulled in by every variant'],
                ['`@crossbind/port-gdal-wasm`', 'the WebAssembly prebuilt (browser, Node, edge)'],
                ['`@crossbind/port-gdal-android` / `-ios`', 'the native mobile libraries'],
                ['`@crossbind/port-gdal-wasi`', 'the `wasm32-wasip3` prebuilt'],
                ['`@crossbind/port-gdal-bin-wasi`', 'the upstream CLI tools as npm commands'],
            ],
        },
        {
            type: 'p',
            text: 'Those `-bin-wasi` packages are prebuilt command-line tools - `gdalinfo-wasi`, `ogr2ogr-wasi`, `sqlite3-wasi` and friends. See [WASI commands](/guide/wasi/#tools).',
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'Auditable by construction',
            text: 'Every upstream source is sha256-pinned, and each published package ships its third-party notices, a CycloneDX SBOM and a provenance block naming the sources, toolchain and environment that produced the binaries.',
        },

        { type: 'h2', id: 'types', text: 'The three package types' },
        {
            type: 'table',
            head: ['Type', 'export.type', 'What consumers get'],
            rows: [
                ['Prebuilt', '`cmake` (default)', 'compiled libraries per platform - nothing to build'],
                ['Source', '`source`', "raw C++ compiled during the consumer's build"],
                ['CMake', '`cmake`', 'sources plus a `CMakeLists.txt` for custom build systems'],
                ['Cargo', '`cargo`', 'a Rust crate built per platform - see [Rust](/guide/rust/#publish)'],
            ],
        },
        {
            type: 'p',
            text: 'Prebuilt is the default and what almost every published package is. Source and CMake packages trade build time for control - the consumer compiles them, so platform-specific tweaks are possible.',
        },

        { type: 'h2', id: 'publish', text: 'Publishing your own' },
        {
            type: 'p',
            text: 'Point the config at your sources, name the library, and declare where the build output goes. That is the whole contract:',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'mylib' },
    paths: {
        config: import.meta.url,
        native: ['src/native'],
        output: 'dist',
    },
    export: {
        type: 'cmake',
        libName: ['mylib'],
    },
};`,
        },
        {
            type: 'p',
            text: 'Build once per platform and publish the result. The layout the CLI produces is what consumers rely on:',
        },
        {
            type: 'code',
            file: 'dist/',
            code: `dist/
├── mylib-wasm-wasm32-st-release.browser.js
├── mylib-wasm-wasm32-st-release.browser.wasm
└── prebuilt/
    ├── wasm-wasm32-st-release/{include,lib}
    ├── android-arm64-v8a-mt-release/{include,lib}
    └── ios-iphoneos-mt-release/{include,lib}`,
        },
        {
            type: 'p',
            text: 'Wrapping an **external** project rather than your own sources? Add a `crossbind.build.js` next to the config: it fetches the upstream release, patches it if needed, and passes build parameters to cmake or configure. Every published library in the registry is built exactly that way.',
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Declare your C++ dependencies in package.json too',
            text: 'Build order is derived from the npm dependency graph. A library that links against another package must list it in `dependencies`, or the linker will run before that package has been built.',
        },
    ],
};
