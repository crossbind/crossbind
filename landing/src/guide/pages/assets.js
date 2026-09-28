export default {
    slug: 'assets',
    title: 'Assets and data files',
    description: 'Ship the data files a native library needs, and point it at them on every platform.',
    lede: 'Plenty of C++ libraries refuse to work without their data: PROJ wants its coordinate database, GDAL its format tables, OpenSSL a CA bundle. Declare those files once in `targetSpecs` and they are copied to the right place on every platform, with the environment variables wired to match.',
    blocks: [
        { type: 'h2', id: 'shape', text: 'The shape' },
        {
            type: 'p',
            text: 'Each entry in `targetSpecs` is a filter plus overrides. The filter fields - `platform`, `arch`, `runtime`, `buildType`, `runtimeEnv` - are all optional; an entry applies to every build target that matches the fields you did set. `specs.data` copies files, `specs.env` sets environment variables inside the running module.',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    paths: { config: import.meta.url },
    targetSpecs: [
        {
            platform: 'wasm',
            runtimeEnv: 'browser',
            specs: {
                data: { 'share/proj': '/usr/share/proj' },
                env: { PROJ_LIB: '/usr/share/proj' },
            },
        },
        {
            platform: 'wasm',
            runtimeEnv: 'node',
            specs: {
                data: { 'share/proj': 'proj' },
                env: { PROJ_LIB: '_CROSSBIND_DATA_PATH_/proj' },
            },
        },
        {
            platform: 'android',
            specs: {
                data: { 'share/proj': 'proj' },
                env: { PROJ_LIB: '_CROSSBIND_DATA_PATH_/proj' },
            },
        },
        {
            platform: 'ios',
            specs: {
                data: { 'share/proj': 'proj' },
                env: { PROJ_LIB: '_CROSSBIND_DATA_PATH_/proj' },
            },
        },
    ],
};`,
        },

        { type: 'h2', id: 'data', text: 'How data paths resolve' },
        {
            type: 'p',
            text: 'In `data`, the **key** is where the files are in the build (`share/proj`), and the **value** is where they land on the target platform.',
        },
        {
            type: 'ul',
            items: [
                'A value starting with `/` is an absolute path inside the module\'s virtual filesystem - `/usr/share/proj` in the browser example.',
                'A value without a leading slash is relative to the platform\'s data directory, the one `_CROSSBIND_DATA_PATH_` expands to.',
            ],
        },
        {
            type: 'p',
            text: 'That is why the browser entry differs from the others: in the browser everything lives in the virtual filesystem, while Node and mobile have a real directory on disk that the runtime resolves at load time.',
        },

        { type: 'h2', id: 'env', text: 'Environment variables' },
        {
            type: 'p',
            text: '`specs.env` values are passed into the wasm (or native) process, and `_CROSSBIND_DATA_PATH_` inside any value is replaced with the runtime data path. Values can also be functions of `(state, target)` when the path is only known at build time - they resolve lazily and produce a string.',
        },
        {
            type: 'p',
            text: 'Runtime `env` can also be set per call, which is handy for anything that is not a build-time constant:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `const m = await initNative({
    env: { TMPDIR: '_CROSSBIND_DATA_PATH_/scratch' },
});`,
        },

        { type: 'h2', id: 'packages', text: 'Assets that come with a package' },
        {
            type: 'p',
            text: 'A prebuilt package carries its own data declarations, so installing `@crossbind/port-proj` brings the coordinate database and its `PROJ_LIB` wiring along with it. You only write `targetSpecs` for data of your own - or to override where a dependency\'s data goes.',
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'WASI is the same declaration, different mechanics',
            text: 'On `platform: \'wasi\'` the `data` and `env` entries double as the runtime contract for the command: data directories become `--dir` preopens and `env` becomes the guest environment, with `_CROSSBIND_DATA_PATH_` pointing at the mounted directory. See [WASI commands](/guide/wasi/).',
        },

        { type: 'h2', id: 'other-specs', text: 'What else targetSpecs carries' },
        {
            type: 'p',
            text: 'The same entries are where per-target build flags live, which keeps every platform-specific tweak in one list:',
        },
        {
            type: 'table',
            head: ['Key', 'Effect'],
            rows: [
                ['`cmake.compileOptions`', 'extra compiler flags for the sources crossbind compiles itself'],
                ['`binary.emccFlags`', 'extra flags for the emscripten link (wasm only)'],
                ['`binary.wasiFlags`', 'extra flags for the wasi command link'],
                ['`env`', 'environment variables for the build and the running module'],
                ['`data`', 'data files to ship, as described above'],
                ['`ignoreLibName`', 'drop a specific `.a` from the link line'],
            ],
        },
        {
            type: 'p',
            text: 'The full list of configuration keys is in [Configuration](/guide/configuration/#target-specs).',
        },
    ],
};
