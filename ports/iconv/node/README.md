# @crossbind/port-iconv-node

iconv 1.19 for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-iconv-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as iconv from '@crossbind/port-iconv-node/iconv.h';
```

Headers: `iconv.h`, `localcharset.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-iconv](https://github.com/crossbind/crossbind/tree/main/ports/iconv#readme).
