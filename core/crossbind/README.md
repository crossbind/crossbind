<div align="center">
  <a href="https://crossbind.dev">
    <img src="https://raw.githubusercontent.com/crossbind/crossbind/main/landing/public/favicon.svg" alt="crossbind logo" height="96">
  </a>

  <h1>crossbind</h1>

  <p><strong>Build and ship JS apps. Add C++ and Rust as needed.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/crossbind/v/beta"><img src="https://img.shields.io/npm/v/crossbind/beta?style=flat-square&label=npm%20beta" alt="npm beta version"></a>
    <a href="https://github.com/crossbind/crossbind/actions/workflows/build-linux.yml"><img src="https://img.shields.io/github/actions/workflow/status/crossbind/crossbind/build-linux.yml?branch=main&style=flat-square&label=linux" alt="Linux build status"></a>
    <a href="https://github.com/crossbind/crossbind/blob/main/LICENSE"><img src="https://img.shields.io/github/license/crossbind/crossbind?style=flat-square" alt="MIT license"></a>
  </p>

  <p>
    <a href="https://crossbind.dev/guide/">Guide</a>
    · <a href="https://crossbind.dev/tutorial/">Tutorial</a>
    · <a href="https://crossbind.dev/playground/">Playground</a>
    · <a href="https://crossbind.dev/ports/">Libraries</a>
    · <a href="https://crossbind.dev/examples/">Examples</a>
  </p>
</div>

Import a C++ header or a Rust file from JavaScript and call what it declares.
crossbind compiles the code for the platform your app runs on and generates the
bindings, so there is no glue code to write.

```js
// src/main.js
import { initNative, greet } from './native/greet.h';
import { fibonacci } from './native/math.rs';

await initNative();

console.log(await greet('crossbind')); // Hello, crossbind!
console.log(await fibonacci(90)); // 2880067194370816120n
```

```cpp
// src/native/greet.h
#pragma once
#include <string>

inline std::string greet(std::string name) {
    return "Hello, " + name + "!";
}
```

```rust
// src/native/math.rs
pub fn fibonacci(n: i32) -> u64 {
    let (mut a, mut b) = (0, 1);
    for _ in 0..n {
        (a, b) = (b, a + b);
    }
    a
}
```

Run it in the [playground](https://crossbind.dev/playground/?sample=hero), or
take the [tutorial](https://crossbind.dev/tutorial/). Both run in your browser,
with nothing to install.

## Where it runs

The same import works everywhere; crossbind builds what each platform loads.

- **[Browser](https://crossbind.dev/guide/browser/)**: WebAssembly, run in a Web
  Worker by default.
- **[Node.js](https://crossbind.dev/guide/node/) and
  [Electron](https://crossbind.dev/guide/electron/)**: WebAssembly, or a native
  Node-API addon.
- **[Edge](https://crossbind.dev/guide/edge/)**: WebAssembly on Cloudflare
  Workers and other edge runtimes.
- **[React Native](https://crossbind.dev/guide/react-native/)**: native iOS and
  Android libraries, called over JSI.
- **[Apps](https://crossbind.dev/guide/apps/)**: your web page as a macOS,
  Linux, Windows, iOS or Android app, with the native code inside the app.
- **[Executables](https://crossbind.dev/guide/executables/)**: command-line
  programs for macOS, Linux and Windows, and WASI commands.

## Get started

crossbind 2.0 is in beta, so install it with `@beta`. You need Node.js 26 or
later and Docker, which runs the compilers; without Docker,
[remote builds](https://crossbind.dev/guide/remote-builds/) run them on another
machine. Mobile builds also need CMake 3.28 or later, and iOS builds a Mac with
Xcode and CocoaPods.

Create a project and answer the prompts (Web, React and Vite if you are unsure):

```bash
npm create crossbind@beta
cd my-app
npm install
npm run dev
```

The first build downloads the toolchain image, so it takes a few minutes. Later
builds only rebuild what changed.

### Add it to an existing project

Install the plugin for your bundler. For Vite:

```bash
npm install -D @crossbind/plugin-vite@beta
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import viteCrossbindPlugin from '@crossbind/plugin-vite';

export default defineConfig({
    plugins: [viteCrossbindPlugin()],
});
```

```js
// crossbind.config.js
export default {
    paths: {
        config: import.meta.url,
    },
};
```

Webpack, Rspack, Rollup and Metro have plugins too: see
[Bundler plugins](https://crossbind.dev/guide/bundler-plugins/). Node.js, edge
and library projects build with the [`crossbind` CLI](https://crossbind.dev/guide/cli/).

### With a coding agent

Paste this line into your coding agent. It installs the crossbind skill, adds
crossbind to the project and checks one call from JavaScript:

```text
Fetch and follow the instructions at https://crossbind.dev/agent/prompt.md to add crossbind to this project.
```

## Libraries

Sixteen C and C++ libraries come prebuilt for every platform: GDAL, GEOS, PROJ,
GeoTIFF, SpatiaLite, SQLite, OpenSSL, cURL, zlib, Zstandard, libjpeg-turbo,
libTIFF, WebP, LERC, Expat and iconv. Install the package for your platform,
list it in `crossbind.config.js` and import its headers:

```bash
npm install @crossbind/port-gdal-wasm@beta
```

```js
// crossbind.config.js
import gdalWasm from '@crossbind/port-gdal-wasm/crossbind.config.js';

export default {
    dependencies: [gdalWasm],
    paths: { config: import.meta.url },
};
```

```js
// src/main.js
import { initNative, GDALOpenEx } from '@crossbind/port-gdal/gdal.h';

await initNative();
```

[Libraries](https://crossbind.dev/ports/) lists the package of each library for
every platform. You can also import a crates.io crate with
[`cargo:`](https://crossbind.dev/guide/crates-io/) and a ConanCenter package
with [`conan:`](https://crossbind.dev/guide/conan/).

## Documentation

- [Guide](https://crossbind.dev/guide/): setup, platforms, apps, bindings and
  troubleshooting.
- [API reference](https://github.com/crossbind/crossbind/blob/main/docs/api/README.md):
  every build and run-time option.
- [Examples](https://crossbind.dev/examples/): apps to open and read.
- [Changelog](https://crossbind.dev/changelog/).

## Contributing

crossbind is a pnpm monorepo:

```bash
git clone https://github.com/crossbind/crossbind.git
cd crossbind
pnpm install
pnpm run doctor
pnpm test
```

[CONTRIBUTING.md](https://github.com/crossbind/crossbind/blob/main/CONTRIBUTING.md)
explains the layout and the checks each change needs. Ask questions in
[Discussions](https://github.com/crossbind/crossbind/discussions) and report bugs
in [Issues](https://github.com/crossbind/crossbind/issues).

## License

[MIT](https://github.com/crossbind/crossbind/blob/main/LICENSE). Copyright © 2026
Buğra Sarı and crossbind contributors.
