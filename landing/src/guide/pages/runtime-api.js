import { installCommand, REPO_URL } from '../../data.js';

export default {
    slug: 'runtime-api',
    title: 'Runtime API',
    description: 'initNative(opts) in full: where it comes from, every option it takes, and the module it resolves to.',
    lede: "`initNative()` starts the native runtime and resolves to the module. Every generated module exports it, and one call serves every native import of the app. Its options are runtime choices: `crossbind.config.js` does not reach it, apart from the build's `env`.",
    blocks: [
        { type: 'h2', id: 'model', text: 'The 30-second model' },
        {
            type: 'p',
            text: 'At build time, `crossbind build` (or your bundler plugin) compiles the native code as `crossbind.config.js` says. At run time, your app calls `initNative()` once; when it resolves, every binding is ready.',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, Native } from './native/native.h';

await initNative();
console.log(await Native.sample());`,
        },
        {
            type: 'p',
            text: 'Named imports are `null` until the promise resolves. A module imported after the runtime started is bound as soon as it loads.',
        },

        { type: 'h2', id: 'where', text: 'Where it comes from' },
        {
            type: 'p',
            text: 'With a bundler plugin, import it from any header, `.rs` file, `cargo:` crate or `conan:` header you already import: they all export the same function. The first call starts the runtime and binds every imported module. Later calls resolve to the same module and ignore their options.',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, Matrix } from './native/Matrix.h';
import { Uuid } from 'cargo:uuid';
import { zlibVersion } from 'conan:zlib/zlib.h';

await initNative();`,
        },
        {
            type: 'p',
            text: 'Without a bundler, import the built loader from the output folder (`paths.output`, `dist` here) and call its default export. Node.js and edge builds also write an ES module per runtime that exports `initNative` and every bound name: `node/wasm.mjs`, `node/napi.mjs` and `edge/wasm.mjs`. On a plain page, a `<script>` tag with the browser loader defines a global `initNative`.',
        },
        {
            type: 'code',
            file: 'src/index.mjs',
            code: `import initNative from '../dist/my-app-wasm-wasm32-st-release.node.js';

const { Native } = await initNative();
console.log(Native.sample());`,
        },

        { type: 'h2', id: 'options', text: 'Options' },
        {
            type: 'p',
            text: 'The wasm runtimes (browser, Node.js and edge) take the same options with different defaults. A runtime ignores an option it has no use for.',
        },
        {
            type: 'entries',
            items: [
                {
                    name: '`useWorker`',
                    type: 'boolean',
                    text: 'Browser: runs the module in a Web Worker, so every call returns a promise ([worker mode](#worker)). OPFS needs it.',
                    default: '`true` where `Worker` exists, as in every browser',
                },
                { name: '`workerUrl`', type: 'string', text: 'Browser, worker mode: the script the worker starts from.', default: 'the loader script' },
                {
                    name: '`fs.opfs`',
                    type: 'boolean',
                    text: 'Browser: mounts the Origin Private File System at `/opfs`, inside the worker only. See [Files](/guide/filesystem/).',
                    default: '`true` in an `mt` browser build, `false` in an `st` one',
                },
                {
                    name: '`env`',
                    type: 'object of strings',
                    text: "Environment variables of the native process, merged over the build's. `_CROSSBIND_DATA_PATH_` in a value becomes the data folder.",
                    default: "the build's `env`",
                },
                { name: '`logHandler`', type: "(text, 'stdout') => void", text: 'Receives each line the C++ writes to stdout.', default: '`console.debug` with a `wasm stdout:` prefix' },
                { name: '`errorHandler`', type: "(text, 'stderr') => void", text: 'Receives each line written to stderr.', default: '`console.error` with a `wasm stderr:` prefix' },
                { name: '`onRuntimeInitialized`', type: '(m) => void', text: 'Runs once the runtime is ready, before the promise resolves.' },
                {
                    name: '`getWasmFunction`',
                    type: '() => WebAssembly.Module',
                    text: 'Instantiates a module you already hold instead of fetching the `.wasm`. Edge runtimes need it; `dist/edge/wasm.mjs` passes it for you.',
                },
                {
                    name: '`path`',
                    type: 'string',
                    text: 'Where the loader finds its `.wasm`, data and worker files: a URL, a root path or a path relative to the page.',
                    default: "the bundler's base; `/` on a plain page; the loader's folder in Node.js",
                },
                { name: '`paths`', type: '{ wasm, data, js, worker }', text: 'File names under `path`. A bundler plugin sets them itself and ignores yours.', default: "the build's file names" },
            ],
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Function options do not cross into a worker',
            text: 'With `useWorker: true`, `logHandler`, `errorHandler`, `onRuntimeInitialized` and `getWasmFunction` are ignored: a function cannot be sent to a worker, so the worker logs with the default prefixes. Pass `useWorker: false` when you need them.',
        },
        {
            type: 'p',
            text: 'A Node-API addon (`-e node` on a desktop platform) takes three options:',
        },
        {
            type: 'entries',
            items: [
                { name: '`env`', text: "Environment variables. A value passed here replaces the process's own; a value from the build never does." },
                { name: '`addonPath`', text: 'Where the addon is.', default: 'next to the loader, or in its platform package' },
                { name: '`dataPath`', text: 'The data folder. It cannot change once the addon has started.', default: '`data/` next to the loader' },
            ],
        },
        {
            type: 'p',
            text: "On React Native, `initNative()` takes no options; the build's `env` applies.",
        },

        { type: 'h2', id: 'module', text: 'The module' },
        {
            type: 'p',
            text: 'The promise resolves to the module: the bound classes, functions, enums and constants (the same values the named imports get), plus these helpers:',
        },
        {
            type: 'entries',
            items: [
                { name: '`toArray(vector)`', text: 'Returns a bound `std::vector` as an array. Every runtime.' },
                { name: '`toVector(Vector, array)`', text: 'Returns an array as a bound vector; takes the class or its name. Every runtime.' },
                { name: '`FS`', text: 'The Emscripten virtual filesystem, in memory on the edge. Wasm builds only: browser, Node.js and edge.' },
                { name: '`getFileBytes(path)`, `getFileList(start?)`', text: 'A file as a `Uint8Array`; a recursive `[{ path, size }]` listing. Browser and Node.js wasm builds.' },
                {
                    name: '`getDefaultPath()`, `getFinalPath(path)`, `getRandomPath(start?)`, `autoMountFiles(files, parent?)`',
                    text: 'OPFS and in-memory mounts, and files the user picked; see [Files](/guide/filesystem/). Browser only.',
                },
            ],
        },
        {
            type: 'p',
            text: 'Where C++ takes a `std::vector`, a plain array converts on every call in worker mode. Elsewhere it converts only for functions and constructors, so pass `toVector(...)` to a method.',
        },
        {
            type: 'p',
            text: 'A module that binds a pointer also exports the pointer helpers (`cstring`, `allocBuffer`, `readBuffer` and the rest); see [C++](/guide/bindings/#pointers). Every header module also exports `AllSymbols`, the started module itself; importing it binds every function of that header.',
        },
        {
            type: 'p',
            text: 'A C++ exception thrown by a call reaches JavaScript as an `Error`; see [Exceptions](/guide/bindings/#exceptions).',
        },

        { type: 'h2', id: 'worker', text: 'Worker mode' },
        {
            type: 'p',
            text: 'In a browser the module runs in a Web Worker unless you pass `useWorker: false`. Every call, every `new` and every value you read, constants and fields included, then returns a promise:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, Matrix } from './native/Matrix.h';

await initNative();

const a = await new Matrix(1210000, 1);
const result = await a.multiple(await new Matrix(1210000, 2));
console.log(await result.get(0));`,
        },
        {
            type: 'table',
            head: ['', 'useWorker: false', 'useWorker: true'],
            rows: [
                ['A call returns', 'the value', 'a promise of it'],
                ['`new X(...)` returns', 'the instance', 'a promise: write `await new X(...)`'],
                ['A returned `std::vector`', 'a vector object', 'a plain array'],
                ['A JavaScript function passed to C++', 'works', 'cannot cross into the worker'],
                ['Function options of `initNative`', 'apply', 'ignored'],
                ['A path under `/opfs`', 'throws', 'works while `fs.opfs` is on and the browser supports OPFS'],
            ],
        },
        {
            type: 'p',
            text: "Set `dts: 'promise'` in `crossbind.config.js` so the generated types return promises too. `initNative.terminate()` stops the worker; the next `initNative()` starts a fresh one.",
        },

        { type: 'h2', id: 'logging', text: 'Logging and environment' },
        {
            type: 'p',
            text: 'By default, stdout lines go to `console.debug` and stderr lines to `console.error`, prefixed `wasm stdout:` and `wasm stderr:`. To send them to your own logger, keep the module on the page thread:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `const m = await initNative({
    useWorker: false,
    logHandler: (text) => myLogger.info(\`[wasm] \${text}\`),
    errorHandler: (text) => myLogger.error(\`[wasm] \${text}\`),
});`,
        },
        {
            type: 'p',
            text: 'Runtime `env` values are strings, merged over the `env` the build declares in `targetSpecs` ([Data files](/guide/assets/#env)). `_CROSSBIND_DATA_PATH_` in a value becomes the data folder: `/crossbind` in the browser and on the edge, `data/` next to the loader in Node.js.',
        },
        {
            type: 'code',
            file: 'src/index.mjs',
            code: `const m = await initNative({
    env: { TMPDIR: '_CROSSBIND_DATA_PATH_/scratch' },
});`,
        },

        { type: 'h2', id: 'lifecycle', text: 'Object lifetime' },
        {
            type: 'p',
            text: 'A C++ object is freed when the garbage collector reclaims its handle, at a time you do not control. That holds in the browser, in Node.js and in React Native 0.88 and later. `.delete()` frees it at once: call it when an object holds a file, a socket or a lot of memory, and on objects made in a loop. On React Native before 0.88, `.delete()` is the only way.',
        },
        {
            type: 'p',
            text: "An object or memory a library returns through a raw pointer stays the library's: free it with the library's own function.",
        },
        {
            type: 'p',
            text: 'In browser and Node.js wasm builds, `initNative.terminate()` drops the module (and stops the worker in worker mode), so the next `initNative()` starts a new one. A Node-API addon cannot be unloaded: the next call resolves the same module, its native state intact.',
        },

        { type: 'h2', id: 'types', text: 'TypeScript' },
        {
            type: 'p',
            text: 'crossbind writes declarations for every native import under `.crossbind/types/`, `.crossbind/rust-crates/types/` and `.crossbind/conan/types/`. Install the shared config and extend it once (TypeScript 5.5 or later):',
        },
        { type: 'code', file: 'shell', code: installCommand('@crossbind/typescript-config') },
        {
            type: 'code',
            file: 'tsconfig.json',
            code: '{ "extends": "@crossbind/typescript-config" }',
        },
        {
            type: 'p',
            text: "From a C++ header, classes get typed constructors, fields and methods; other names are `any`, and `initNative` returns `Promise<unknown>`. In worker mode, set `dts: 'promise'` so every generated return type is a `Promise`. Constructors stay typed as synchronous, since TypeScript has no async constructor: write `await new X()` anyway.",
        },

        { type: 'h2', id: 'pitfalls', text: 'Common pitfalls' },
        {
            type: 'ul',
            items: [
                '`useWorker: true` in `crossbind.config.js` does nothing: runtime options go to `initNative()`.',
                '`x.method is not a function` in a browser usually means a `new X()` whose promise was never awaited.',
                "`m.GDALVersionInfo is not a function` (or `crossbind: GDALVersionInfo is not bound in the native module` in a worker): a function of a dependency's header you reach only through the module needs a named import too; see [What a library header binds](/guide/bindings/#imports).",
                'Mounting `/opfs/...` from the page thread throws, and so does any `/opfs` path while `fs.opfs` is off.',
                "`runtime: 'mt'` works in the dev server but fails in production when the host does not send the COOP/COEP headers; see [Threads and workers](/guide/threading/).",
                'Edge runtimes have no Web Workers: no `useWorker`, no OPFS and no `mt`.',
            ],
        },
        {
            type: 'p',
            text: `Full reference: [init.md](${REPO_URL}/blob/main/docs/api/init.md) and [lifecycle-and-types.md](${REPO_URL}/blob/main/docs/api/lifecycle-and-types.md).`,
        },
    ],
};
