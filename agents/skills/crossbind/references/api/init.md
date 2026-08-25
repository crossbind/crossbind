<!-- GENERATED from docs/api/init.md by scripts/build-agent-skill.mjs. Do not edit. -->

# `init(opts)` — Runtime API

The single entry point for calling into your Wasm module from JavaScript. Produced by the crossbind build pipeline; consumed by your application code.

> The same function is exported by browser, Node, and Edge runtime entries. The `opts` shape is identical; only the available *defaults* differ per runtime.

## Where it comes from

With a bundler plugin (Vite, Rollup, Webpack, Rspack, Metro), import it from `crossbind` and everything else from the header, `.rs` file or `cargo:` crate:

```js
import { initNative } from './native/native.h';
import { initNative, Matrix } from './native/Matrix.h';
import { Uuid } from 'cargo:uuid';

await initNative();
```

One call binds every imported module: each proxy module registers its bindings when it is imported, and `init()` boots the runtime once and then resolves all of them. Proxy modules still export `initNative` — the same function under its old name — so existing code keeps working. Node, Edge and standalone builds have no bundler plugin: there you import the built artifact directly and call its default export.

## Signature

```ts
init(opts?: InitOptions): Promise<Module>

init.terminate(): void   // browser-only when useWorker:true
```

`Module` is the Emscripten runtime module enriched with crossbind helpers (see [§ Module helpers](#module-helpers) below).

## `InitOptions`

```js
{
  // ─────────────────────────────────────────────────────────────
  // Worker bridging (browser-only)
  // ─────────────────────────────────────────────────────────────
  useWorker: false,
    // When true, the Wasm module is instantiated inside a Web Worker
    // and the main-thread receives a Comlink-bridged proxy.
    //
    // REQUIRED for OPFS persistent storage (the OPFS API is only
    // exposed in Worker scope; mounting /opfs/... from the main
    // thread throws).
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
      // Browser default true. When false, only memfs is mounted.
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
    DYNAMIC_VAR: (state, target) => `${state.config.paths.build}/data`,
      // Values can be strings OR functions of (state, target).
      // Functions resolve lazily at the point of use (build-time
      // env wiring) and produce a string for the runtime.
      // See ADR-0003.
      //
      // Token replacement: the literal string `_CROSSBIND_DATA_PATH_`
      // inside any value is replaced with the runtime data path
      // (e.g. /opfs/<app> in browser, host fs path in Node).
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
  path: '',             // global URL prefix prepended to every asset
}
```

## Return value: `Module`

The Emscripten runtime module, plus crossbind extensions. Embind exports from your C++ code are attached as named members.

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

When `useWorker: true`, `Module` is a Comlink-wrapped proxy. Behavior is identical from your code's perspective with one caveat: every call crosses a worker boundary, so:

- All embind objects are auto-proxied (via crossbind's custom Comlink transfer handlers).
- Calls are async by nature even when the underlying C++ is synchronous.
- Returned `vector`s arrive as proxies; treat them the same — `m.toArray(vec)` still works.

Call `init.terminate()` to kill the worker and release resources.

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
  fs: { opfs: true },        // default, shown for clarity
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
- [`crossbind-config.md`](./crossbind-config.md) — build-time config that produces what `init` consumes.
