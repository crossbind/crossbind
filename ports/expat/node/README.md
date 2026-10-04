# @crossbind/port-expat-node

expat for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-expat-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as expat from '@crossbind/port-expat-node/expat.h';
```

Headers: `expat.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-expat](https://github.com/crossbind/crossbind/tree/main/ports/expat#readme).
