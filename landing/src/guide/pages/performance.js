import { REPO_URL } from '../../data.js';

export default {
    slug: 'performance',
    title: 'Performance and size',
    description: 'What ships in a crossbind binary, the build defaults, the flags safe to change, and how to measure speed.',
    lede: 'Every build links only what your imports reach and compiles with production flags. Most apps need none of the settings below, and native code is faster only where a measurement says so.',
    blocks: [
        { type: 'h2', id: 'size', text: 'What ends up in the binary' },
        {
            type: 'p',
            text: 'Libraries link statically, so only the parts your bindings reach ship. Release builds compile with `-O3`; dev servers serve debug builds, so measure size and speed on a production build.',
        },
        {
            type: 'p',
            text: "The bindings decide what is reachable. From a dependency's header only what you import binds ([C++](/guide/bindings/#imports)), and library code that nothing you import reaches stays out:",
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: "import { GDALAllRegister, GDALOpenEx, GDALClose } from '@crossbind/port-gdal/gdal.h';",
        },
        {
            type: 'p',
            text: "`import * as`, `import()`, `require` and a bare `import 'x.h'` bind the whole header. On this site's library demos (2.0.0-beta.63), binding only the imported functions shrank the wasm by 47% for GEOS, 40% for OpenSSL, 11% for zlib and 4% for GDAL.",
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Android ships libraries whole',
            text: 'crossbind builds Android libraries as shared libraries (`.so`), which keep everything they export: on Android, importing fewer functions trims the bindings, not the libraries.',
        },
        {
            type: 'p',
            text: 'Two more things add to what ships: the [data files](/guide/assets/) you declare, and `export.wholeArchive: true`, which links every archive whole (for libraries whose members register themselves from static initializers).',
        },
        { type: 'h3', text: 'Apps' },
        {
            type: 'p',
            text: 'An [app](/guide/apps/) ships no browser engine. The sample app is 6.7 MB on an arm64 Mac, 1.8 MB zipped, 6 MB of it Hermes, the JavaScript engine the bindings run in; it shows its first native result 0.34 s after launch on an M-series Mac. Its Windows executable is 4.6 MB on x64, its iOS app 4.7 MB, and its Android release APK 14.8 MB with both ABIs, of which Google Play delivers one. Leaving out every default extension a plain app has saved 0.22 MB of 12.82 MB on macOS and 0.23 MB of 5.20 MB on Linux.',
        },

        { type: 'h2', id: 'speed', text: 'Speed: measure, do not assume' },
        {
            type: 'p',
            text: 'Native code is not automatically faster than JavaScript. Every call converts its arguments and results, and for a small function that can cost more than the work. What a call costs depends on what crosses. Measured in Node.js on an M-series Mac:',
        },
        {
            type: 'table',
            head: ['Call', 'wasm', 'Node-API addon'],
            rows: [
                ['returns a short `std::string`', 'about 160 ns', 'about 70 ns'],
                ['takes a short `std::string`', 'about 155 ns', 'about 85 ns'],
                ['takes a `const char*`', 'about 0.33 µs', 'about 1.2 µs'],
                ['calls back into JavaScript', 'about 0.5 µs', 'about 2.1 µs'],
            ],
        },
        {
            type: 'p',
            text: 'Compute-bound runs went either way. Before moving work to native code:',
        },
        {
            type: 'ul',
            items: [
                '**Benchmark the real workload** against the JavaScript you would otherwise ship, with representative inputs, on a production build.',
                '**Keep loops on the native side.** One call that runs a whole pipeline crosses the boundary once; a call per element crosses it every time.',
                "**Count the worker hop.** In a browser `useWorker` is on by default, so every call is also a message to the module's worker and back ([Runtime API](/guide/runtime-api/#worker)).",
                "**Profile with the browser's tools:** the Performance tab for time spent in JavaScript and wasm, the Memory tab for the heap, and Lighthouse for the download, which counts toward the page's load metrics.",
            ],
        },

        { type: 'h2', id: 'defaults', text: 'The defaults' },
        {
            type: 'p',
            text: 'Every wasm build gets these. If the app works, leave them.',
        },
        {
            type: 'entries',
            items: [
                { name: 'Optimization', text: 'An `-O` flag of your own comes later and replaces it.', default: '`-O3` in release builds, none in debug' },
                { name: 'SIMD', text: 'On in every wasm build.', default: '`-msimd128`' },
                { name: 'Exceptions', text: 'A C++ throw reaches JavaScript as an `Error`.', default: '`-fwasm-exceptions`' },
                { name: 'Heap', text: "Starts at Emscripten's initial size and grows on demand.", default: '`ALLOW_MEMORY_GROWTH=1`' },
                { name: 'Stack', text: 'A fixed size with no guard page.', default: '64 KB, or 1 MB when the link includes Rust' },
                {
                    name: 'Threads (`mt` builds)',
                    text: 'At most two pthread workers; asking for more aborts.',
                    default: '`-pthread`, a pool of `Math.min(navigator.hardwareConcurrency || 1, 2)` workers, `PTHREAD_POOL_SIZE_STRICT=2`',
                },
                { name: 'Function table', text: 'Raise it on `Cannot enlarge function table`.', default: '`RESERVED_FUNCTION_POINTERS=200`' },
                { name: 'Filesystem', text: '`m.FS`, OPFS and data files rely on them.', default: '`FORCE_FILESYSTEM=1` in every build, `WASMFS` in browser and Node.js builds' },
                { name: 'No eval', text: 'The module runs under a strict Content Security Policy.', default: '`DYNAMIC_EXECUTION=0`' },
                { name: 'Array buffers', text: 'Strings crossing the boundary need it in Firefox and WebKit.', default: '`GROWABLE_ARRAYBUFFERS=0`' },
            ],
        },

        { type: 'h2', id: 'overrides', text: 'Safe overrides' },
        {
            type: 'p',
            text: 'Emscripten flags go in `binary.emccFlags` of a `targetSpecs` entry. Filter the entry by `platform`, `arch`, `runtime`, `buildType` or `runtimeEnv` so a flag reaches only the builds that need it.',
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    paths: { config: import.meta.url },
    targetSpecs: [
        {
            platform: 'wasm',
            specs: { binary: { emccFlags: ['-sINITIAL_MEMORY=64MB'] } },
        },
    ],
};`,
        },
        { type: 'p', text: 'Flags worth changing, and when:' },
        {
            type: 'entries',
            items: [
                { name: '`-sINITIAL_MEMORY=64MB`', text: 'Startup allocates a lot, such as a model or a large dataset, and you see pauses while the heap grows.' },
                {
                    name: '`-sSTACK_SIZE=1MB`',
                    text: 'The C++ uses large local arrays or deep recursion. An overflow is silent in a release build: later, unrelated calls fail with `unreachable` or `memory access out of bounds`. Add `-sSTACK_OVERFLOW_CHECK=2` to find the function.',
                },
                {
                    name: '`-sPTHREAD_POOL_SIZE=8` with `-sPTHREAD_POOL_SIZE_STRICT=1`',
                    text: 'An `mt` build measurably scales past two threads. Strict mode 1 warns and grows the pool instead of aborting.',
                },
                { name: '`-sRESERVED_FUNCTION_POINTERS=1024`', text: 'A run fails with `Cannot enlarge function table`.' },
            ],
        },
        {
            type: 'p',
            text: `A wasm32 heap cannot pass 4 GB. For more, build \`wasm64\`: \`crossbind build -a wasm64\` (a plain build skips it), or \`target: { arch: 'wasm64' }\` with a bundler plugin. Every flag crossbind sets is in [performance.md](${REPO_URL}/blob/main/docs/api/performance.md).`,
        },

        { type: 'h2', id: 'leave-alone', text: 'What to leave alone' },
        {
            type: 'ul',
            items: [
                '`-Os` or `-Oz` for a smaller file: an `-O` flag in `emccFlags` comes after the default `-O3` and replaces it, trading speed for size. Measure both on your own binary before keeping it.',
                'Turning off `ALLOW_MEMORY_GROWTH` for predictable allocation: the first allocation past the initial heap then fails with out of memory instead of growing.',
                'A pool of 32 pthreads for parallelism: each pthread is a Web Worker with its own startup, runtime and stack (only the heap is shared), so raise the pool only as far as a measurement shows the work scales.',
                'Flags that fight the defaults: the loader, `m.FS`, OPFS and data files depend on `MODULARIZE`, `WASMFS` and `FORCE_FILESYSTEM`; strict-CSP pages on `DYNAMIC_EXECUTION=0`; and C++ errors in JavaScript on `-fwasm-exceptions` (the standard library throws even when your own code does not).',
            ],
        },
    ],
};
