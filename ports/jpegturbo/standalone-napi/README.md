# @crossbind/port-jpegturbo-standalone-napi

jpegturbo for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-jpegturbo-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as jpegturbo from '@crossbind/port-jpegturbo-standalone-napi';

await jpegturbo.initNative();
```

Headers: `jpeglib.h`, `jerror.h`, `jconfig.h`, `jpeglib_crossbind.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-jpegturbo](https://www.npmjs.com/package/@crossbind/port-jpegturbo).
