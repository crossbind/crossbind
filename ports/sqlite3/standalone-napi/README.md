# @crossbind/port-sqlite3-standalone-napi

sqlite3 for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-sqlite3-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as sqlite3 from '@crossbind/port-sqlite3-standalone-napi';

await sqlite3.initNative();
```

Headers: `sqlite3.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-sqlite3](https://www.npmjs.com/package/@crossbind/port-sqlite3).
