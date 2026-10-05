# @crossbind/port-tiff-standalone-napi

tiff for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-tiff-standalone-napi
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as tiff from '@crossbind/port-tiff-standalone-napi';

await tiff.initNative();
```

Headers: `tiffio.h`, `tiff.h`, `tiffvers.h`, `tiffio_crossbind.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-tiff](https://github.com/crossbind/crossbind/tree/main/ports/tiff#readme).
