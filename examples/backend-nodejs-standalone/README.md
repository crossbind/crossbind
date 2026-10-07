# @crossbind/example-backend-nodejs-standalone
**crossbind Node.js sample on a standalone Node-API package**

The app builds nothing: it installs the matrix library,
[@crossbind/example-lib-prebuilt-matrix](https://github.com/crossbind/crossbind/tree/main/examples/lib-prebuilt-matrix),
which ships prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows next to its
WebAssembly and mobile builds. It needs neither Docker nor a compiler, and crossbind is not one of
its dependencies.

```js
import { initNative, Matrix } from '@crossbind/example-lib-prebuilt-matrix/node/napi';

await initNative();
const product = new Matrix(9, 1).multiple(new Matrix(9, 2));
```

Every name the library binds is ready once `initNative()` resolves, and the same import from
`/node/wasm` runs its WebAssembly build instead. A `@crossbind/port-<name>-standalone-napi` package
works the same way from its package root, e.g. `@crossbind/port-zlib-standalone-napi`. In an app of
your own, `npm install @crossbind/example-lib-prebuilt-matrix@beta` is the whole setup. To build an
addon from C++ of your own instead, start from
[backend-nodejs-native](https://github.com/crossbind/crossbind/tree/main/examples/backend-nodejs-native).

# Getting Started

```bash
pnpm install
pnpm start
```

Inside the crossbind repository the library comes from the workspace, so build its addons first
(in Docker, and the macOS ones on a Mac):
`pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:desktop`.
