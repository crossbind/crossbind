# @crossbind/example-lib-prebuilt-matrix-node

The matrix multiplier of [@crossbind/example-lib-prebuilt-matrix](../lib-prebuilt-matrix) for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/example-lib-prebuilt-matrix-node
```

`Matrix.h` is a module whose classes are ready on import:

```js
import { Matrix } from '@crossbind/example-lib-prebuilt-matrix-node/Matrix.h';

const product = new Matrix(9, 1).multiple(new Matrix(9, 2));
console.log(product.get(0)); // 6
```

[examples/backend-nodejs-prebuilt](../backend-nodejs-prebuilt) uses it. Every `@crossbind/port-<name>-node` package is made the same way.

## Build

The addons link the library's prebuilt archives for each platform, so build those first. Linux and Windows build in Docker, macOS on a Mac:

```bash
pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:desktop
pnpm --filter @crossbind/example-lib-prebuilt-matrix-node run build
```

The build copies each addon into its platform package (`@crossbind/example-lib-prebuilt-matrix-node-<platform>-<arch>`) and derives the license files of every package.
