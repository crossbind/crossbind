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
pnpm add -D crossbind@beta
pnpm add @crossbind/port-<name>@beta     # optional

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

The st-release build also writes `dist/node/wasm.mjs` and its `.d.mts`: one ES module that exports every bound class, function and constant, filled when `initNative()` resolves, so init options still reach the runtime:

```js
import { initNative, Native } from './dist/node/wasm.mjs';

await initNative();
console.log(`Result: ${Native.sample()}`);
```

A library publishes that module under a path of its own, as `@crossbind/example-lib-prebuilt-matrix/node/wasm` does. The loader is CommonJS with a `.js` extension, so the build writes `dist/package.json` with `"type": "commonjs"` when the output directory has none; it keeps loading as CommonJS inside a `"type": "module"` package.

## Importing headers and Rust directly

A Node.js app can import its native code the way a bundler app does: its own header, a package's header, a `conan:` header, a `.rs` file or a `cargo:` crate.

```js
import { initNative, Native, NATIVE_ANSWER } from './native/native.h';
import { Matrix } from '@crossbind/example-lib-prebuilt-matrix/Matrix.h';
import { zlibVersion } from 'conan:zlib/zlib.h';
import { Counter } from './native/counter.rs';
import { Version } from 'cargo:semver';

await initNative();
```

While developing, start the app through `crossbind/node/dev`, and it builds when it needs to:

```bash
node --import crossbind/node/dev src/index.mjs
node --watch --watch-path=src/native --import crossbind/node/dev src/index.mjs   # build and restart on save
```

- Before the app starts, it builds this machine's binary when the project's native sources, its crossbind config or `package.json`, or the native files and names its JavaScript imports changed since the last build it ran, or when the output is missing, the first start included. An edit to the rest of the code builds nothing, and a start with nothing changed costs a few tens of milliseconds.
- It builds the addon when the project installs `@crossbind/core-embind-napi` and the wasm build otherwise, with the build's output on stderr. A build that fails stops the app with its error.
- It builds before anything loads because a running process cannot swap the binary it loaded: a native import added while the app runs takes a restart, which `--watch` does. A dependency rebuilt in place, which leaves `package.json` as it was, takes a `crossbind build`.

`crossbind build -e node` itself finds these imports in the app's sources and binds them, constants and a dependency's functions only by the names imported, as a bundler does ([binding rule 9](../../api/cpp-binding-rules.md)). It writes the hooks that serve them, `dist/node/<format>.register.mjs` beside the entry, where `<format>` is `wasm` for the st-release wasm build and `napi` for an addon build. A deployed app starts with those, since `crossbind` is a dev dependency it may not have; they need nothing but `dist` and never build:

```bash
node --import ./dist/node/napi.register.mjs src/index.mjs
```

`NODE_OPTIONS="--import=./dist/node/napi.register.mjs"` does the same for a command that starts Node itself.

- The build reads `import`, `export … from`, `import()` and `require()` with a string literal, in the app's own `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` and `.cts` files, outside `node_modules`, `dist`, `build`, `target`, `ios`, `android`, `Pods` and dot directories. An import it did not see, such as a specifier computed at run time or one added since the build, fails with an error that says to build again. A name first imported since the build, a constant or a dependency's function, stops Node at the import with `does not provide an export named` until the next build. A `cargo:` or `conan:` import the config does not declare fails the build.
- A relative import needs its file on disk when the app runs, because Node checks that it exists; a package, `conan:` or `cargo:` import does not.
- `require()` returns the same module. Read its names after `initNative()` resolves: destructuring at `require` time keeps the `null` they hold until then. `require()` takes the whole module, so the header binds every constant and function it has. On Node.js 24.9, a CommonJS app started with `--import` cannot `require()` a header (`ERR_VM_MODULE_LINK_FAILURE`); `--require ./dist/node/<format>.register.mjs` works there, and both work on 24.20.
- A build whose sources import nothing native writes no hooks, and removes the ones an earlier build wrote.

## Multithread

Node multithread (`runtime: 'mt'`) uses `worker_threads`. **No COOP/COEP needed** — that's a browser concern. Just build with `-r mt`. The loader fans out work across worker threads transparently.

Caveats:

- Node 24+ is required; its `worker_threads` and WASM SharedArrayBuffer behavior is the supported baseline.
- Worker threads warm up; expect ~50-200ms cold-start overhead the first time you `init`.
- If you have CPU-bound code, `mt` is a meaningful speedup. For I/O-bound services, stick with `st`.

## Native addon (Node-API)

The same bindings can build a native Node-API addon instead of WebAssembly: for Electron's main process, native memory or system access. macOS, Linux (glibc and musl) and Windows, each for arm64 and x64. For a standalone executable from `main()` instead, build with `-e native` (see [`native.md`](../../api/native.md)).

A library that is published as a standalone Node-API package (`@crossbind/port-<name>-standalone-napi`) needs no build at all: install it, import from its root and call `initNative()` once, e.g. `import { initNative, crc32 } from '@crossbind/port-zlib-standalone-napi'`; npm installs only the addon package of the machine. A library can also ship its addons itself, as `@crossbind/example-lib-prebuilt-matrix/node/napi` does (`examples/backend-nodejs-standalone/`). Build an addon of your own when the app has C++ code of its own or needs a library built differently.

```bash
pnpm add -D crossbind@beta @crossbind/core-embind-napi@beta
pnpm crossbind build -p host -e node -b release                           # this machine's platform
pnpm crossbind build -p darwin,linux,linuxmusl,win32 -e node -b release   # every desktop platform
```

The desktop platforms are opt-in: a plain `crossbind build` skips them. `-p host` names the one of this machine: `darwin` on macOS, `win32` on Windows, and on Linux `linux` or `linuxmusl` by the C library Node.js runs on.

| Output | Role |
|--------|------|
| `dist/<name>.<platform>-<arch>.node`, e.g. `<name>.darwin-arm64.node`, `<name>.linux-x64.node`, `<name>.linuxmusl-x64.node`, `<name>.win32-x64.node` | One addon per platform and architecture |
| `dist/<name>.native.cjs` | Loader: picks the addon for `process.platform`/`process.arch`, and on Linux for the C library the process runs on (`linuxmusl` under musl). CommonJS on purpose, so `require` and `import` both load it whatever the package `type` is |
| `dist/node/napi.mjs`, `dist/node/napi.d.mts` | Entry: every bound class, function and constant as an export that `initNative()` fills; a package publishes it as its root or under a path of its own. `require()` of it needs Node.js 22.12 or later |
| `dist/node/napi.register.mjs`, `dist/node/hooks.mjs` | The import hooks, when the app's sources import a header, a `.rs` file or a crate: `node --import ./dist/node/napi.register.mjs`, or `--import crossbind/node/dev` while developing (see [Importing headers and Rust directly](#importing-headers-and-rust-directly)) |

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
- Rust packages, `.rs` files and `cargo:` crates build in the toolchain images for Linux and Windows; for macOS they need this machine's Rust with the cargo target of each architecture, e.g. `rustup target add x86_64-apple-darwin` on an arm64 Mac.

Not supported yet: `worker_threads` (one addon runtime per process; a second environment's `initNative()` rejects with a clear error).

Native is not automatically faster. On an M-series Mac a call returning or taking a short `std::string` took about 70 and 85 ns natively against 160 and 155 ns on wasm, but a `const char*` argument took about 1.2 µs against 0.33 µs, a callback into JavaScript about 2.1 µs against 0.5 µs, and compute-bound runs went either way; measure the real workload before switching.

### Electron

Electron's main process loads the same addon: Node-API is ABI-stable, so no Electron version needs a rebuild of its own and `electron-rebuild` has nothing to do. Load it in the main process and hand the window its results over IPC; the window has no Node.js. Verified with Electron 44 on macOS (arm64), Linux and Windows (x64 and arm64), from the sources and packaged; CI runs the sample on all three.

A packaged app keeps crossbind's output outside its asar archive: Electron loads an addon from there as it is, and an addon reads its data, such as `proj.db`, with native code, which cannot open a file inside the archive. electron-builder unpacks it with `asarUnpack: ['dist/**']`, Electron Forge with `packagerConfig.asar.unpackDir: 'dist'` (under pnpm, Forge also wants `node-linker=hoisted`); the loader then reads the data from `app.asar.unpacked`. A standalone Node-API package keeps its data in its own `dist/data`, so unpack `node_modules/@crossbind/**` as well.

`examples/desktop-electron/` is a whole app: the addon in the main process, a preload that exposes it to the window, electron-builder packaging, and a Playwright test that opens the app from its sources and packaged.

### Publishing the addons as packages

To publish a library so that npm installs only the addon a machine needs, split it the way the `@crossbind/port-<name>-standalone-napi` packages are:

- One package per platform you publish for, named `<package>-<platform>-<arch>`, e.g. `my-lib-linux-x64`. It sets `os`, `cpu` and on Linux `libc`, points `main` at its addon in `dist`, and builds it itself: `crossbind build -p linux -a x64 -e node -b release`. Its `crossbind.config` binds what the package users install binds; the ports spread `../standalone-napi/crossbind.config.js`.
- The package users install lists those packages in `optionalDependencies`. Its build, `crossbind build -p <platforms> -e node -b release`, then links no addon: it writes the loader, `dist/node/napi.mjs` with its types, and the data.

The packages it lists are the platforms it publishes for, three as well as eight. On a machine none of them covers, `initNative()` rejects with the platforms the package has addons for. `crossbind licenses [--platform <platform>] -e node --package` writes each package's `LICENSE`, `sbom.cdx.json` and `license` field.

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
- `examples/backend-nodejs-native/` — an app that builds its own addon (`-p host -e node`; `build:desktop` for every desktop platform)
- `examples/backend-nodejs-standalone/` — an app on a standalone Node-API package, nothing to build
- `examples/desktop-electron/` — an Electron app with its own addon in the main process, packaged with electron-builder
- `e2e/backend-nodejs-native/` — the conformance kit on the native addon, through the import hooks
- `e2e/backend-nodejs-import-hooks/` — a header, a package's header, a `conan:` header, a `.rs` file and a `cargo:` crate through the import hooks, on the wasm build and the addon, from ESM and CommonJS; `pnpm e2e:dev` starts it through `crossbind/node/dev`

Node runtime adapter: `core/crossbind/src/assets/js-runtime/node.js`. Native addon loader: `core/embind-napi/js/loader.js`.
