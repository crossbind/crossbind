import { BRAND, REPO_URL } from '../../data.js';

export default {
    slug: 'architecture',
    title: 'How it works',
    description: 'What runs when you build: targets, bridges, the toolchain boundary, and the cache.',
    lede: `You never call the compiler yourself, so it helps to know what a ${BRAND} build does, from \`crossbind build\` to the files your bundler picks up.`,
    blocks: [
        { type: 'h2', id: 'pipeline', text: 'The pipeline' },
        {
            type: 'ol',
            items: [
                '**Config.** `crossbind.config.js` is read and merged with `crossbind.build.js` (packages only) and the machine settings in `~/.crossbind/config.json`. Dependencies of dependencies come along; if any is multithreaded, the project builds `mt`.',
                '**Targets.** CLI options narrow the target matrix to the `{platform, arch, runtime, runtimeEnv, buildType}` combinations this machine can build.',
                '**Library.** Per target, your C++ compiles to a static library with CMake or configure: in Docker for wasm, Android and WASI, through Xcode for iOS.',
                '**Bridges.** Each imported header becomes a bridge source that registers its bindings; that is what makes classes and functions appear in JavaScript.',
                "**Link.** The archives link into the wasm module or the WASI command, a Rust crate's archive is staged, and the iOS slices become an xcframework.",
                '**Loader.** The JavaScript loader for the runtime environment is written next to the binary.',
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
            text: 'Everything after the config is per target, and the target is in every file name: `myapp-wasm-wasm32-st-release.browser.js` is platform, arch, runtime, build type and runtime environment. So `st` and `mt` builds cannot be confused, and mixing them in one bundle fails loudly.',
        },

        { type: 'h2', id: 'runtime', text: 'The JavaScript runtime layer' },
        {
            type: 'p',
            text: 'The loader is one core with a small adapter per environment: how files are found (URLs in the browser, the filesystem in Node.js and on the edge), OPFS and file mounting in the browser, and the bridge to a worker. So `initNative()` behaves the same everywhere.',
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
            text: 'Docker sees nothing above the project folder; in a monorepo, set `paths.base` ([Configuration](/guide/configuration/#paths)).',
        },

        { type: 'h2', id: 'cache', text: 'Cache and rebuilds' },
        {
            type: 'table',
            head: ['Path', 'What it holds', 'Safe to delete'],
            rows: [
                ['`.crossbind/`', 'build cache: CMake output, generated bridges, generated types', 'yes; the next build remakes it'],
                ['`dist/prebuilt/<target>/`', 'the static library and headers other packages link against', 'yes, but dependents must rebuild'],
                ['`dist/<name>.<env>.{js,wasm,data.txt}`', 'what your app loads', 'yes'],
            ],
        },
        {
            type: 'p',
            text: 'A build is skipped when its output is newer than the sources. In dev, the bundler plugins rebuild when a `.h` or `.cpp` changes.',
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
            text: 'To change what the build does, use the **highest** layer that works: the higher the layer, the less of the build you own.',
        },
        {
            type: 'ol',
            items: [
                'Narrow which targets build: `target.{platform, arch, runtime, buildType}`.',
                'Per-target flags and data, declaratively: `targetSpecs[].specs.{cmake.compileOptions, binary.emccFlags, env, data, ignoreLibName, binary.wasiFlags}`.',
                'Project-wide: `dependencies`, `functions.isEnabled`, `paths.cmake`.',
                'Package authoring: `crossbind.build.js` hooks - source fetch, patches, build parameters, extra libs.',
                'Machine-wide: `~/.crossbind/config.json` (runner, Xcode team, local wasi-sdk).',
            ],
        },
        {
            type: 'p',
            text: `Layers one to three are in [Configuration](/guide/configuration/), the fourth in [Publishing packages](/guide/publishing/#build-hooks). Every layer in full: [overrides.md](${REPO_URL}/blob/main/docs/api/overrides.md).`,
        },
    ],
};
