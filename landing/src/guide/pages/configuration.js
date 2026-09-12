export default {
    slug: 'configuration',
    title: 'Configuration',
    description: 'Everything crossbind.config.js can declare, and how its paths resolve.',
    lede: '`crossbind.config.js` sits at your project root and is read once by the build. It is **build-time only** - runtime options belong in the `initNative(opts)` call instead. Most projects need three lines of it; the rest of this page is what the remaining keys do when you need them.',
    blocks: [
        { type: 'h2', id: 'minimal', text: 'The minimum' },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    paths: {
        config: import.meta.url,
    },
};`,
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Always set paths.config',
            text: 'It anchors every relative path to this file. Without it, a build started from another working directory resolves your sources against the wrong root.',
        },

        { type: 'h2', id: 'identity', text: 'Identity and dependencies' },
        {
            type: 'table',
            head: ['Key', 'What it does'],
            rows: [
                [
                    '`general.name`',
                    'the logical name: output binaries (`lib<name>.a`), and the browser filesystem namespace `/opfs/<name>/`. Defaults to your package name.',
                ],
                [
                    '`dependencies`',
                    "an array of other packages' configs, imported from a platform variant such as `@crossbind/port-*-wasm/crossbind.config.js`, one per platform you build. Transitive dependencies are flattened automatically.",
                ],
                [
                    '`cargoDependencies`',
                    'crates importable through `cargo:` - keys are crate names, values are Cargo dependency specs. See [Rust](/guide/rust/).',
                ],
            ],
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `import gdal from '@crossbind/port-gdal-wasm/crossbind.config.js';

export default {
    general: { name: 'my-geo-app' },
    dependencies: [gdal],
    cargoDependencies: { uuid: '{ version = "1", features = ["v4"] }' },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: 'One consequence worth remembering: if any dependency is built multithreaded, your project is promoted to `mt` as well.',
        },

        { type: 'h2', id: 'paths', text: 'Paths' },
        {
            type: 'table',
            head: ['Key', 'Default', 'What it points at'],
            rows: [
                ['`config`', '-', 'always `import.meta.url`'],
                ['`project`', 'the directory of `config`', 'the project root'],
                ['`base`', '-', 'an alternative root - use it in a monorepo so Docker can see the whole workspace'],
                ['`native`', "`['src/native']`", '**an array** of C++ source roots; order sets include precedence'],
                ['`cache`', '`.crossbind`', 'build cache'],
                ['`build`', '`.crossbind/build`', 'staging directory'],
                ['`output`', 'same as `build`', 'where dist artifacts are written'],
                ['`header`, `module`, `bridge`, `cmake`', 'derived from `native`', 'override only when your layout differs'],
            ],
        },
        {
            type: 'p',
            text: 'Docker mounts the project path as its working directory and cannot see anything above it. In a monorepo, point `base` at the repository root:',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    paths: {
        config: import.meta.url,
        base: '../..',
    },
};`,
        },

        { type: 'h2', id: 'target', text: 'Target' },
        {
            type: 'p',
            text: "`target` narrows what gets built. `runtime` is the one people set most - `'st'` (default) or `'mt'`; see [Threading](/guide/threading/) for what `mt` demands from your host.",
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    paths: { config: import.meta.url },
    target: { runtime: 'mt' },
};`,
        },

        { type: 'h2', id: 'target-specs', text: 'targetSpecs' },
        {
            type: 'p',
            text: 'Per-target overrides, expressed as filter plus specs. Any of `platform`, `arch`, `runtime`, `buildType` and `runtimeEnv` may appear in the filter; an entry applies when every field you set matches.',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `targetSpecs: [
    {
        platform: 'wasm',
        specs: {
            cmake: ['-DSOMETHING=ON'],
            emccFlags: ['-sINITIAL_MEMORY=128MB'],
            env: { GDAL_NUM_THREADS: '0' },
            data: { 'share/myapp': 'myapp/data' },
            ignoreLibName: ['libtiff_legacy'],
        },
    },
]`,
        },
        {
            type: 'p',
            text: 'Shipping data files is the most common use - that has its own page, [Assets](/guide/assets/).',
        },

        { type: 'h2', id: 'export', text: 'Export' },
        {
            type: 'p',
            text: 'Only relevant when you publish a package. It describes what consumers receive.',
        },
        {
            type: 'table',
            head: ['Key', 'What it does'],
            rows: [
                ['`type`', "`'cmake'` (default, the C/C++ pipeline) or `'cargo'` (a Rust crate built per platform)"],
                ['`crate`', '`cargo` only: the directory holding `Cargo.toml`'],
                ['`libName`', 'the `.a` basenames produced, one per entry'],
                ['`header`, `libPath`', 'the include and library directory names inside dist'],
                ['`bindings.vectors`', 'extra `Vec<T>` classes to expose without touching Rust source'],
                [
                    '`wholeArchive`',
                    'link every archive wholesale instead of eliminating dead code - only when members self-register from static initialisers',
                ],
            ],
        },

        { type: 'h2', id: 'types', text: 'TypeScript output' },
        {
            type: 'table',
            head: ['Key', 'What it does'],
            rows: [
                ['`dts`', "`'sync'` (default) or `'promise'`, which wraps every generated return in `Promise<...>` for worker runtimes"],
                [
                    '`types`',
                    'package authors: emit one combined `.d.ts` over the public headers and wire `package.json` so consumers importing `<pkg>/<any>.h` get types',
                ],
            ],
        },

        { type: 'h2', id: 'advanced', text: 'The rest' },
        {
            type: 'table',
            head: ['Key', 'What it does'],
            rows: [
                ['`ext`', 'which extensions count as headers, sources and SWIG modules'],
                ['`build`', 'do not set this directly - build hooks live in `crossbind.build.js` and are merged in'],
                [
                    '`extensions`',
                    'plugin objects with hooks at config-load and build-step boundaries; for sharing one override across several packages',
                ],
                ['`functions.isEnabled`', 'override the "is this target enabled?" check, which by default asks whether the output already exists'],
            ],
        },
        {
            type: 'p',
            text: 'Reach for the highest layer that solves your problem - see the [override hierarchy](/guide/architecture/#overrides). Machine-wide settings (runner, Xcode team, log level, local wasi-sdk) live in `~/.crossbind.json` and never belong in the project config.',
        },

        { type: 'h2', id: 'runtime', text: 'Not in this file: runtime options' },
        {
            type: 'p',
            text: 'A frequent mistake is putting `useWorker: true` in `crossbind.config.js`, where it does nothing. Runtime options are arguments to the boot call:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `const m = await initNative({
    useWorker: true,
    fs: { opfs: true },
    env: { TMPDIR: '_CROSSBIND_DATA_PATH_/scratch' },
    logHandler: (text) => console.debug(text),
    errorHandler: (text) => console.error(text),
});`,
        },
        {
            type: 'p',
            text: 'The full option list is in the API reference; the ones that change behaviour most are covered in [Threading](/guide/threading/) and [Filesystem](/guide/filesystem/).',
        },
    ],
};
