# @crossbind/port-spatialite-node

spatialite for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-spatialite-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as spatialite from '@crossbind/port-spatialite-node/spatialite.h';
```

Headers: `spatialite.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-spatialite](https://github.com/crossbind/crossbind/tree/main/ports/spatialite#readme).
