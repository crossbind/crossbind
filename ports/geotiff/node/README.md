# @crossbind/port-geotiff-node

geotiff 1.7.4 for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-geotiff-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as geotiff from '@crossbind/port-geotiff-node/geotiff.h';
```

Headers: `geotiff.h`, `geotiffio.h`, `xtiffio.h`, `geo_normalize.h`, `geokeys.h`, `geovalues.h`, `geotiff_crossbind.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-geotiff](https://github.com/crossbind/crossbind/tree/main/ports/geotiff#readme).
