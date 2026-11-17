import { LIBRARIES_URL, SHOWCASE_COUNT } from '../../data.js';
import { WASI_TOOL_PORTS } from '../../ports/catalog.js';
import { RELEASE } from '../../release.js';

const DIST_TAG_SUFFIX = RELEASE.distTagSuffix;

export default {
    slug: 'libraries',
    title: 'crossbind ports',
    description: 'Use a prebuilt C or C++ library from npm: install it per platform, list it, import its headers.',
    lede: `${SHOWCASE_COUNT} native libraries are published as prebuilt npm packages: GDAL, OpenSSL, SQLite, GEOS, PROJ, libTIFF and more. Install the package for each platform you target, list it in \`crossbind.config.js\` and import the library's own headers.`,
    blocks: [
        { type: 'h2', id: 'use', text: 'Install, list, import' },
        {
            type: 'p',
            text: 'Install the package for your platform and list its config in `dependencies`. Your build compiles only the bindings for the headers you import, and links the prebuilt library.',
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
            text: "The path after `@crossbind/port-gdal/` is relative to the library's include folder: `@crossbind/port-gdal/gdal.h` is GDAL's own `gdal.h`. Only what you import binds; see [what a library header binds](/guide/bindings/#imports).",
        },

        { type: 'h2', id: 'platform-split', text: 'Meta package and platform variants' },
        {
            type: 'p',
            text: 'Each library is a family. The meta package, `@crossbind/port-gdal`, holds the recipe and the license metadata and gives the name you import headers by; every platform package depends on it. Install and list the platform packages you build for: each build links the one for its target. A React Native app lists two:',
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
            type: 'entries',
            items: [
                { name: '`@crossbind/port-gdal`', text: 'The recipe, the license metadata and the header name. Installed with every variant.' },
                { name: '`-wasm`', text: 'wasm32 libraries, `st` and `mt`, for the browser, Node.js and edge.' },
                { name: '`-android`', text: 'arm64-v8a and x86_64 libraries, for [React Native](/guide/react-native/).' },
                { name: '`-ios`', text: 'Device and simulator libraries as an xcframework, for [React Native](/guide/react-native/).' },
                {
                    name: '`-darwin`, `-linux`, `-linuxmusl`, `-win32`',
                    text: 'arm64 and x64 libraries, for [Node.js addons](/guide/node/#addon), [Electron](/guide/electron/) and [native executables](/guide/executables/#native).',
                },
                { name: '`-wasi`', text: '`wasm32-wasip3` libraries, for [WASI](/guide/executables/#wasi) commands and components.' },
                { name: '`-standalone-napi`', text: 'Prebuilt Node-API addons: Node.js with nothing to build.' },
                { name: '`-standalone-wasi`', text: 'The upstream command-line tools, as npm commands that run on wasmtime.' },
            ],
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'Licenses',
            text: "A port's npm `license` field is the wrapped library's license, and each platform package ships its license text as `LICENSE` (GDAL's also those of the libraries it compiles in, in `dist/licenses/`). Packages carry no notices file or SBOM: write them for what your build links with `crossbind licenses --notices --sbom`, which also flags copyleft licenses such as the LGPL of GEOS and libiconv ([CLI](/guide/cli/#licenses)).",
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
            text: `Two kinds of package need no crossbind build. Every port has a \`-standalone-napi\` package for Node.js: npm installs the prebuilt addon for your machine, and the package exports every function, class and constant of the public headers ([Node.js](/guide/node/#addon)). For ${WASI_TOOL_PORTS.length} ports, a \`-standalone-wasi\` package publishes the upstream command-line tools as npm commands (\`gdalinfo-wasi\`, \`ogr2ogr-wasi\`, \`sqlite3-wasi\`) that run on wasmtime ([Executables](/guide/executables/#tools)). Both ship an SBOM and a \`license\` field covering everything linked in.`,
        },

        { type: 'h2', id: 'rebuild', text: 'Rebuilding from source' },
        {
            type: 'p',
            text: "To change a port's version, a flag or a patch, add `crossbind.overrides.js` next to your config. crossbind then rebuilds that dependency from source into `.crossbind/deps/` for each platform you build, and links it instead.",
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
