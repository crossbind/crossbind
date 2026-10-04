# @crossbind/port-sqlite3-node

sqlite3 for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-sqlite3-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as sqlite3 from '@crossbind/port-sqlite3-node/sqlite3.h';
```

Headers: `sqlite3.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-sqlite3](https://github.com/crossbind/crossbind/tree/main/ports/sqlite3#readme).
