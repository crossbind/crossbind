# @crossbind/port-tiff-node

tiff for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-tiff-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as tiff from '@crossbind/port-tiff-node/tiffio.h';
```

Headers: `tiffio.h`, `tiff.h`, `tiffvers.h`, `tiffio_crossbind.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-tiff](https://github.com/crossbind/crossbind/tree/main/ports/tiff#readme).
