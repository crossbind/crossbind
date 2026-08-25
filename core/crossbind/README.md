<div align="center">
  <a href="https://crossbind.dev">
    <picture>
      <img alt="crossbind logo" src="https://crossbind.dev/img/logo.png" height="128">
    </picture>
  </a>
  <h1>crossbind</h1>
<p align="center">
  <strong>Bind C++ to JavaScript with no extra code.</strong><br>
  WebAssembly, WASI & React Native
</p>

<a href="https://www.npmjs.com/package/crossbind/v/beta"><img alt="NPM version" src="https://img.shields.io/npm/v/crossbind/beta?style=for-the-badge&label=npm" /></a>
<a href="https://github.com/crossbind/crossbind/pkgs/container/web"><img alt="Build image" src="https://img.shields.io/badge/ghcr.io-crossbind%2Fweb-20B2AA?style=for-the-badge&logo=docker&label=image" /></a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" /></a>
<br />
<img alt="CodeQL" src="https://img.shields.io/github/actions/workflow/status/crossbind/crossbind/github-code-scanning/codeql?branch=main&style=for-the-badge&label=CodeQL">
<img alt="Linux Build" src="https://img.shields.io/github/actions/workflow/status/crossbind/crossbind/build-linux.yml?branch=main&style=for-the-badge&label=Linux%20Build">
<img alt="Macos Build" src="https://img.shields.io/github/actions/workflow/status/crossbind/crossbind/build-macos.yml?branch=main&style=for-the-badge&label=Macos%20Build">
<img alt="Windows Build" src="https://img.shields.io/github/actions/workflow/status/crossbind/crossbind/build-windows.yml?branch=main&style=for-the-badge&label=Windows%20Build">
</div>

<h3 align="center">
  <a href="https://crossbind.dev/docs/guide/getting-started/introduction"><strong>For Developers</strong></a>
  <span> · </span>
  <a href="https://github.com/crossbind/crossbind/blob/main/docs/agent-overview.md"><strong>For AI Agents</strong></a>
  <span> · </span>
  <a href="https://crossbind.dev/docs/package/package/showcase">Showcase</a>
</h3>

## Why crossbind?
- **No glue code** — write standard C++ headers; bindings are generated for you.
- **Rust too** — import a crates.io crate (`import { Uuid } from 'cargo:uuid'`) or a plain `.rs` file the same way; no proc-macros, no glue.
- **Single source, multi-target** — the same code runs in browsers, Node.js, iOS, Android — and as WASI components.
- **Battle-tested libraries** — drop-in support for GDAL, GEOS, OpenSSL, SQLite, PROJ, and more.
- **CLI tools from npm** — upstream command-line tools (gdal, proj, sqlite3, curl, …) prebuilt as WASI components: install the `-bin-wasi` package, run `<tool>-wasi` under wasmtime, no compiler involved.
- **Bundler-agnostic** — first-class plugins for Vite, Rollup, Webpack, Metro, and React Native.
- **AI-agent ready** — one portable skill teaches coding agents when crossbind fits, how to integrate it and how to verify the result.

## For AI coding agents
When you describe a problem ("use C++ in browser", "add GDAL to my Vite app", "wrap libsodium for crossbind"), the crossbind skill inspects the project, selects the relevant reference and walks your coding agent through a verified integration.

```bash
npx skills add https://github.com/crossbind/crossbind/tree/main/agents/skills --global --yes
```

The skill is self-contained and uses the coding agent's normal filesystem and terminal capabilities. It does not require a client-specific extension or background service. Its source, deterministic inspector and generated references live in [`agents/`](../../agents/).

Full agent guide, runtime/config API reference, and troubleshooting catalogue: [**docs/agent-overview.md**](https://github.com/crossbind/crossbind/blob/main/docs/agent-overview.md).

## Create a New Project
Requires **Docker** + **Node 22+**. Mobile builds also need CMake 3.28+, Xcode, and CocoaPods — see the full [prerequisites](https://crossbind.dev/docs/guide/getting-started/prerequisites) page.

```sh
npm create crossbind@beta
```

## Basic Usage
**src/index.js**
```js
import { initNative, Factorial } from './native/Factorial.h';

await initNative();
const factorial = new Factorial(99999);
const result = factorial.calculate();
console.log(result);
```

**src/native/Factorial.h**
```c++
class Factorial {
private:
    int number;

public:
    Factorial(int num) : number(num) {}

    int calculate() {
        if (number < 0) return -1;

        int result = 1;
        for (int i = 2; i <= number; i++) {
            result *= i;
        }
        return result;
    }
};
```

## Official Packages
Officially maintained, prebuilt C++ libraries you can install as npm packages and use directly from JavaScript:

| Package | Latest (beta) |
| --- | --- |
| [@crossbind/port-gdal](https://www.npmjs.com/package/@crossbind/port-gdal) | ![npm](https://img.shields.io/npm/v/@crossbind/port-gdal/beta) |
| [@crossbind/port-geos](https://www.npmjs.com/package/@crossbind/port-geos) | ![npm](https://img.shields.io/npm/v/@crossbind/port-geos/beta) |
| [@crossbind/port-proj](https://www.npmjs.com/package/@crossbind/port-proj) | ![npm](https://img.shields.io/npm/v/@crossbind/port-proj/beta) |
| [@crossbind/port-spatialite](https://www.npmjs.com/package/@crossbind/port-spatialite) | ![npm](https://img.shields.io/npm/v/@crossbind/port-spatialite/beta) |
| [@crossbind/port-sqlite3](https://www.npmjs.com/package/@crossbind/port-sqlite3) | ![npm](https://img.shields.io/npm/v/@crossbind/port-sqlite3/beta) |
| [@crossbind/port-openssl](https://www.npmjs.com/package/@crossbind/port-openssl) | ![npm](https://img.shields.io/npm/v/@crossbind/port-openssl/beta) |
| [@crossbind/port-curl](https://www.npmjs.com/package/@crossbind/port-curl) | ![npm](https://img.shields.io/npm/v/@crossbind/port-curl/beta) |
| [@crossbind/port-tiff](https://www.npmjs.com/package/@crossbind/port-tiff) | ![npm](https://img.shields.io/npm/v/@crossbind/port-tiff/beta) |
| [@crossbind/port-geotiff](https://www.npmjs.com/package/@crossbind/port-geotiff) | ![npm](https://img.shields.io/npm/v/@crossbind/port-geotiff/beta) |
| [@crossbind/port-webp](https://www.npmjs.com/package/@crossbind/port-webp) | ![npm](https://img.shields.io/npm/v/@crossbind/port-webp/beta) |
| [@crossbind/port-expat](https://www.npmjs.com/package/@crossbind/port-expat) | ![npm](https://img.shields.io/npm/v/@crossbind/port-expat/beta) |
| [@crossbind/port-iconv](https://www.npmjs.com/package/@crossbind/port-iconv) | ![npm](https://img.shields.io/npm/v/@crossbind/port-iconv/beta) |
| [@crossbind/port-zlib](https://www.npmjs.com/package/@crossbind/port-zlib) | ![npm](https://img.shields.io/npm/v/@crossbind/port-zlib/beta) |
| [@crossbind/port-zstd](https://www.npmjs.com/package/@crossbind/port-zstd) | ![npm](https://img.shields.io/npm/v/@crossbind/port-zstd/beta) |
| [@crossbind/port-lerc](https://www.npmjs.com/package/@crossbind/port-lerc) | ![npm](https://img.shields.io/npm/v/@crossbind/port-lerc/beta) |
| [@crossbind/port-jpegturbo](https://www.npmjs.com/package/@crossbind/port-jpegturbo) | ![npm](https://img.shields.io/npm/v/@crossbind/port-jpegturbo/beta) |

Browse all available packages at [crossbind.dev/docs/package/package/showcase](https://crossbind.dev/docs/package/package/showcase).

## 🌱 Community Packages
Community-maintained, prebuilt C++ libraries packaged for crossbind — published under the [crossbind-community](https://github.com/crossbind-community) organization. Anyone can contribute new packages following the same standard, and they'll be listed here.

| Package | Repository |
| --- | --- |
| simdjson | [github.com/crossbind-community/package-simdjson](https://github.com/crossbind-community/package-simdjson) |

Want to add yours? Start a discussion at [crossbind/crossbind/discussions](https://github.com/crossbind/crossbind/discussions).

## License
[MIT](https://github.com/crossbind/crossbind/blob/main/LICENSE)

Copyright (c) 2026, Buğra Sarı
