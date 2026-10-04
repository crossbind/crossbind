# @crossbind/port-zlib-node

zlib for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-zlib-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as zlib from '@crossbind/port-zlib-node/zlib.h';
```

Headers: `zlib.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-zlib](https://github.com/crossbind/crossbind/tree/main/ports/zlib#readme).
