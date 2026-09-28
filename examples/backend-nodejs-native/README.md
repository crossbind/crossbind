# @crossbind/example-backend-nodejs-native
**crossbind Node.js native addon sample**

The same C++ code as [backend-nodejs-wasm](../backend-nodejs-wasm), built as a Node-API addon
instead of WebAssembly. `initNative()` resolves the same module shape on both builds.

# Getting Started

>**Note**: Make sure you have completed the [crossbind - Prerequisites](https://crossbind.dev/docs/guide/getting-started/prerequisites) instructions.
Native addons for macOS build on a macOS host with Xcode's command line tools.

## Setup

Install the dependencies, then build the matrix library for macOS:

```bash
pnpm install
pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:darwin
```

## Get Started

Build the addons (`darwin-arm64` and `darwin-x64`) and their loader:

```bash
pnpm run build
```

Run it:

```bash
node src/index.js
```
