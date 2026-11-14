import { LIBRARIES_URL, SHOWCASE_COUNT } from '../../data.js';
import { WASI_TOOL_PORTS } from '../../ports/catalog.js';
import { RELEASE } from '../../release.js';

const DIST_TAG_SUFFIX = RELEASE.distTagSuffix;

export default {
    slug: 'libraries',
    title: 'crossbind ports',
    description: 'Use a prebuilt C or C++ library from npm: install it per platform, list it, import its headers.',
    lede: `${SHOWCASE_COUNT} native libraries are published as prebuilt npm packages - GDAL, OpenSSL, SQLite, GEOS, PROJ, libTIFF and more. Install the build for each platform you target, list it in \`crossbind.config.js\` and import the library's own headers; the library itself comes compiled.`,
    blocks: [
        { type: 'h2', id: 'use', text: 'Install, list, import' },
        {
            type: 'p',
            text: 'Install the package for the platform you build and list its config in `dependencies`; your build then compiles the bindings for the headers you import and links the prebuilt library.',
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
console.log(await GDALVersionInfo('RELEASE_NAME'));`,
        },
        {
            type: 'p',
            text: "The import path after `@crossbind/port-gdal/` is relative to the library's include directory: `@crossbind/port-gdal/gdal.h` is GDAL's own `gdal.h`. The header binds its enums whole, a free function only when your code imports it by name, and a class only when an import reaches it - see [what a library header binds](/guide/bindings/#imports).",
        },

        { type: 'h2', id: 'platform-split', text: 'Meta package and platform variants' },
        {
            type: 'p',
            text: 'Each library is a family. The meta package, `@crossbind/port-gdal`, holds the build recipe and the license metadata and gives the family the name you import headers by; every platform package depends on it. Install the platform packages you build for and list each one: crossbind links the one with libraries for the target being built and leaves the others out. A React Native app lists two:',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `import gdalAndroid from '@crossbind/port-gdal-android/crossbind.config.js';
import gdalIos from '@crossbind/port-gdal-ios/crossbind.config.js';

export default {
    dependencies: [gdalAndroid, gdalIos],
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'table',
            head: ['Package', 'Carries', 'For'],
            rows: [
                ['`@crossbind/port-gdal`', 'the recipe, the license metadata and the header alias', 'installed with every variant'],
                ['`-wasm`', 'wasm32 libraries, `st` and `mt`', 'the browser, Node.js and edge runtimes'],
                ['`-android`', 'arm64-v8a and x86_64 libraries', '[React Native](/guide/react-native/)'],
                ['`-ios`', 'device and simulator libraries, as an xcframework', '[React Native](/guide/react-native/)'],
                ['`-darwin`, `-linux`, `-linuxmusl`, `-win32`', 'arm64 and x64 libraries', '[Node.js addons](/guide/node/#addon), [Electron](/guide/electron/) and [native executables](/guide/executables/#native)'],
                ['`-wasi`', '`wasm32-wasip3` libraries', '[WASI](/guide/executables/#wasi) commands and components'],
                ['`-standalone-napi`', 'prebuilt Node-API addons', 'Node.js, with nothing to build'],
                ['`-standalone-wasi`', 'the upstream command-line tools', 'npm commands that run on wasmtime'],
            ],
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'What a package carries',
            text: "Every port pins its upstream source by URL and SHA-256 in its recipe, and its npm `license` field is the wrapped library's license. A platform package ships the upstream license text as `LICENSE` - GDAL's also the texts of the libraries it compiles in, under `dist/licenses/` - but no notices file or SBOM. Write those for what your build links with `crossbind licenses --notices --sbom`, which also flags copyleft licenses such as the LGPL of GEOS and libiconv ([CLI](/guide/cli/#licenses)).",
        },
        {
            type: 'p',
            text: 'Your own library can ship the same way: see [Publishing packages](/guide/publishing/).',
        },

        { type: 'h2', id: 'catalog', text: 'The catalog' },
        {
            type: 'p',
            text: `[The catalog](${LIBRARIES_URL}) lists every library with its upstream version and license. Each library's page has the install commands for every platform and, where it has them, live apps that run in the browser, worked examples and command-line tools.`,
        },

        { type: 'h2', id: 'standalone', text: 'Nothing to build' },
        {
            type: 'p',
            text: `Two kinds of package need no crossbind build at all. Every port has a \`-standalone-napi\` package for Node.js: npm installs the prebuilt addon for your machine, and the package root exports every function, class and constant of the public headers ([Node.js](/guide/node/#addon)). For ${WASI_TOOL_PORTS.length} of them, a \`-standalone-wasi\` package also publishes the upstream command-line tools as npm commands - \`gdalinfo-wasi\`, \`ogr2ogr-wasi\`, \`sqlite3-wasi\` - which run on wasmtime ([Executables](/guide/executables/#tools)). Both ship an SBOM and a \`license\` field derived from everything linked in.`,
        },

        { type: 'h2', id: 'rebuild', text: 'Rebuilding from source' },
        {
            type: 'p',
            text: "Each port is built with its recipe's defaults. To change a version, a flag or a patch, add `crossbind.overrides.js` next to your config: crossbind then rebuilds that dependency from its pinned source into `.crossbind/deps/`, for each platform you build, and links the result in its place.",
        },
        {
            type: 'code',
            file: 'crossbind.overrides.js',
            code: `export default {
    '@crossbind/port-zlib': { rebuild: true },
    '@crossbind/port-proj': {
        getBuildParams: (base, ...args) => [...base(...args), '-DENABLE_TIFF=OFF'],
    },
};`,
        },
        {
            type: 'p',
            text: '`crossbind build --rebuild-deps <names>` rebuilds once without the file. iOS picks overrides up at `pod install`, so run it again after you change them.',
        },
    ],
};
