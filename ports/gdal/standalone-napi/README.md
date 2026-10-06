# @crossbind/port-gdal-standalone-napi

gdal for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-gdal-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as gdal from '@crossbind/port-gdal-standalone-napi';

await gdal.initNative();
```

Headers: `gdal.h`, `gdal_alg.h`, `gdal_utils.h`, `gdalwarper.h`, `gdal_vrt.h`, `gdal_version.h`, `gdalalgorithm_c.h`, `ogr_api.h`, `ogr_core.h`, `ogr_srs_api.h`, `cpl_conv.h`, `cpl_error.h`, `cpl_string.h`, `cpl_vsi.h`, `cpl_progress.h`, `cpl_minixml.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-gdal](https://github.com/crossbind/crossbind/tree/main/ports/gdal#readme).
