# @crossbind/example-backend-nodejs-prebuilt
**crossbind Node.js sample on a ready-made Node package**

The matrix library of [backend-nodejs-native](../backend-nodejs-native), installed as
[@crossbind/example-lib-prebuilt-matrix-node](../lib-prebuilt-matrix-node): prebuilt Node-API
addons for macOS, Linux (glibc and musl) and Windows, of which npm installs only the one for your
machine. The app builds nothing, so it needs neither Docker nor a compiler, and crossbind is not
one of its dependencies.

```js
import { Matrix } from '@crossbind/example-lib-prebuilt-matrix-node/Matrix.h';

const product = new Matrix(9, 1).multiple(new Matrix(9, 2));
```

Every `@crossbind/port-<name>-node` package works the same way, e.g. `@crossbind/port-zlib-node/zlib.h`.
In an app of your own, `npm install @crossbind/example-lib-prebuilt-matrix-node` is the whole setup.

# Getting Started

Inside this repository the package comes from the workspace, so build it first (in Docker, and
its macOS addons on a Mac):

```bash
pnpm install
pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:desktop
pnpm --filter @crossbind/example-lib-prebuilt-matrix-node run build
```

Run it:

```bash
pnpm start
```
