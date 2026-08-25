<div align="center">
  <a href="https://crossbind.dev">
    <img src="https://raw.githubusercontent.com/crossbind/crossbind/main/landing/public/favicon.svg" alt="crossbind logo" height="96">
  </a>

  <h1>crossbind</h1>

  <p>
    <strong>Import C++ and Rust like JavaScript modules.</strong><br>
    Build, package, and run native libraries across browsers, Node.js, edge
    runtimes, iOS, Android, and WASI.
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
    · <a href="https://crossbind.dev/guide/packages/">Libraries</a>
    · <a href="https://github.com/crossbind/crossbind/tree/main/examples">Examples</a>
    · <a href="https://github.com/crossbind/crossbind/blob/main/CONTRIBUTING.md">Contributing</a>
  </p>
</div>

crossbind makes native libraries as easy to distribute and consume as
JavaScript packages. A C++ header, an app-local Rust file, or a declared Cargo
crate becomes an importable module; crossbind generates the binding layer,
resolves the transitive native dependency graph, and selects the right artifact
for every target.

> **Note** — crossbind 2.0 is currently published on the npm `beta` channel.
> The commands below use `@beta` deliberately.

## Start with a coding agent

The shortest path is to give your coding agent the crossbind skill. It inspects
the existing project, detects the package manager, bundler, target runtime, and
native sources, checks whether a prebuilt port already exists, wires the right
integration, and verifies the build.

```bash
npx skills add https://github.com/crossbind/crossbind/tree/main/agents/skills --global --yes
```

Then describe the outcome you want:

```text
Add crossbind to this project so I can call C++ or Rust from JavaScript.
Inspect the repository, choose the correct integration, make the smallest
required changes, and verify the build.
```

The skill uses the agent's existing filesystem and terminal access; no
crossbind-specific background service is required. Its behavior and sources of
truth are documented in the
[agent guide](https://github.com/crossbind/crossbind/blob/main/docs/agent-overview.md).

## Why crossbind

The header import is the front door. Underneath it, crossbind provides the
native library distribution layer for JavaScript runtimes: versioned packages,
target-specific artifacts, transitive dependencies, build recipes, and runtime
adapters.

- **Target-aware distribution.** A package family can carry WebAssembly, iOS,
  Android, and WASI variants; each build consumes only the artifact valid for
  its platform, architecture, runtime, environment, and build type.
- **Native dependency resolution.** Package manifests and crossbind configs
  carry the transitive native graph, so prerequisites are built and linked in
  the correct order.
- **A reproducible package contract.** Port recipes record upstream versions,
  source integrity, licenses, dependencies, and target-specific artifacts.
- **No hand-written binding glue.** Public functions, classes, methods, enums,
  containers, and supported standard-library types are generated from the
  interface you already own.
- **C++ and Rust.** Import local native sources, a `cargo:` crate, or a reusable
  native package through the same project.
- **First-party integrations and ports.** Bundler plugins provide incremental
  builds, while version-pinned ports make libraries such as GDAL, SQLite,
  OpenSSL, GEOS, and PROJ available without rebuilding upstream source.

## Quick start

Prefer to scaffold and configure the project yourself? You need
[Node.js 22+](https://nodejs.org/) and
[Docker](https://www.docker.com/). Docker carries the browser, Android, and
WASI toolchains and is pulled automatically on the first build. iOS additionally
requires macOS, CMake 3.28+, Xcode, and CocoaPods.

Create a project:

```bash
npm create crossbind@beta
```

If you are unsure which template to choose, start with **Web → React → Vite**.
Then run the commands printed by the scaffolder:

```bash
cd my-app
npm install
npm run dev
```

The first native build takes longer because it pulls the toolchain and fills the
build cache. Later rebuilds are incremental.

### Your first native call

Put the public C++ interface under `src/native`:

```cpp
// src/native/hello.h
#pragma once
#include <string>

inline std::string hello(const std::string& name) {
    return "Hello, " + name + "!";
}
```

Import the header from JavaScript and initialize the runtime before the first
native call:

```js
// src/main.js
import { initNative, hello } from './native/hello.h';

await initNative();
console.log(hello('crossbind'));
```

`initNative()` is exported by every generated native module. One call starts
the runtime and binds all native modules imported by the application.

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

Add the build-time configuration at the project root:

```js
// crossbind.config.js
export default {
    paths: {
        config: import.meta.url,
    },
};
```

You can now add the header and JavaScript import from the quick-start example.
For React, Vue, Svelte, Webpack, Rspack, Rollup, Metro, and framework-specific
setups, use the [integration playbooks](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/integration/README.md)
or start from the closest project in [`examples/`](https://github.com/crossbind/crossbind/tree/main/examples).

## How it works

```text
  C++ / Rust source                        header, .rs, or
  or prebuilt port                         cargo: import
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
        +---------------------+---------------------+
        |                     |                     |
        v                     v                     v
  browser / Node / edge   iOS / Android            WASI
  JavaScript + Wasm       native library + JSI     command component
```

There are two configuration surfaces:

| Surface               | When it is read | What belongs there                                                                     |
| --------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `crossbind.config.js` | Build time      | Native paths, dependencies, target, runtime (`st`/`mt`), output, and compiler settings |
| `initNative(options)` | Runtime         | Worker mode, filesystem behavior, environment, asset resolution, and lifecycle hooks   |

Do not put runtime options such as `useWorker` in `crossbind.config.js`; they
only take effect when passed to `initNative(...)`. See the
[runtime and configuration reference](https://github.com/crossbind/crossbind/blob/main/docs/api/README.md) for the complete
contract.

## Runtimes

| Runtime      | Output                                | Important behavior                                                                    |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------------- |
| Browser      | JavaScript loader + WebAssembly       | Single-threaded by default; multithreaded builds need COOP/COEP headers in production |
| Node.js      | JavaScript loader + WebAssembly       | Supports CommonJS or ESM and reads the host filesystem                                |
| Edge         | JavaScript loader + WebAssembly       | Single-threaded, memory-backed, with no OPFS or nested worker mode                    |
| React Native | Native iOS/Android libraries over JSI | No WebAssembly or browser isolation headers                                           |
| WASI         | One `wasm32-wasip3` command component | No JavaScript host; run with a compatible WASI runtime such as wasmtime 47+           |

Threading and worker execution are independent choices:

- `target.runtime: 'mt'` enables a multithreaded build.
- `initNative({ useWorker: true })` moves the module into a browser Web Worker.
- Browser OPFS persistence requires `useWorker: true`.
- Browser `mt` builds require COOP/COEP response headers in production.

Read [Threading and workers](https://github.com/crossbind/crossbind/blob/main/docs/api/threading.md)
and [Filesystem](https://github.com/crossbind/crossbind/blob/main/docs/api/filesystem.md)
before enabling those features.

## Build integrations

| Build tool or runtime | Packages                                                        |
| --------------------- | --------------------------------------------------------------- |
| Vite                  | `@crossbind/plugin-vite`                                        |
| Rollup                | `@crossbind/plugin-rollup`                                      |
| Webpack / Rspack      | `@crossbind/plugin-webpack`, `@crossbind/plugin-webpack-loader` |
| React Native / Metro  | `@crossbind/plugin-react-native`, `@crossbind/plugin-metro`     |
| No bundler            | `crossbind` CLI                                                 |

The plugins resolve native imports, generate bridges, trigger builds, watch
native source directories, and place the produced assets into the application
bundle. The CLI exposes the same build pipeline for Node.js, edge, library, and
WASI projects.

## Prebuilt libraries and commands

The repository contains 16 port families:

**cURL · Expat · GDAL · GEOS · GeoTIFF · iconv · libjpeg-turbo · LERC ·
OpenSSL · PROJ · SpatiaLite · SQLite · libTIFF · WebP · zlib · Zstandard**

Each family has target-specific packages. For example, a browser or Node.js
project uses `@crossbind/port-gdal-wasm`, while mobile and WASI builds use the
matching `-android`, `-ios`, or `-wasi` variant. Import the variant's
`crossbind.config.js` into the application's dependency list:

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

The variant declares its transitive native dependency graph, so link order is
derived automatically. Install and register every platform variant your
project actually builds. See the [package guide](https://crossbind.dev/guide/packages/)
and [`ports/README.md`](https://github.com/crossbind/crossbind/blob/main/ports/README.md)
for the package and license contracts.

Some upstream command-line tools are also published as WASI-powered npm
commands. They require `wasmtime` on `PATH`, but no compiler:

```bash
npm install --global @crossbind/port-gdal-bin-wasi@beta
gdalinfo-wasi --version
```

## Rust

crossbind supports app-local `.rs` files, direct crates.io imports through the
`cargo:` scheme, and reusable Cargo-backed packages. Rust uses the same
generated-module and `initNative()` model as C++.

A local Rust toolchain is required. WebAssembly multithreading currently needs
nightly Rust, and WASI command builds do not yet support Rust because there is
no `wasm32-wasip3` Rust target. Start with the
[Rust guide](https://github.com/crossbind/crossbind/blob/main/docs/api/rust.md)
for the supported type surface and configuration.

## Documentation

- [Guide](https://crossbind.dev/guide/) — product concepts, quick start,
  runtimes, bundlers, bindings, packages, and troubleshooting.
- [Runtime and configuration API](https://github.com/crossbind/crossbind/blob/main/docs/api/README.md)
  — canonical build-time and runtime behavior.
- [Integration playbooks](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/integration/README.md)
  — Vite, Webpack/Rspack, Rollup, Node.js, edge, React Native, and more.
- [Examples](https://github.com/crossbind/crossbind/tree/main/examples) —
  runnable reference applications and library templates.
- [Architecture](https://github.com/crossbind/crossbind/blob/main/docs/ARCHITECTURE.md)
  and [codemap](https://github.com/crossbind/crossbind/blob/main/docs/CODEMAP.md)
  — how the monorepo is organized and where each subsystem lives.
- [Troubleshooting](https://github.com/crossbind/crossbind/blob/main/docs/api/troubleshooting.md)
  — common errors and their standard fixes.
- [Changelog](https://github.com/crossbind/crossbind/blob/main/CHANGELOG.md) —
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

Copyright © 2026 Buğra Sarı
