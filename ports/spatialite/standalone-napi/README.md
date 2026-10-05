# @crossbind/port-spatialite-standalone-napi

spatialite for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-spatialite-standalone-napi
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as spatialite from '@crossbind/port-spatialite-standalone-napi';

await spatialite.initNative();
```

Headers: `spatialite.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-spatialite](https://github.com/crossbind/crossbind/tree/main/ports/spatialite#readme).
