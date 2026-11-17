import { CREATE_COMMAND, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

const RANGE = `^${RELEASE.version}`;

export default {
    slug: 'publishing',
    title: 'Publishing packages',
    description: 'Ship your own C, C++ or Rust to npm as prebuilt packages for every platform, the way the ports are built.',
    lede: 'A crossbind package is an npm package with a `crossbind.config.js` that apps list in their `dependencies`. You build it once per platform and publish the libraries; apps link them without compiling your code. Every `@crossbind/port-*` package is made this way.',
    blocks: [
        { type: 'h2', id: 'package-types', text: 'Package types' },
        {
            type: 'entries',
            items: [
                { name: 'Prebuilt', type: "export.type: 'cmake'", text: 'The default. Compiled libraries per platform under `dist/prebuilt/`, so the app compiles nothing of yours. The ports are prebuilt, and so is what the rest of this page builds.' },
                { name: 'Source', type: "export.type: 'source'", text: "Your headers and sources, compiled in the app's own build." },
                {
                    name: 'CMake',
                    type: "export.type: 'cmake'",
                    text: "Your own `CMakeLists.txt`, with `paths.output: '.'`: the app adds it with `add_subdirectory` and builds it. Name the library target after the `CROSSBIND_LIB_NAME` the app's build passes in, since only that target's `PUBLIC` include directories reach the app.",
                },
                { name: 'Cargo', type: "export.type: 'cargo'", text: 'A Rust crate built per platform; see [Rust crates](#rust).' },
            ],
        },
        {
            type: 'p',
            text: `Each C++ type has a template: \`${CREATE_COMMAND} -- my-lib Library Prebuilt\`, with \`Source\` or \`CMake\` in place of \`Prebuilt\`.`,
        },

        { type: 'h2', id: 'config', text: 'The package config' },
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
            text: "`export.libName` lists the archives the package ships, one per library (`['ssl', 'crypto']` for OpenSSL); it defaults to `general.name`. `paths.output` is the folder you publish. `types: true` writes one declaration file for the package's headers and points `package.json`'s `types` at it, so imports of `mylib/<header>.h` get types. The other `export` fields are in [Configuration](/guide/configuration/#export).",
        },
        {
            type: 'p',
            text: "A package's `targetSpecs` reach every app that depends on it: the `data` and `env` it declares ([Data files](/guide/assets/#packages)), and flags such as `binary.addonFlags` for a system library a Node.js addon must link, or `cmake.compileOptions` for a define your headers expect.",
        },

        { type: 'h2', id: 'build', text: 'Build once per platform' },
        {
            type: 'p',
            text: 'Without `-e`, `crossbind build` makes only the libraries, which is what a package publishes: static archives, and shared libraries on Android. Run it for each platform you support; iOS and macOS build on a Mac, the rest in the toolchain images:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `crossbind build -p wasm
crossbind build -p android
crossbind build -p ios
crossbind build -p darwin,linux,linuxmusl,win32`,
        },
        {
            type: 'p',
            text: 'Each target gets a folder named `<platform>-<arch>-<runtime>-<buildType>`:',
        },
        {
            type: 'code',
            file: 'dist/',
            code: `dist/prebuilt/
├── CMakeLists.txt
├── wasm-wasm32-st-release/{include,lib}
├── wasm-wasm32-mt-release/{include,lib}
├── android-arm64-v8a-mt-release/{include,lib}
├── ios-iphoneos-mt-release/{include,lib}
└── linux-x64-mt-release/{include,lib}`,
        },
        {
            type: 'p',
            text: "`dist/prebuilt/CMakeLists.txt` is how an app's build finds your libraries, and an import path after your package name resolves in the target's `include/`. An iOS build also writes `<libName>.xcframework` at the package root, and a `.podspec` beside it when the package has none.",
        },
        {
            type: 'p',
            text: "Publish `dist/`, the xcframework and the podspec, and keep `.crossbind/` out, as the ports' `.npmignore` does. A `prepublishOnly` script that runs the build keeps `npm publish` from shipping stale libraries.",
        },

        { type: 'h2', id: 'family', text: 'One package, or a family' },
        {
            type: 'p',
            text: `One package can carry every platform, as [lib-prebuilt-matrix](${REPO_URL}/tree/main/examples/lib-prebuilt-matrix) does, but then every app downloads all of them. The ports split each library into a family instead: a meta package, \`@crossbind/port-zlib\`, with the shared recipe and config, and one package per platform (\`-wasm\`, \`-android\`, \`-ios\`, \`-darwin\`, \`-linux\`, \`-linuxmusl\`, \`-win32\`, \`-wasi\`), each depending on the meta package and built with its own \`crossbind build -p <platform>\`.`,
        },
        {
            type: 'p',
            text: "`general.alias` makes the variants one library to an app: every variant names the meta package there, so `@crossbind/port-zlib/zlib.h` resolves to the variant in the app's `dependencies` that has libraries for the target. The config of zlib's wasm variant comes down to:",
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: {
        name: 'z',
        alias: { package: '@crossbind/port-zlib' },
    },
    export: { type: 'cmake', publicHeaders: ['zlib.h'] },
    paths: { config: import.meta.url, output: 'dist' },
};`,
        },
        {
            type: 'p',
            text: "zlib writes the shared part once, in the meta package's `mergeConfig.mjs`, and each variant's config calls it; each variant's `crossbind.build.js` is one line, `export { default } from '@crossbind/port-zlib/build.mjs';`, re-exporting the recipe.",
        },

        { type: 'h2', id: 'build-hooks', text: 'Wrapping an upstream project' },
        {
            type: 'p',
            text: "To package a library you do not maintain, put a `crossbind.build.js` next to the config. `crossbind build` then downloads the tarball of the `nativeVersion` in `package.json`, checks its SHA-256, applies your patches and builds it with the upstream's own build system for each target. zlib's recipe, shortened:",
        },
        {
            type: 'code',
            file: 'crossbind.build.js',
            code: `export default {
    sha256: 'bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16',
    getURL: (version) => \`https://github.com/madler/zlib/releases/download/v\${version}/zlib-\${version}.tar.gz\`,
    buildType: 'cmake',
    getBuildParams: () => ['-DZLIB_BUILD_SHARED=OFF', '-DZLIB_BUILD_TESTING=OFF'],
};`,
        },
        {
            type: 'entries',
            items: [
                { name: '`getURL(version)`, `sha256`', text: 'Name the upstream tarball and pin it; a different download refuses to build.' },
                { name: '`buildType`', text: "`'cmake'` (the default) or `'configure'` for autotools; `configureProgram` and `makePhases` adjust the two steps." },
                { name: '`getBuildParams(target, depPaths)`', text: '`-D` flags or configure arguments, per target.' },
                { name: '`env`', text: '`CFLAGS`, `LDFLAGS` and the like for the upstream build, as a list or a function of the target.' },
                { name: '`patches`', text: 'Upstream fixes the pinned release lacks, as the diffs upstream published; one that no longer applies stops the build.' },
                { name: '`replaceList`, `sourceReplaceList(target, depPaths)`', text: "Patch the extracted source once, or each target's copy." },
                { name: '`copyToSource`, `copyToDist`', text: "Add a file to the source before the build, or ship one in each target's folder." },
                { name: '`beforeRun(cmakeDir)`', text: 'Commands to run first, such as `autoreconf -fi`.' },
                { name: '`getExtraLibs(target)`', text: 'Link libraries the dependencies do not bring.' },
                { name: '`bundled`', text: 'Third-party code the upstream compiles in, per platform, so its license is listed and shipped.' },
            ],
        },
        {
            type: 'p',
            text: `The build already puts your native dependencies' include and library folders on \`CFLAGS\` and \`LDFLAGS\`; \`depPaths.<libName>.header\` and \`.lib\` name them per target for flags like GDAL's \`-DZLIB_INCLUDE_DIR\`. When a recipe builds a static library on Android, say so in the config with \`targetSpecs: [{ platform: 'android', specs: { libType: 'static' } }]\`, as zlib does, so apps link the archive instead of looking for a \`.so\`. Every argument: [crossbind-build.md](${REPO_URL}/blob/main/docs/api/crossbind-build.md).`,
        },

        { type: 'h2', id: 'dependencies', text: 'Native dependencies' },
        {
            type: 'p',
            text: "A package that links another declares it twice, each time with the variant that matches its own (a `-wasm` package depends on `-wasm` packages). The config's `dependencies` is what crossbind links and puts on the include path. The `dependencies` of `package.json` install it with your package and, in a workspace, build it before yours. Neither does the other's job.",
        },
        {
            type: 'code',
            file: 'package.json',
            code: `{
    "name": "@crossbind/port-gdal-wasm",
    "dependencies": {
        "@crossbind/port-gdal": "${RANGE}",
        "@crossbind/port-proj-wasm": "${RANGE}",
        "@crossbind/port-zlib-wasm": "${RANGE}"
    }
}`,
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `import mergeConfig from '@crossbind/port-gdal/mergeConfig.mjs';
import projWasm from '@crossbind/port-proj-wasm/crossbind.config.js';
import zlibWasm from '@crossbind/port-zlib-wasm/crossbind.config.js';

export default mergeConfig({
    dependencies: [projWasm, zlibWasm],
    paths: { config: import.meta.url },
});`,
        },

        { type: 'h2', id: 'rust', text: 'Rust crates' },
        {
            type: 'p',
            text: "A Rust crate ships as one package for every platform. Set `export.type: 'cargo'` and point `export.crate` at the folder holding `Cargo.toml`. The crate stays plain Rust: crossbind generates the bindings from the public items of its `src/lib.rs`.",
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'demo' },
    export: {
        type: 'cargo',
        libName: ['demo'],
        crate: '.',
        bindings: {
            vectors: [{ of: 'i32', name: 'RustIntVector' }],
        },
    },
    paths: {
        config: import.meta.url,
        output: 'dist',
    },
};`,
        },
        {
            type: 'p',
            text: '`crossbind build -p <platform>` builds the crate for each target and puts the static library in `dist/prebuilt/<target>/lib/`, like any prebuilt; WASI is skipped. Add `@crossbind/core-embind-rust` as a dev dependency. `bindings.vectors` declares standalone `Vec<T>` classes of `i32`, `f64` or `bool`.',
        },
        {
            type: 'p',
            text: "Apps import the package by name, as in `import { initNative, RustyCounter } from '@crossbind/embind-rust-demo'`, with types mapped as on the [Rust](/guide/rust/#mapping) page. An app that finds no prebuilt for its target, or one built against another embind-rs, builds it first, with the toolchain any Rust build needs ([Rust](/guide/rust/#setup)).",
        },

        { type: 'h2', id: 'licenses', text: 'Licenses' },
        {
            type: 'p',
            text: 'An app that ships your package takes on its license and those of everything linked in, so make that checkable, as the ports do:',
        },
        {
            type: 'ul',
            items: [
                'Pin the upstream source with `sha256` in the recipe. A mismatch refuses the build; without a pin the download is not checked.',
                "Ship the upstream license text as `LICENSE` in every package that carries binaries, and set the npm `license` field to the wrapped library's license as an SPDX expression.",
                "In a family, record the upstream license once, in the meta package's `package.json` under `crossbind.upstream.license`: `declared`, `selected` for your pick of an `OR` expression, `files` and `copyright`. `crossbind licenses` reads it there; a package outside a family it lists from its `license` field and `LICENSE` file.",
                'Declare third-party code the upstream compiles in under `bundled` in the recipe. The build copies its license texts to `dist/licenses/<name>/`, and `crossbind licenses --platform <platform>` lists it.',
            ],
        },
        {
            type: 'p',
            text: 'Run `crossbind licenses --check` in each platform package before you publish. Apps then write notices and an SBOM for everything they link with `--notices` and `--sbom` ([CLI](/guide/cli/#licenses)).',
        },
    ],
};
