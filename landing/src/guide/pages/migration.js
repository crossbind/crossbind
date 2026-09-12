import { V1_DOCS_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

// Every rename on this page was read from the last cpp.js release, git tag cpp.js@1.0.4, and the
// current tree; nothing here is from memory. Keep it that way when a name moves again.

const suffix = RELEASE.distTagSuffix;

export default {
    slug: 'migration',
    title: 'Migrating from cpp.js 1.x',
    kicker: 'HELP',
    description:
        'What changed between cpp.js 1.0.4 and crossbind 2.0: names, packages, config, CLI and runtime API, with the steps to move a project.',
    lede: `crossbind is cpp.js under a new name, with the same header-import model. Every rename below was checked against the last cpp.js release, 1.0.4, and the current tree. Work through the steps in order; most projects need the first five. The [cpp.js 1.x documentation](${V1_DOCS_URL}) stays online.`,
    blocks: [
        { type: 'h2', id: 'names', text: 'What was renamed' },
        {
            type: 'table',
            head: ['cpp.js 1.x', 'crossbind 2.x'],
            rows: [
                ['`cpp.js`, the CLI and core', '`crossbind`'],
                ['`create-cpp.js`', '`create-crossbind`'],
                [
                    '`@cpp.js/plugin-vite`, `-rollup`, `-webpack`, `-webpack-loader`, `-metro`, `-react-native`, `-react-native-ios-helper`',
                    '`@crossbind/plugin-*`, the same seven names',
                ],
                ['`@cpp.js/core-embind-jsi`', '`@crossbind/core-embind-jsi`'],
                [
                    '`@cpp.js/package-<name>`, one package with every platform inside',
                    '`@crossbind/port-<name>` plus one package per platform: `-wasm`, `-android`, `-ios`, `-wasi`; see [Libraries](/guide/libraries/)',
                ],
                ['`cppjs.config.js`', '`crossbind.config.js`'],
                ['`cppjs.build.js`, package authors only', '`crossbind.build.js`'],
                ['`.cppjs/` cache directory', '`.crossbind/`'],
                ['`~/.cppjs.json` system config', '`~/.crossbind.json`'],
                ['`initCppJs()`', '`initNative()`'],
                ['`_CPPJS_DATA_PATH_` placeholder in `env`', '`_CROSSBIND_DATA_PATH_`'],
                ['`org.js.cpp.<name>` iOS bundle and framework identifiers', '`dev.crossbind.<name>`'],
                ['`bugra9/cpp.js` Docker image', '`ghcr.io/crossbind/web` and `ghcr.io/crossbind/android`, pinned by digest inside the CLI'],
            ],
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'Versions',
            text: `cpp.js 1.0.4, from January 2025, was the last 1.x release. crossbind ${RELEASE.version} is current${suffix ? `, on the npm \`${RELEASE.distTag}\` tag` : ''}; the [changelog](/changelog/) covers both lines.`,
        },

        {
            type: 'callout',
            tone: 'note',
            title: 'Coming from a cpp.js 2.0 beta?',
            text: 'The 2.0 betas published under the cpp.js name already had the config shape, CLI flags and runtime API described here; what changes for you is the renames in the table: package names, the config file name, the CLI name and the native identifiers. The last cpp.js documentation stays online at [cpp.js.org](https://cpp.js.org/).',
        },

        { type: 'h2', id: 'requirements', text: '1. Requirements' },
        {
            type: 'p',
            text: `Node.js 18 was enough for cpp.js; crossbind needs **Node.js 24 or newer**. Docker, CMake 3.28+ for mobile, and Xcode with CocoaPods for iOS are unchanged.${suffix ? ` Until the first stable train every crossbind package is on the npm \`${RELEASE.distTag}\` tag, so install commands carry \`${suffix}\`.` : ''}`,
        },

        { type: 'h2', id: 'packages', text: '2. Replace the packages' },
        {
            type: 'code',
            file: 'shell',
            code: `npm uninstall cpp.js @cpp.js/plugin-vite @cpp.js/package-gdal
npm install -D crossbind${suffix} @crossbind/plugin-vite${suffix}
npm install @crossbind/port-gdal-wasm${suffix}`,
        },
        {
            type: 'p',
            text: 'A 1.x prebuilt package carried the Web, Android and iOS binaries in one tarball. A 2.x family is split per platform: `-wasm` for the browser, Node.js and edge, `-android` and `-ios` for React Native, `-wasi` for WASI builds. Install one variant per platform you build. The meta package `@crossbind/port-gdal` arrives as a dependency of each variant and is not installed on its own.',
        },
        {
            type: 'p',
            text: 'The eleven 1.x libraries - expat, GDAL, GEOS, GeoTIFF, iconv, PROJ, SpatiaLite, SQLite3, libTIFF, WebP and zlib - are all published as families, with new ones beside them; [Libraries](/ports/) lists what is on npm.',
        },

        { type: 'h2', id: 'config', text: '3. Rename and update the config' },
        {
            type: 'p',
            text: 'Rename `cppjs.config.js` to `crossbind.config.js`. `general`, `paths`, `ext`, `dependencies` and `export` keep their shape; two things change inside.',
        },
        {
            type: 'ul',
            items: [
                '**Dependency imports point at a platform variant.** `@cpp.js/package-proj/cppjs.config.js` becomes `@crossbind/port-proj-wasm/crossbind.config.js`, one import per platform you build.',
                "**`platform` becomes `targetSpecs`.** The 1.x keys `Emscripten-x86_64`, `Android-arm64-v8a` and `iOS-iphoneos` are now filters - `platform: 'wasm' | 'android' | 'ios' | 'wasi'` with optional `arch`, `runtime`, `buildType` and `runtimeEnv` - and `data`, `env` and `ignoreLibName` move under `specs`, next to the new `cmake` and `emccFlags` lists.",
            ],
        },
        {
            type: 'code',
            file: 'cppjs.config.js (1.x)',
            code: `import proj from '@cpp.js/package-proj/cppjs.config.js';

export default {
    dependencies: [proj],
    platform: {
        'Android-arm64-v8a': {
            data: { 'share/proj': 'proj' },
            env: { PROJ_LIB: '_CPPJS_DATA_PATH_/proj' },
        },
    },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'code',
            file: 'crossbind.config.js (2.x)',
            code: `import projAndroid from '@crossbind/port-proj-android/crossbind.config.js';

export default {
    dependencies: [projAndroid],
    targetSpecs: [
        {
            platform: 'android',
            arch: 'arm64-v8a',
            specs: {
                data: { 'share/proj': 'proj' },
                env: { PROJ_LIB: '_CROSSBIND_DATA_PATH_/proj' },
            },
        },
    ],
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: "Everything else in the file is new and optional: `target.runtime` for multithreaded wasm, `cargoDependencies` and `export.type: 'cargo'` for Rust, `dts` for generated types, `extensions` and `functions` for build hooks. The full list is in [Configuration](/guide/configuration/).",
        },

        { type: 'h2', id: 'bundler', text: '4. Swap the bundler plugin' },
        {
            type: 'code',
            file: 'vite.config.js',
            code: `import { defineConfig } from 'vite';
// was: import viteCppjsPlugin from '@cpp.js/plugin-vite';
import viteCrossbindPlugin from '@crossbind/plugin-vite';

export default defineConfig({
    plugins: [viteCrossbindPlugin()],
});`,
        },
        {
            type: 'p',
            text: 'Rollup, Webpack, Rspack, Metro and the React Native plugin follow the same rename; how each one is registered is unchanged. See [Bundlers](/guide/bundlers/).',
        },

        { type: 'h2', id: 'code', text: '5. Update the JavaScript' },
        {
            type: 'code',
            file: 'src/main.js',
            code: `// was: import { initCppJs, MyClass } from './native/MyClass.h';
import { initNative, MyClass } from './native/MyClass.h';

await initNative();
console.log(MyClass.sample());`,
        },
        {
            type: 'p',
            text: 'Header import paths are unchanged, for your own headers and for library headers such as `@crossbind/port-gdal/gdal.h`. `initNative()` takes options where `initCppJs()` took none - worker mode, persistent storage, environment variables - all listed in the [API reference](/api/).',
        },
        {
            type: 'p',
            text: 'The helpers on the returned module keep their names: `toArray`, `toVector`, `getFileBytes`, `getFileList` and `autoMountFiles`. Two things moved:',
        },
        {
            type: 'ul',
            items: [
                '`generateVirtualPath()` is now `getRandomPath()`.',
                'Browser files no longer live under `/virtual/`. They mount under `/memfs/<app>/`, or `/opfs/<app>/` once you opt into persistent storage with `useWorker: true`. `autoMountFiles` returns the new paths, so code that only uses what it returns keeps working; hard-coded `/virtual/...` paths do not. See [Filesystem](/guide/filesystem/).',
            ],
        },

        { type: 'h2', id: 'cli', text: '6. CLI and output names' },
        {
            type: 'table',
            head: ['cpp.js 1.x', 'crossbind 2.x'],
            rows: [
                [
                    '`cppjs build -p WebAssembly|Android|iOS|All`',
                    '`crossbind build -p wasm|android|ios|wasi`, with `-a` arch, `-r` runtime (`st`, `mt`), `-e` runtime env (`browser`, `node`, `edge`) and `-b` build type',
                ],
                ['`cppjs config get|set|delete|list|keys`', '`crossbind config ...`, the same subcommands'],
                ['`cppjs docker run|create|start|stop|delete`', '`crossbind docker ...`, the same subcommands'],
                ['-', '`crossbind licenses` and `crossbind clean-deps` are new'],
                [
                    '`dist/mylib.browser.js`, `mylib.node.js`, `mylib.wasm`',
                    '`dist/<name>-wasm-wasm32-st-release.browser.js`, `.node.js`, `.edge.js`: the target is part of the file name',
                ],
                [
                    '`dist/prebuilt/Emscripten-x86_64/`, `Android-arm64-v8a/`, `iOS-iphoneos/`',
                    '`dist/prebuilt/<platform>-<arch>-<runtime>-<buildType>/`, for example `wasm-wasm32-mt-release` or `android-arm64-v8a-mt-release`',
                ],
            ],
        },
        {
            type: 'p',
            text: 'A script or a Cloudflare Worker that imports the built module by file name needs the new path; [Runtimes](/guide/runtimes/) shows the current names per environment.',
        },

        { type: 'h2', id: 'native', text: '7. Rebuild native apps' },
        {
            type: 'p',
            text: 'iOS frameworks are identified as `dev.crossbind.<name>` instead of `org.js.cpp.<name>`. In a React Native project run `pod install` again and rebuild both platforms; the JavaScript side needs nothing beyond step 5.',
        },

        { type: 'h2', id: 'new', text: 'What you gain, optional' },
        {
            type: 'ul',
            items: [
                "[Rust](/guide/rust/): `export.type: 'cargo'` and `cargoDependencies`.",
                "[WASI](/guide/wasi/): `platform: 'wasi'` builds and the `-bin-wasi` command tools.",
                "[Threading](/guide/threading/): `target.runtime: 'mt'` and worker mode.",
                '[Filesystem](/guide/filesystem/): persistent OPFS storage in the browser.',
                'Generated TypeScript types through `dts`, see [Configuration](/guide/configuration/).',
            ],
        },

        { type: 'h2', id: 'checklist', text: 'Checklist' },
        {
            type: 'ol',
            items: [
                'Node.js 24 or newer.',
                'Packages swapped; one library variant per platform.',
                '`crossbind.config.js` renamed, dependency imports and `targetSpecs` updated.',
                'Bundler plugin import renamed.',
                '`initCppJs` is `initNative`; no hard-coded `/virtual/` paths.',
                'Build scripts use the new CLI flags and output names.',
                'Mobile: pods reinstalled, both apps rebuilt.',
            ],
        },
    ],
};
