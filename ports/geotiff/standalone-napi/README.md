# @crossbind/port-geotiff-standalone-napi

geotiff for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-geotiff-standalone-napi
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as geotiff from '@crossbind/port-geotiff-standalone-napi';

await geotiff.initNative();
```

Headers: `geotiff.h`, `geotiffio.h`, `xtiffio.h`, `geo_normalize.h`, `geokeys.h`, `geovalues.h`, `geotiff_crossbind.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-geotiff](https://github.com/crossbind/crossbind/tree/main/ports/geotiff#readme).
