# @crossbind/example-backend-nodejs-native
**crossbind Node.js native addon sample**

The same C++ code as [backend-nodejs-wasm](../backend-nodejs-wasm), built as a Node-API addon
instead of WebAssembly. `initNative()` resolves the same module shape on both builds.

The app builds its own addon: crossbind generates the bindings of `src/native/native.h` and links
the matrix library's archives into one addon per platform. To use a library without building
anything, see [backend-nodejs-prebuilt](../backend-nodejs-prebuilt), which installs the same
library as a ready-made Node package.

# Getting Started

>**Note**: Make sure you have completed the [crossbind - Prerequisites](https://crossbind.dev/docs/guide/getting-started/prerequisites) instructions.
The bindings and the Linux and Windows addons build in Docker; the macOS addons build on a macOS
host with Xcode's command line tools and are skipped elsewhere.

## Setup

Install the dependencies, then build the matrix library's archives for the desktop platforms:

```bash
pnpm install
pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:desktop
```

## Get Started

Build the addons (`linux`, `linuxmusl` and `win32`, plus `darwin` on a Mac, each for arm64 and
x64) and their loader:

```bash
pnpm run build
```

`pnpm run build:darwin` builds only the macOS addons.

Run it:

```bash
node src/index.js
```
