# Integration — Node.js (no bundler)

> Persona 2 sub-playbook. The user's project is a plain Node.js application or library — no Vite, Webpack, Rollup, RN, etc. Detection: crossbind build script targets `-e node`, or the project's `package.json` declares `main`/`module`/`bin` without bundler deps.

## Goal

Build crossbind artifacts for the Node runtime (`-e node`) and `require`/`import` the loader from any Node script. No bundler integration; the build is invoked directly via `crossbind build`.

## When to use

- Backend service, CLI, script, or Node-native library.
- No browser, no React Native, no edge runtime.
- Multithread (`runtime: 'mt'`) is supported via Node's `worker_threads` on the supported Node 24+ runtime.

## Files involved

| File | Role |
|------|------|
| `package.json` | + `crossbind`, optional `@crossbind/port-<name>`; declare a `build` script that runs `crossbind build -e node` |
| `crossbind.config.{js,mjs}` *(new at root)* | Project-level crossbind config (deps to consume, paths) |
| `src/native/` *(if user wraps own C++)* | `.h` + `.cpp` source |
| `<entry>.js` (e.g. `index.js`) | `require`/`import` the built loader |
| `dist/<name>-<target>.node.{js,wasm}` | Build output |

## Commands

```bash
pnpm add -D crossbind
pnpm add @crossbind/port-<name>     # optional

# Single-thread build
pnpm crossbind build -p wasm -a wasm32 -r st -e node -b release

# Multithread build (Node worker_threads)
pnpm crossbind build -p wasm -a wasm32 -r mt -e node -b release

# Run
node index.js
```

## Reference setup

Mirror `examples/backend-nodejs-wasm/` (single-thread) or `e2e/backend-nodejs-multithread/` (multithread).

`package.json`:

```jsonc
{
  "scripts": {
    "build": "crossbind build -p wasm -a wasm32 -r st -e node -b release",
    "start": "node src/index.js"
  },
  "dependencies": {
    "@crossbind/port-<name>": "^x.y.z"
  },
  "devDependencies": {
    "crossbind": "^2.0.0"
  }
}
```

`crossbind.config.mjs`:

```js
// If consuming prebuilt packages:
import Matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js';

export default {
    general: { name: 'my-node-service' },
    dependencies: [
        Matrix,
    ],
    paths: {
        config: import.meta.url,
        output: 'dist',
    },
};
```

Entry script `src/index.js` (CommonJS):

```js
const initNative = require('../dist/my-node-service-wasm-wasm32-st-release.node.js');

initNative().then(({ Native }) => {
    console.log(`Result: ${Native.sample()}`);
});
```

ESM equivalent:

```js
import initNative from './dist/my-node-service-wasm-wasm32-st-release.node.js';

const { Native } = await initNative();
console.log(`Result: ${Native.sample()}`);
```

The exact output filename is `<general.name>-<target.path>.<runtimeEnv>.{js,wasm}`. For st-release: `<name>-wasm-wasm32-st-release.node.js`. For mt-release: `<name>-wasm-wasm32-mt-release.node.js`.

## Multithread

Node multithread (`runtime: 'mt'`) uses `worker_threads`. **No COOP/COEP needed** — that's a browser concern. Just build with `-r mt`. The loader fans out work across worker threads transparently.

Caveats:

- Node 24+ is required; its `worker_threads` and WASM SharedArrayBuffer behavior is the supported baseline.
- Worker threads warm up; expect ~50-200ms cold-start overhead the first time you `init`.
- If you have CPU-bound code, `mt` is a meaningful speedup. For I/O-bound services, stick with `st`.

## Native addon (Node-API)

The same bindings can build a native Node-API addon instead of WebAssembly: for Electron's main process, native memory or system access. macOS, Linux (glibc and musl) and Windows, each for arm64 and x64.

```bash
pnpm add -D crossbind @crossbind/core-embind-napi
pnpm crossbind build -p darwin,linux,linuxmusl,win32 -b release   # opt-in: a plain `crossbind build` skips them
```

| Output | Role |
|--------|------|
| `dist/<name>.<platform>-<arch>.node`, e.g. `<name>.darwin-arm64.node`, `<name>.linux-x64.node`, `<name>.linuxmusl-x64.node`, `<name>.win32-x64.node` | One addon per platform and architecture |
| `dist/<name>.native.cjs` | Loader: picks the addon for `process.platform`/`process.arch`, and on Linux for the C library the process runs on (`linuxmusl` under musl). CommonJS on purpose, so `require` and `import` both load it whatever the package `type` is |

```js
const initNative = require('./dist/<name>.native.cjs');

initNative().then(({ Native }) => console.log(Native.sample()));
```

`initNative()` keeps the wasm build's contract, `initNative.terminate()` included; `addonPath` and `dataPath` override where the addon and its data are read from. A debug build (`-b debug`) writes `<name>.native.debug.cjs` and `<name>.<platform>-<arch>.debug.node`.

| Platform | Built on | Runs on |
|----------|----------|---------|
| `darwin` | a macOS host with Xcode's command line tools; skipped elsewhere | macOS 11 or later |
| `linux` | any host with Docker, in the `linux` toolchain image | glibc 2.28 or later (RHEL 8, Debian 10, Ubuntu 20.04 and newer). The addon needs libc, libm, libdl, libpthread, librt and libgcc_s only |
| `linuxmusl` | any host with Docker, in the `linux` toolchain image | musl 1.2.5 or later (Alpine 3.21 and newer). The addon needs musl's libc and libgcc_s only, both of which Node.js on Alpine already has |
| `win32` | any host with Docker, in the `windows` toolchain image | Windows 10 or later, through the Universal C Runtime. The addon finds Node-API in the process that loads it, so `node.exe` and `electron.exe` load the same file |

A Linux addon loads only on the C library it was built for, so ship both when the app may run on Alpine: the loader picks between them, while a glibc addon loaded under musl by hand crashes the process instead of failing with an error.

A Linux or Windows addon carries its C++ runtime; a macOS addon uses the system's. A Windows addon also carries parts of the mingw-w64 runtime and winpthreads, whose licenses ask for their notices when you distribute it: `crossbind licenses --platform win32 --notices` lists them, with links to the texts, next to the licenses of your dependencies.

Requirements:

- Docker, on macOS too: the SWIG bridges are generated in the same image the wasm build uses.
- Every C++ dependency needs prebuilts for the platform (`crossbind build -p <platform>` in the library). Each `@crossbind/port-*` family publishes them as `@crossbind/port-<name>-darwin`, `-linux`, `-linuxmusl` and `-win32`: install the ones you build for and import their `crossbind.config.js` next to the other platform variants. The addon links the archives statically; the few system libraries a port uses (libxml2 and zlib of the macOS SDK, Winsock and the certificate store on Windows) come from the port's `binary.addonFlags`, and data such as `GDAL_DATA` and `proj.db` lands in `dist/data`.
- Rust packages build for macOS only, with the cargo target of each architecture, e.g. `rustup target add x86_64-apple-darwin` on an arm64 Mac.

Not supported yet: `worker_threads` (one addon runtime per process; a second environment's `initNative()` rejects with a clear error), Rust packages on Linux and Windows.

Electron loads the same addon in its main process (verified on Electron 44 on macOS); Node-API is ABI-stable, so there is no per-Electron-version rebuild.

Native is not automatically faster. On an M-series Mac a call returning or taking a short `std::string` took about 70 and 85 ns natively against 160 and 155 ns on wasm, but a `const char*` argument took about 1.2 µs against 0.33 µs, a callback into JavaScript about 2.1 µs against 0.5 µs, and compute-bound runs went either way; measure the real workload before switching.

## Validation

- [ ] `pnpm install` succeeds.
- [ ] `pnpm build` produces `dist/<name>-<target>.node.{js,wasm}`.
- [ ] `node <entry>.js` runs and calls into C++ without error.
- [ ] If multithread: workers spin up, computation finishes (use Node's `--inspect` if you suspect threading issues).
- [ ] No `Module not found: 'fs'` or `'crypto'` warnings — crossbind's node bundle imports them legitimately, but if a different bundler later mishandles the script, those warnings appear.

## Common pitfalls

- **Targeting `-e browser` in a Node app.** The browser bundle uses `fetch()` for wasm — fails on Node without polyfill. Use `-e node`.
- **Targeting `-e edge` in a Node app.** Trims Node-specific helpers (`require('fs')`, etc.); some features won't work.
- **Hardcoded `dist/crossbind.js` path.** The actual filename includes the target tuple (e.g. `<name>-wasm-wasm32-st-release.node.js`). Use the exact path or read from the build output log.
- **Async at module top-level (CJS).** CommonJS doesn't allow it. Use `.then()` or wrap in an `async` function.
- **Forgetting to rebuild after editing `.cpp`.** No bundler watcher here. Re-run `pnpm build` (or wire `chokidar`/`nodemon` to do so).
- **Running on Node < 24.** crossbind requires Node ≥ 24 (see `engines` in `core/crossbind/package.json`).

## Reference examples

- `examples/backend-nodejs-wasm/` — minimal Node + crossbind (single-thread), canonical
- `e2e/backend-nodejs/` — playground with prebuilt packages
- `e2e/backend-nodejs-multithread/` — multithread reference (`-r mt`)
- `examples/backend-nodejs-native/` — the native addon build (`-p darwin`)
- `e2e/backend-nodejs-native/` — the conformance kit on the native addon

Node runtime adapter: `core/crossbind/src/assets/js-runtime/node.js`. Native addon loader: `core/embind-napi/js/loader.js`.
