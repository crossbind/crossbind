export default {
    slug: 'assets',
    title: 'Data files',
    description: 'Ship the data files a native library needs, and point it at them on every platform.',
    lede: 'Many C++ libraries need data files: PROJ its coordinate database, GDAL its format tables, OpenSSL a CA bundle. Declare them once in `targetSpecs`, and they are copied to the right place on every platform, with matching environment variables.',
    blocks: [
        { type: 'h2', id: 'shape', text: 'The shape' },
        {
            type: 'p',
            text: 'In a `targetSpecs` entry ([how entries match](/guide/configuration/#target-specs)), `specs.data` copies files and `specs.env` sets environment variables in the running module:',
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
                'A value starting with `/` is an absolute path in the module\'s virtual filesystem, as `/usr/share/proj` in the browser entry.',
                'A value without a leading slash is relative to the platform\'s data folder, which `_CROSSBIND_DATA_PATH_` expands to.',
            ],
        },
        {
            type: 'p',
            text: 'So the browser entry differs: in the browser everything lives in the virtual filesystem, while Node.js and mobile apps have a real data folder on disk.',
        },

        { type: 'h2', id: 'env', text: 'Environment variables' },
        {
            type: 'p',
            text: '`specs.env` values reach the running module, with `_CROSSBIND_DATA_PATH_` replaced by the data folder. A value can also be a function of `(state, target)` that returns a string, for a path known only at build time.',
        },
        {
            type: 'p',
            text: '`initNative()` takes `env` as well, for values not known at build time ([Runtime API](/guide/runtime-api/#logging)).',
        },

        { type: 'h2', id: 'packages', text: 'Assets that come with a package' },
        {
            type: 'p',
            text: 'A prebuilt package declares its own data, so installing `@crossbind/port-proj` brings the coordinate database and its `PROJ_LIB` setting along. Write `targetSpecs` only for data of your own, or to change where a dependency\'s data goes.',
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'WASI',
            text: 'A WASI command of your own gets a `data/` folder beside it: pass `--dir` and `--env` to `wasmtime run` yourself ([Executables](/guide/executables/#wasi)). The prebuilt command-line tools set both up for you.',
        },

        { type: 'h2', id: 'other-specs', text: 'What else targetSpecs carries' },
        {
            type: 'p',
            text: 'The same entries hold the build settings of each target:',
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
            text: 'More in [Configuration](/guide/configuration/#target-specs).',
        },
    ],
};
