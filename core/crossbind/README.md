<div align="center">
  <a href="https://crossbind.dev">
    <img src="https://raw.githubusercontent.com/crossbind/crossbind/main/landing/public/favicon.svg" alt="crossbind logo" height="96">
  </a>

  <h1>crossbind</h1>

  <p>
    <strong>Build and ship JS apps. Add C++ and Rust as needed.</strong><br>
    Build, package, and run native libraries across browsers, Node.js, edge
    runtimes, iOS, Android, and WASI, or ship them in a desktop or mobile app.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/crossbind/v/beta"><img src="https://img.shields.io/npm/v/crossbind/beta?style=flat-square&label=npm%20beta" alt="npm beta version"></a>
    <a href="https://github.com/crossbind/crossbind/actions/workflows/build-linux.yml"><img src="https://img.shields.io/github/actions/workflow/status/crossbind/crossbind/build-linux.yml?branch=main&style=flat-square&label=linux" alt="Linux build status"></a>
    <a href="https://github.com/crossbind/crossbind/blob/main/LICENSE"><img src="https://img.shields.io/github/license/crossbind/crossbind?style=flat-square" alt="MIT license"></a>
  </p>

  <p>
    <a href="#start-with-a-coding-agent">Coding agents</a>
    · <a href="https://crossbind.dev/guide/">Guide</a>
    · <a href="https://crossbind.dev/guide/quick-start/">Quick start</a>
    · <a href="https://crossbind.dev/guide/libraries/">Libraries</a>
    · <a href="https://github.com/crossbind/crossbind/tree/main/examples">Examples</a>
    · <a href="https://github.com/crossbind/crossbind/blob/main/CONTRIBUTING.md">Contributing</a>
  </p>
</div>

crossbind makes native libraries as easy to use as JavaScript packages. Import a
C++ header, a Rust file, a crate or a ConanCenter package, and crossbind
generates the bindings, builds the native dependencies in order and picks the
right binary for every target. It also builds a web page and the native code it
imports into an app for macOS, Linux, Windows, iOS and Android.

> **Note:** crossbind 2.0 is on the npm `beta` channel, so the commands below
> use `@beta`.

## Start with a coding agent

The shortest path is to give your coding agent the crossbind skill. It inspects
your project, picks the right integration, wires it up and verifies the build.

```bash
npx skills add https://github.com/crossbind/crossbind/tree/main/agents/skills --global --yes
```

Then describe the outcome you want:

```text
Add crossbind to this project so I can call C++ or Rust from JavaScript.
Inspect the repository, choose the correct integration, make the smallest
required changes, and verify the build.
```

The skill uses the agent's own file and terminal access; nothing else runs in
the background. See the
[agent guide](https://github.com/crossbind/crossbind/blob/main/docs/agent-overview.md).

## Why crossbind

Beneath the header import, crossbind distributes native libraries for
JavaScript runtimes: versioned packages, binaries per target, their
dependencies, build recipes and runtime adapters.

- **Target-aware distribution.** One package family carries WebAssembly, iOS,
  Android, desktop and WASI variants, and each build takes only the one for its
  target.
- **Native dependency resolution.** Packages declare their native dependencies,
  so they are built and linked in the right order.
- **A reproducible package contract.** Port recipes pin upstream versions,
  source hashes and licenses.
- **No hand-written binding glue.** Functions, classes, enums, containers and
  standard-library types bind from the header you already have.
- **C++ and Rust.** Import your own sources, a `cargo:` crate or a native
  package the same way.
- **First-party integrations and ports.** Bundler plugins rebuild only what
  changed, and prebuilt ports bring GDAL, SQLite, OpenSSL, GEOS, PROJ and more.

## Quick start

To set up a project yourself, you need [Node.js 26+](https://nodejs.org/) and
[Docker](https://www.docker.com/), which carries the browser, Android and WASI
toolchains. iOS also needs macOS, CMake 3.28+, Xcode and CocoaPods.

Create a project:

```bash
npm create crossbind@beta
```

If you are unsure, pick **Web → React → Vite**, then run the commands the
scaffolder prints:

```bash
cd my-app
npm install
npm run dev
```

The first build pulls the toolchain and takes a while; later builds reuse the
cache.

### Your first native call

Put the C++ in `src/native`:

```cpp
// src/native/hello.h
#pragma once
#include <string>

inline std::string hello(const std::string& name) {
    return "Hello, " + name + "!";
}
```

Import the header from JavaScript and call `initNative()` once:

```js
// src/main.js
import { initNative, hello } from './native/hello.h';

await initNative();
console.log(await hello('crossbind'));
```

In a browser the module runs in a Web Worker by default, so each call returns a
promise.

## Add crossbind to an existing Vite app

Install the Vite integration:

```bash
npm install --save-dev @crossbind/plugin-vite@beta
```

Register it in `vite.config.js`:

```js
import { defineConfig } from 'vite';
import viteCrossbindPlugin from '@crossbind/plugin-vite';

export default defineConfig({
    plugins: [viteCrossbindPlugin()],
});
```

Add the build configuration at the project root:

```js
// crossbind.config.js
export default {
    paths: {
        config: import.meta.url,
    },
};
```

Then add the header and the import from the example above. For other bundlers
and frameworks, see the [integration playbooks](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/integration/README.md)
or start from the closest project in [`examples/`](https://github.com/crossbind/crossbind/tree/main/examples).

## How it works

```text
  C++ / Rust source                        header, .rs, cargo:
  or prebuilt port                         or conan: import
          |                                       |
          v                                       |
  versioned native package graph                  |
  dependencies + target variants                  |
          |                                       |
          +-------------------+-------------------+
                              |
                              v
                      target resolution
                    + binding generation
                   + native build and link
                              |
                              v
  browser, Node.js, edge     JavaScript + Wasm
  Node.js, Electron          Node-API addon
  iOS, Android               native library + JSI
  desktop and mobile apps    your page + native host
  macOS, Linux, Windows      native executable
  WASI runtimes              command component
```

There are two places to configure:

- **`crossbind.config.js`**, read at build time: native paths, dependencies,
  target, runtime (`st`/`mt`), output and compiler settings.
- **`initNative(options)`**, read at run time: worker mode, files, environment,
  asset paths and lifecycle hooks.

Runtime options such as `useWorker` do nothing in `crossbind.config.js`. The
full contract is in the
[runtime and configuration reference](https://github.com/crossbind/crossbind/blob/main/docs/api/README.md).

## Runtimes

- **Browser:** a JavaScript loader and WebAssembly. Single-threaded by default;
  multithreaded builds need COOP/COEP headers in production.
- **Node.js:** a loader and WebAssembly, or a Node-API addon, which also loads
  in Electron. CommonJS or ESM, with the host filesystem.
- **Edge:** a loader and WebAssembly. Single-threaded and in memory, with no
  OPFS and no worker mode.
- **React Native:** native iOS and Android libraries over JSI, with no
  WebAssembly and no isolation headers.
- **Apps:** an app for macOS, Linux, Windows, iOS and Android. The page runs in
  the system webview and the native code in the app's own process; no Node.js.
- **Executables:** native programs for macOS, Linux and Windows, with no
  JavaScript host.
- **WASI:** a `wasm32-wasip3` command component, with no JavaScript host, for a
  WASI runtime such as wasmtime 47+.

Threads and the worker are independent choices:

- `target.runtime: 'mt'` makes a multithreaded build.
- Browsers run the module in a Web Worker by default;
  `initNative({ useWorker: false })` keeps it on the page thread.
- Browser OPFS persistence requires `useWorker: true`.
- Browser `mt` builds require COOP/COEP response headers in production.

Read [Threading and workers](https://github.com/crossbind/crossbind/blob/main/docs/api/threading.md)
and [Filesystem](https://github.com/crossbind/crossbind/blob/main/docs/api/filesystem.md)
before you turn those on.

## Build integrations

| Build tool or runtime | Packages                                                        |
| --------------------- | --------------------------------------------------------------- |
| Vite                  | `@crossbind/plugin-vite`                                        |
| Rollup                | `@crossbind/plugin-rollup`                                      |
| Webpack / Rspack      | `@crossbind/plugin-webpack`, `@crossbind/plugin-webpack-loader` |
| React Native / Metro  | `@crossbind/plugin-react-native`, `@crossbind/plugin-metro`     |
| No bundler            | `crossbind` CLI                                                 |

The plugins turn native imports into modules, build and watch the native
sources, and put the output in your bundle. The CLI runs the same build for
Node.js, edge, library and WASI projects.

## Prebuilt libraries and commands

The repository contains 16 port families:

**cURL · Expat · GDAL · GEOS · GeoTIFF · iconv · libjpeg-turbo · LERC ·
OpenSSL · PROJ · SpatiaLite · SQLite · libTIFF · WebP · zlib · Zstandard**

Each library ships one package per platform. A browser or Node.js project uses
`@crossbind/port-gdal-wasm`; mobile apps, Node.js addons and WASI builds use the
`-android`, `-ios`, `-darwin`, `-linux`, `-linuxmusl`, `-win32` or `-wasi`
variant. List the variant's `crossbind.config.js` in `dependencies`:

```bash
npm install @crossbind/port-gdal-wasm@beta
```

```js
// crossbind.config.js
import gdal from '@crossbind/port-gdal-wasm/crossbind.config.js';

export default {
    dependencies: [gdal],
    paths: {
        config: import.meta.url,
    },
};
```

Each variant declares its own native dependencies, so they link in the right
order. Install and list a variant for every platform you build. More in the
[library guide](https://crossbind.dev/guide/libraries/) and
[`ports/README.md`](https://github.com/crossbind/crossbind/blob/main/ports/README.md).

Some upstream command-line tools are also npm commands that run on WASI. They
need `wasmtime` on `PATH`, but no compiler:

```bash
npm install --global @crossbind/port-gdal-standalone-wasi@beta
gdalinfo-wasi --version
```

## Rust

Import a `.rs` file of your app, a crates.io crate with `cargo:`, or a published
Rust package. Rust works like C++, with the same `initNative()`.

With the default Docker runner you need Rust on your machine only for iOS and
macOS builds. WASI builds skip Rust: there is no `wasm32-wasip3` Rust target
yet. See the [Rust guide](https://crossbind.dev/guide/rust/).

## Documentation

- [Guide](https://crossbind.dev/guide/): concepts, quick start, runtimes, apps,
  bundlers, bindings, packages and troubleshooting.
- [Runtime and configuration API](https://github.com/crossbind/crossbind/blob/main/docs/api/README.md):
  the full build-time and runtime reference.
- [Integration playbooks](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/integration/README.md):
  Vite, Webpack/Rspack, Rollup, Node.js, edge, React Native and more.
- [Examples](https://github.com/crossbind/crossbind/tree/main/examples):
  runnable reference apps and library templates.
- [Architecture](https://github.com/crossbind/crossbind/blob/main/docs/ARCHITECTURE.md)
  and [codemap](https://github.com/crossbind/crossbind/blob/main/docs/CODEMAP.md):
  how the monorepo is organized and where each part lives.
- [Troubleshooting](https://github.com/crossbind/crossbind/blob/main/docs/api/troubleshooting.md):
  common errors and their fixes.
- [Changelog](https://github.com/crossbind/crossbind/blob/main/CHANGELOG.md):
  release history.

## Contributing

This is a pnpm monorepo. To work on crossbind itself:

```bash
git clone https://github.com/crossbind/crossbind.git
cd crossbind
pnpm install
pnpm run doctor
pnpm test
```

Use a package filter for day-to-day builds; the full native matrix is
intentionally expensive. Read
[CONTRIBUTING.md](https://github.com/crossbind/crossbind/blob/main/CONTRIBUTING.md)
for the repository layout, validation matrix, coding conventions, and
pull-request process.

## Support

- Ask usage questions in [GitHub Discussions](https://github.com/crossbind/crossbind/discussions).
- Report reproducible bugs in [GitHub Issues](https://github.com/crossbind/crossbind/issues).

## License

crossbind is available under the
[MIT License](https://github.com/crossbind/crossbind/blob/main/LICENSE).

Copyright © 2026 Buğra Sarı and crossbind contributors
