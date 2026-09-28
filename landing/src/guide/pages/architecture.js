import { BRAND } from '../../data.js';

export default {
    slug: 'architecture',
    title: 'Architecture',
    description: 'What runs when you build: targets, bridges, the toolchain boundary, and the cache.',
    lede: `You never call the compiler yourself, which is exactly why it helps to know what happens when you do. This is the one-screen model of a ${BRAND} build - from \`crossbind build\` to the files your bundler picks up.`,
    blocks: [
        { type: 'h2', id: 'pipeline', text: 'The pipeline' },
        {
            type: 'ol',
            items: [
                '**Config load.** `crossbind.config.js` is read and merged with `crossbind.build.js` (packages only) and machine settings from `~/.crossbind.json`. Transitive dependencies are flattened; if any of them is multithreaded, the project is promoted to `mt`.',
                '**Target expansion.** CLI flags filter the target matrix down to the `{platform, arch, runtime, runtimeEnv, buildType}` tuples this host can actually build.',
                '**`createLib`.** Per target, your C++ is compiled to a static library - cmake or configure, inside Docker for wasm/Android/WASI, through Xcode for iOS.',
                '**Bridge generation.** Each imported header becomes a bridge translation unit that registers the binding surface; that is what makes classes and functions appear in JavaScript.',
                '**Link.** `buildWasm` links the archives with `emcc`; `buildWasiCommand` links a wasi command; `buildCargo` stages a Rust crate\'s `.a`; `createXCFramework` combines the iOS slices.',
                '**`buildJs`.** Rollup assembles the loader for the chosen runtime environment and writes the final artifacts.',
            ],
        },
        {
            type: 'code',
            file: 'dist/ (after a wasm build)',
            code: `dist/
├── myapp-wasm-wasm32-st-release.browser.js     # loader
├── myapp-wasm-wasm32-st-release.browser.wasm   # module
└── prebuilt/
    └── wasm-wasm32-st-release/
        ├── include/                            # headers for dependent packages
        └── lib/libmyapp.a`,
        },

        { type: 'h2', id: 'targets', text: 'Targets are the unit of work' },
        {
            type: 'p',
            text: 'Everything downstream of config load is per target, and the target name is stamped into every artifact - `myapp-wasm-wasm32-st-release.browser.js` is platform, arch, runtime, build type and runtime environment in one string. That is why `st` and `mt` artifacts can never be confused for one another, and why mixing them in one bundle fails loudly.',
        },

        { type: 'h2', id: 'runtime', text: 'The JavaScript runtime layer' },
        {
            type: 'p',
            text: 'The loader is a shared core plus thin per-environment adapters: URL-based asset resolution in the browser, filesystem-based in Node and on edge; OPFS mounting and file auto-mount in the browser; a Comlink bridge when the module runs in a worker. Supporting a new runtime is one more shim over the same core, which is why `initNative()` behaves identically everywhere.',
        },

        { type: 'h2', id: 'toolchain', text: 'Where the toolchain lives' },
        {
            type: 'table',
            head: ['Target', 'Runs in', 'Needs'],
            rows: [
                ['wasm, Android', 'the digest-pinned Docker image', 'Docker'],
                ['WASI', 'Docker, or a local wasi-sdk when configured', 'Docker or wasi-sdk 34+'],
                ['iOS', 'the host', 'macOS, Xcode, CocoaPods'],
                ['Rust (`export.type: \'cargo\'`)', 'the host', 'the cargo toolchain'],
            ],
        },
        {
            type: 'p',
            text: 'Docker mounts the project path as its working directory, so nothing above that path is visible to the build. In a monorepo, point `paths.base` at the repository root - see [Configuration](/guide/configuration/#paths).',
        },

        { type: 'h2', id: 'cache', text: 'Cache and rebuilds' },
        {
            type: 'table',
            head: ['Path', 'What it holds', 'Safe to delete'],
            rows: [
                ['`.crossbind/`', 'build cache: cmake output, generated bridges, generated types', 'yes - rebuilt on the next build'],
                ['`dist/prebuilt/<target>/`', 'the static library and headers other packages link against', 'yes, but dependents must rebuild'],
                ['`dist/<name>.<env>.{js,wasm,data.txt}`', 'what your app loads', 'yes'],
            ],
        },
        {
            type: 'p',
            text: 'A build short-circuits when the artifact is newer than the sources, which is what keeps incremental builds cheap. Bundler plugins compare source timestamps for you and force a rebuild in dev when a `.h` or `.cpp` changes - that is the hot-reload path.',
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'When a change is not picked up',
            text: 'Restart the dev server first. A stale artifact almost always means the source is older than the output, or `paths.native` does not point where you think it does.',
        },

        { type: 'h2', id: 'overrides', text: 'The override hierarchy' },
        {
            type: 'p',
            text: 'When you need to change what the build does, reach for the **highest** layer that solves it - the higher the layer, the less of the pipeline you take ownership of.',
        },
        {
            type: 'ol',
            items: [
                'Narrow which targets build: `target.{platform, arch, runtime, buildType}`.',
                'Per-target flags and data, declaratively: `targetSpecs[].specs.{cmake.compileOptions, binary.emccFlags, env, data, ignoreLibName, binary.wasiFlags}`.',
                'Project-wide: `dependencies`, `env`, `functions.isEnabled`.',
                'Package authoring: `crossbind.build.js` hooks - source fetch, patches, build parameters, extra libs.',
                'Cross-package plugins: `extensions[]` hooks at config-load and build-step boundaries.',
                'Machine-wide: `~/.crossbind.json` (runner, Xcode team, local wasi-sdk).',
            ],
        },
        {
            type: 'p',
            text: 'Layers one to three live in [Configuration](/guide/configuration/); the rest are package-author territory, documented in the API reference linked from the sidebar.',
        },
    ],
};
