# @crossbind/port-geos-standalone-napi

geos for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-geos-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as geos from '@crossbind/port-geos-standalone-napi';

await geos.initNative();
```

Headers: `geos_c.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-geos](https://github.com/crossbind/crossbind/tree/main/ports/geos#readme).
