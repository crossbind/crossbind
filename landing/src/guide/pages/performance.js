import { REPO_URL } from '../../data.js';

export default {
    slug: 'performance',
    title: 'Performance and size',
    description: 'What ships in a crossbind binary, the build defaults, the flags safe to change, and how to measure speed.',
    lede: 'Every build links only what your imports reach and compiles with production flags. Most apps should change none of the defaults; this page shows what ships, the few flags worth tuning, and why native code has to earn its place with a measurement.',
    blocks: [
        { type: 'h2', id: 'size', text: 'What ends up in the binary' },
        {
            type: 'p',
            text: 'Libraries link as static archives, and a static link takes only the parts of an archive your bindings reach. Release builds compile with `-O3`; debug builds skip optimization, and the bundler dev servers serve debug builds, so measure size and speed on a production build.',
        },
        {
            type: 'p',
            text: 'The bindings decide what is reachable. Your own headers bind every function and class. A header from a dependency - a [port](/guide/libraries/) or a [ConanCenter](/guide/conan/) package - binds all its enums but only the free functions you import from it by name and the classes those reach, so a function or class your imports never reach, and the library code only it reaches, stays out:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: "import { GDALAllRegister, GDALOpenEx, GDALClose } from '@crossbind/port-gdal/gdal.h';",
        },
        {
            type: 'p',
            text: "`import * as`, `import()`, `require` and a bare `import 'x.h'` take the header whole and bind every function. Measured for the 2.0.0-beta.63 release on this site's library demos, which call a port straight from JavaScript, binding only the imported functions shrank the wasm by 47% for GEOS, 40% for OpenSSL, 11% for zlib and 4% for GDAL. [C++](/guide/bindings/#imports) has the binding rules.",
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Android ships libraries whole',
            text: 'crossbind builds Android libraries as shared libraries (`.so`), which keep everything they export: on Android, importing fewer functions trims the bindings, not the libraries.',
        },
        {
            type: 'p',
            text: 'Two more things add to what ships. Data files you declare travel with the module ([Data files](/guide/assets/)). `export.wholeArchive: true` links every archive whole instead of only the parts it needs - meant for libraries whose members register themselves from static initializers.',
        },

        { type: 'h2', id: 'speed', text: 'Speed: measure, do not assume' },
        {
            type: 'p',
            text: 'Native code is not automatically faster than JavaScript. Every call crosses a boundary that converts its arguments and results, and for a small function the crossing can cost more than the work. What a call costs depends on what crosses - a number, a string, a `const char*`, a callback into JavaScript - and [Node.js](/guide/node/#which) has measured numbers for wasm against a Node-API addon.',
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
            text: 'Every wasm build gets these. If the build runs and the app works, leave them as they are.',
        },
        {
            type: 'table',
            head: ['Setting', 'Default', 'Notes'],
            rows: [
                ['Optimization', '`-O3` in release builds, none in debug', 'an `-O` flag of your own comes later and replaces it'],
                ['SIMD', '`-msimd128`', 'on every wasm build'],
                ['Exceptions', '`-fwasm-exceptions`', 'a C++ throw reaches JavaScript as an `Error`'],
                ['Heap', '`ALLOW_MEMORY_GROWTH=1`', "starts at Emscripten's initial size and grows on demand"],
                ['Stack', '64 KB, or 1 MB when the link includes Rust', 'fixed size, no guard page'],
                [
                    'Threads (`mt` builds)',
                    '`-pthread`, a pool of `Math.min(navigator.hardwareConcurrency || 1, 2)` workers, `PTHREAD_POOL_SIZE_STRICT=2`',
                    'at most two pthread workers; asking for more aborts',
                ],
                ['Function table', '`RESERVED_FUNCTION_POINTERS=200`', 'raise it on `Cannot enlarge function table`'],
                ['Filesystem', '`FORCE_FILESYSTEM=1` in every build, `WASMFS` in browser and Node.js builds', '`m.FS`, OPFS and data files rely on them'],
                ['No eval', '`DYNAMIC_EXECUTION=0`', 'the module runs under a strict Content Security Policy'],
                [
                    'Array buffers',
                    '`GROWABLE_ARRAYBUFFERS=0`',
                    "Firefox's and WebKit's `TextDecoder` reject views over resizable buffers, which would break every string crossing the boundary",
                ],
            ],
        },

        { type: 'h2', id: 'overrides', text: 'Safe overrides' },
        {
            type: 'p',
            text: 'Emscripten flags go under `binary.emccFlags` in a `targetSpecs` entry and apply to wasm builds. Filter the entry by `platform`, `arch`, `runtime`, `buildType` or `runtimeEnv` so a flag reaches only the builds that need it.',
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
        {
            type: 'table',
            head: ['Flag', 'Reach for it when'],
            rows: [
                ['`-sINITIAL_MEMORY=64MB`', 'startup allocates a lot - a model, a large dataset - and you see pauses while the heap grows'],
                [
                    '`-sSTACK_SIZE=1MB`',
                    'the C++ uses large local arrays or deep recursion. An overflow is silent in a release build: it overwrites static data, and later, unrelated calls fail with `unreachable` or `memory access out of bounds`. Add `-sSTACK_OVERFLOW_CHECK=2` to find the function.',
                ],
                [
                    '`-sPTHREAD_POOL_SIZE=8` with `-sPTHREAD_POOL_SIZE_STRICT=1`',
                    'an `mt` build measurably scales past two threads. Strict mode 1 warns and grows the pool instead of aborting.',
                ],
                ['`-sRESERVED_FUNCTION_POINTERS=1024`', 'a run fails with `Cannot enlarge function table`'],
            ],
        },
        {
            type: 'p',
            text: `A wasm32 heap cannot pass 4 GB. For more, build the \`wasm64\` arch: \`crossbind build -a wasm64\`, which a plain build skips, or \`target: { arch: 'wasm64' }\` with a bundler plugin. Every flag crossbind sets, with what each one is for, is listed in [performance.md](${REPO_URL}/blob/main/docs/api/performance.md).`,
        },

        { type: 'h2', id: 'leave-alone', text: 'What to leave alone' },
        {
            type: 'ul',
            items: [
                '`-Os` or `-Oz` for a smaller file: an `-O` flag in `emccFlags` comes after the default `-O3` and replaces it, trading speed for size. Measure both on your own binary before keeping it.',
                'Turning off `ALLOW_MEMORY_GROWTH` for predictable allocation: the first allocation past the initial heap then fails with out of memory instead of growing.',
                'A pool of 32 pthreads for parallelism: each pthread is a Web Worker with its own startup time, JavaScript runtime and stack - only the heap is shared - so raise the pool only as far as a measurement shows the work scales.',
                'Flags that fight the defaults: the loader, `m.FS`, OPFS and data files depend on `MODULARIZE`, `WASMFS` and `FORCE_FILESYSTEM`, strict-CSP pages on `DYNAMIC_EXECUTION=0`, and C++ errors in JavaScript on `-fwasm-exceptions` - `std::vector`, `std::string` and `std::map` throw even when your own code does not.',
            ],
        },
    ],
};
