export default {
    slug: 'configuration',
    title: 'Configuration',
    description: 'Everything crossbind.config.js can declare, and how its paths resolve.',
    lede: '`crossbind.config.js` sits at your project root and configures the build. Runtime options go to `initNative(opts)` instead. Most projects need only the lines below.',
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
            text: 'Relative paths resolve from this file. Without it, a build started from another folder looks for your sources in the wrong place.',
        },

        { type: 'h2', id: 'identity', text: 'Identity and dependencies' },
        {
            type: 'entries',
            items: [
                { name: '`general.name`', text: 'Names the output (`lib<name>.a`) and the browser folder `/opfs/<name>/`.', default: 'your package name' },
                {
                    name: '`dependencies`',
                    text: "Other packages' configs, each imported from a platform variant such as `@crossbind/port-*-wasm/crossbind.config.js`, one per platform you build. Their own dependencies come along, and a multithreaded one makes your build `mt` ([Threads and workers](/guide/threading/#mt)).",
                },
                {
                    name: '`packages`',
                    text: 'What the project takes from outside npm: `packages.cargo` holds the crates `cargo:` imports (crate name and Cargo dependency spec), `packages.conan` the packages `conan:` imports. See [Rust](/guide/rust/) and [Conan](/guide/conan/).',
                },
            ],
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `import gdal from '@crossbind/port-gdal-wasm/crossbind.config.js';

export default {
    general: { name: 'my-geo-app' },
    dependencies: [gdal],
    packages: {
        cargo: { uuid: '{ version = "1", features = ["v4"] }' },
        conan: { zlib: '1.3.2' },
    },
    paths: { config: import.meta.url },
};`,
        },

        { type: 'h2', id: 'paths', text: 'Paths' },
        {
            type: 'entries',
            items: [
                { name: '`config`', text: 'Always `import.meta.url`.' },
                { name: '`project`', text: 'The project root.', default: 'the folder of `config`' },
                { name: '`base`', text: 'A root above the project, for a monorepo (see below).' },
                { name: '`native`', text: 'The C++ source roots, **an array**. Their order sets include precedence.', default: "`['src/native']`" },
                { name: '`cache`', text: 'The build cache.', default: '`.crossbind`' },
                { name: '`build`', text: 'The staging folder.', default: '`.crossbind/build`' },
                { name: '`output`', text: 'Where the built files go.', default: 'the same as `build`' },
                { name: '`header`, `module`, `bridge`, `cmake`', text: 'Set them only when your layout differs.', default: 'derived from `native`' },
            ],
        },
        {
            type: 'p',
            text: 'Docker sees nothing above the project folder. In a monorepo, point `base` at the repository root:',
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
            text: "`target` narrows what gets built. Most projects set only `runtime`: `'st'` (the default) or `'mt'`. `mt` asks more of the host; see [Threads and workers](/guide/threading/).",
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
            text: 'Settings for some targets only. An entry applies when every field it sets (`platform`, `arch`, `runtime`, `buildType`, `runtimeEnv`) matches the target.',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `targetSpecs: [
    {
        platform: 'wasm',
        specs: {
            cmake: { compileOptions: ['-DMYAPP_NO_LOGGING=1'] },
            binary: { emccFlags: ['-sINITIAL_MEMORY=128MB'] },
            env: { GDAL_NUM_THREADS: '0' },
            data: { 'share/myapp': 'myapp/data' },
            ignoreLibName: ['libtiff_legacy'],
        },
    },
]`,
        },
        {
            type: 'p',
            text: 'Its most common use, shipping data files, has its own page: [Data files](/guide/assets/).',
        },

        { type: 'h2', id: 'app', text: 'App' },
        {
            type: 'p',
            text: "`app` describes an app (`target: { runtimeEnv: 'app' }`): its name, id, icon and window, the links that open it, the reasons it gives for devices, and its updates. [Apps](/guide/apps/#config) lists every key. `extensions` lists the app's extensions, each from its package's `crossbind.extension.js`.",
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    paths: { config: import.meta.url },
    target: { runtimeEnv: 'app' },
    app: { name: 'My App', icon: 'icon.png' },
};`,
        },

        { type: 'h2', id: 'export', text: 'Export' },
        {
            type: 'p',
            text: '`export` matters only when you publish a package: it describes what its users receive.',
        },
        {
            type: 'entries',
            items: [
                { name: '`type`', text: "`'cmake'` for C and C++, or `'cargo'` for a Rust crate built per platform.", default: "`'cmake'`" },
                { name: '`crate`', text: '`cargo` only: the folder that holds `Cargo.toml`.' },
                { name: '`libName`', text: 'The `.a` basenames the build makes, one per entry.' },
                { name: '`header`, `libPath`', text: 'The include and library folder names inside `dist`.' },
                { name: '`bindings.vectors`', text: 'Extra `Vec<T>` classes to expose without touching the Rust source.' },
                { name: '`wholeArchive`', text: 'Links every archive whole instead of dropping unused code. Use it only when members register themselves from static initializers.' },
            ],
        },

        { type: 'h2', id: 'types', text: 'TypeScript output' },
        {
            type: 'entries',
            items: [
                { name: '`dts`', text: "`'promise'` wraps every generated return type in `Promise<...>`, for worker runtimes.", default: "`'sync'`" },
                {
                    name: '`types`',
                    text: 'For package authors: writes one `.d.ts` over the public headers and sets up `package.json`, so imports of `<pkg>/<any>.h` get types.',
                },
            ],
        },

        { type: 'h2', id: 'advanced', text: 'The rest' },
        {
            type: 'entries',
            items: [
                { name: '`ext`', text: 'Which file extensions count as headers, sources and SWIG modules.' },
                { name: '`build`', text: 'Do not set it here: build hooks live in `crossbind.build.js`, which is merged in.' },
                { name: '`functions.isEnabled`', text: 'Overrides the check whether a target is enabled, which by default asks whether its output exists.' },
            ],
        },
        {
            type: 'p',
            text: 'Machine settings (runner, Xcode team, local wasi-sdk) live in `~/.crossbind/config.json`, never in the project config. When more than one layer can change a setting, use the highest one: see the [override hierarchy](/guide/architecture/#overrides).',
        },

        { type: 'h2', id: 'runtime', text: 'Not in this file: runtime options' },
        {
            type: 'p',
            text: '`useWorker: true` in `crossbind.config.js` does nothing. Runtime options go to `initNative`:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `const m = await initNative({
    useWorker: true,
    fs: { opfs: true },
    env: { TMPDIR: '_CROSSBIND_DATA_PATH_/scratch' },
});`,
        },
        {
            type: 'p',
            text: 'Every option is in [Runtime API](/guide/runtime-api/#options). The ones that change behavior most: [Threads and workers](/guide/threading/) and [Files](/guide/filesystem/).',
        },
    ],
};
