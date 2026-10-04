# @crossbind/port-jpegturbo-node

jpegturbo 3.2.0 for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-jpegturbo-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as jpegturbo from '@crossbind/port-jpegturbo-node/jpeglib.h';
```

Headers: `jpeglib.h`, `jerror.h`, `jpeglib_crossbind.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-jpegturbo](https://github.com/crossbind/crossbind/tree/main/ports/jpegturbo#readme).
