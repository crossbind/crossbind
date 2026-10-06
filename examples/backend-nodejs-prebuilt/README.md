# @crossbind/example-backend-nodejs-prebuilt
**crossbind Node.js sample on the Node-API addons a prebuilt library ships**

The matrix library of [backend-nodejs-native](../backend-nodejs-native), installed as
[@crossbind/example-lib-prebuilt-matrix](../lib-prebuilt-matrix), which ships prebuilt Node-API
addons for macOS, Linux (glibc and musl) and Windows next to its WebAssembly and mobile builds.
The app builds nothing, so it needs neither Docker nor a compiler, and crossbind is not one of its
dependencies.

```js
import { initNative, Matrix } from '@crossbind/example-lib-prebuilt-matrix/node/napi';

await initNative();
const product = new Matrix(9, 1).multiple(new Matrix(9, 2));
```

Every name the library binds is ready once `initNative()` resolves, and the same import from
`/node/wasm` runs its WebAssembly build instead. A `@crossbind/port-<name>-standalone-napi` package
works the same way from its package root, e.g. `@crossbind/port-zlib-standalone-napi`. In an app of
your own, `npm install @crossbind/example-lib-prebuilt-matrix@beta` is the whole setup.

# Getting Started

Inside this repository the package comes from the workspace, so build its addons first (in Docker,
and the macOS ones on a Mac):

```bash
pnpm install
pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:desktop
```

Run it:

```bash
pnpm start
```
