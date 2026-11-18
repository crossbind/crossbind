# `initNative(opts)` — Runtime API

The one entry point into your native module from JavaScript.

> Browser, Node.js and edge builds export the same function with the same options; only the defaults differ.

## Where it comes from

With a bundler plugin (Vite, Rollup, Webpack, Rspack, Metro), import it from the header, `.rs` file, `cargo:` crate or `conan:` header you already import; every generated module exports the same function:

```js
import { initNative } from './native/native.h';
import { initNative, Matrix } from './native/Matrix.h';
import { Uuid } from 'cargo:uuid';
import { zlibVersion } from 'conan:zlib/zlib.h';

await initNative();
```

One call binds every imported module. Node.js, edge and standalone builds have no bundler plugin: there you import the built file directly and call its default export.

Those builds also write an ES module per runtime that exports `initNative` and every bound name: `dist/node/napi.mjs` (`-e node` on darwin, linux, linuxmusl or win32), and `dist/node/wasm.mjs` and `dist/edge/wasm.mjs` (the st release wasm32 builds). A package publishes them under paths of its own, a standalone package as its root:

```js
import { initNative, Matrix } from '@crossbind/example-lib-prebuilt-matrix/node/napi';
import { initNative as initZlib, crc32 } from '@crossbind/port-zlib-standalone-napi';

await Promise.all([initNative(), initZlib()]);
```

## Signature

```ts
initNative(opts?: InitOptions): Promise<Module>

initNative.terminate(): void   // browser-only when useWorker:true
```

`Module` is the Emscripten runtime module enriched with crossbind helpers (see [§ Module helpers](#module-helpers) below).

## `InitOptions`

```js
{
  // ─────────────────────────────────────────────────────────────
  // Worker bridging (browser-only)
  // ─────────────────────────────────────────────────────────────
  useWorker: !!globalThis.Worker,
    // Defaults to ON wherever the Worker constructor exists, which is every
    // browser; pass false to keep the module on the calling thread. While it
    // is on, every call - construction included - resolves through the
    // bridge, so write `await new X(...)` and await the calls.
    //
    // When true, the Wasm module is instantiated inside a Web Worker
    // and the main-thread receives a Comlink-bridged proxy.
    //
    // REQUIRED for OPFS persistent storage: crossbind's OPFS backend
    // relies on synchronous access handles, which browsers expose only
    // in Worker scope; mounting /opfs/... from the main thread throws.
    //
    // Independent from threading: you can use `useWorker: true`
    // with `runtime: 'st'` and still get OPFS.
    //
    // NOT supported on edge runtimes (Cloudflare Workers, Deno
    // Deploy, Vercel Edge) — they don't expose the Worker API.

  workerUrl: undefined,
    // Override the worker script URL. Defaults to whatever the
    // bundler plugin set in config.paths.worker.

  // ─────────────────────────────────────────────────────────────
  // Filesystem
  // ─────────────────────────────────────────────────────────────
  fs: {
    opfs: true,
      // Browser default: true for a multithreaded build (runtime: 'mt'),
      // false for a single-threaded one. When false, only memfs is mounted.
      // Has no effect outside the browser.
      //
      // Even when true, OPFS only activates if:
      //   1. useWorker: true (Worker scope required), AND
      //   2. The browser supports OPFS (Chrome 86+, Firefox 111+,
      //      Safari 15.2+).
      //
      // If you mount /opfs/... but conditions aren't met, crossbind
      // logs an error and silently redirects the path to /memfs.
  },

  // ─────────────────────────────────────────────────────────────
  // Environment variables (passed to the Wasm process)
  // ─────────────────────────────────────────────────────────────
  env: {
    SOME_VAR: 'static-string',
    DATA_VAR: '_CROSSBIND_DATA_PATH_/myapp',
      // String values. They join the build-time env (targetSpecs[].specs.env
      // in crossbind.config.js, whose values may also be functions of
      // (state, target), see ADR-0003) and win over it key by key.
      //
      // Token replacement: the literal string `_CROSSBIND_DATA_PATH_`
      // inside any value is replaced with the runtime data path:
      // /crossbind in the browser and on the edge (the preloaded data),
      // the data directory next to the module in Node.js (`dataPath`
      // overrides it for a Node-API build).
  },

  // ─────────────────────────────────────────────────────────────
  // Logging hooks
  // ─────────────────────────────────────────────────────────────
  logHandler: undefined,
    // (text: string, channel: 'stdout') => void
    // Replaces the default `console.debug('wasm stdout: ...')`.

  errorHandler: undefined,
    // (text: string, channel: 'stderr') => void
    // Replaces the default `console.error('wasm stderr: ...')`.

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────
  onRuntimeInitialized: undefined,
    // (m: Module) => void
    // Called after the Wasm runtime finishes initializing.
    // Use this for post-init bootstrapping that needs `m.FS`, etc.

  // ─────────────────────────────────────────────────────────────
  // WebAssembly override
  // ─────────────────────────────────────────────────────────────
  getWasmFunction: undefined,
    // () => WebAssembly.Module
    // Bypass the default fetch-and-compile flow with a precompiled
    // module. Useful when you've embedded the .wasm via your bundler
    // and want zero network round-trips.

  // ─────────────────────────────────────────────────────────────
  // Path overrides (advanced; bundler plugin sets these)
  // ─────────────────────────────────────────────────────────────
  paths: {
    wasm:   undefined,  // override .wasm URL
    data:   undefined,  // override packaged .data file URL
    js:     undefined,  // override main script URL
    worker: undefined,  // override worker script URL
  },
    // A name is looked up under `path`. A full address (https:, blob:)
    // or a root path is used as it is, so a file can come from another
    // host or from URL.createObjectURL().
  path: '',             // where the assets are: a URL, a root path or a path relative to the page;
                        // the bundler plugins pass the base they serve the app from
}
```

## Return value: `Module`

The Emscripten module with crossbind's helpers; your C++ bindings are its members.

### Module helpers

```js
m.FS                      // Emscripten virtual FS (mkdir, writeFile, …)

m.toArray(vector)         // embind vector → JS Array
m.toVector(ClsOrName, []) // JS Array → embind vector

m.getFileBytes(path)      // Uint8Array of file contents
m.getFileList(startPath?) // Recursive file listing → [{ path, size }]

// Browser-only mount helpers
m.getDefaultPath()                   // '/opfs' or '/memfs'
m.getFinalPath(path)                 // validate + maybe redirect (OPFS→memfs fallback)
m.getRandomPath(startPath?)          // /<base>/<app>/automounted/<rand>
m.autoMountFiles(files, parentPath?) // mount File[] (e.g. from <input type=file>)

m.unmount()               // placeholder, no-op
```

### Worker mode (`useWorker: true`)

With `useWorker: true`, `Module` is a Comlink proxy to the worker, and every call crosses into it:

- Bound objects are proxied too.
- Every call returns a promise, even when the C++ is synchronous.
- `m.toArray(vec)` works on a returned vector, as on the page thread.

Call `initNative.terminate()` to kill the worker and release resources.

## Examples

### Minimal browser

```js
import { initNative } from './native/native.h';

const m = await initNative()
console.log(m.add(2, 3))  // an embind-exported function
```

### Browser + persistent storage

```js
const m = await initNative({
  useWorker: true,           // mandatory for OPFS
  fs: { opfs: true },        // the default in mt builds; st builds need it
})

// Files written under /opfs/<appName>/ survive page reloads.
m.FS.writeFile('/opfs/myapp/data.bin', new Uint8Array([1, 2, 3]))
```

### Browser + multithread

```js
const m = await initNative({
  // Nothing extra here — `runtime: 'mt'` was set in crossbind.config.js
  // at build time, so this Wasm IS multithreaded.
  // Just make sure your prod host sends COOP/COEP headers.
})
```

### Node.js

```js
import { initNative } from './native/native.h';

const m = await initNative({
  env: { TMPDIR: '_CROSSBIND_DATA_PATH_/scratch' },
})
```

### Native Node.js addon

```js
const initNative = require('./dist/my-app.native.cjs');

const m = await initNative({
  env: { TMPDIR: '_CROSSBIND_DATA_PATH_/scratch' },
  // addonPath: '/opt/my-app/my-app.darwin-arm64.node',   // default: next to the loader
  // dataPath: '/opt/my-app/data',                        // default: data/ next to the loader
})
```

The Node-API build (`crossbind build -p darwin -e node`, or `-p linux`, `linuxmusl` or `win32`) takes only `env`, `addonPath` and `dataPath`. It has no Emscripten runtime, so no worker, virtual filesystem or log redirection; `m` holds the bound classes and functions plus `toArray` and `toVector`. `initNative.terminate()` forgets the module, but Node cannot unload an addon, so the next `initNative()` resolves the same one, its native state intact.

### Cloudflare Worker

```js
import { initNative } from './native/native.h';

const m = await initNative()
// useWorker, OPFS, multithread all unavailable on edge.
// Run in single-thread + memory-fs only.
```

### Custom logging

```js
const m = await initNative({
  logHandler:   (text) => myLogger.info(`[wasm] ${text}`),
  errorHandler: (text) => myLogger.error(`[wasm] ${text}`),
})
```

## See also

- [`filesystem.md`](./filesystem.md) — full OPFS / memfs / node-fs decision tree.
- [`threading.md`](./threading.md) — `runtime: 'mt'` requirements, COOP/COEP, edge limits.
- [`crossbind-config.md`](./crossbind-config.md) — build-time config that produces what `initNative` consumes.
