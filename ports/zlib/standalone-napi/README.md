# @crossbind/port-zlib-standalone-napi

zlib for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-zlib-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as zlib from '@crossbind/port-zlib-standalone-napi';

await zlib.initNative();
```

Headers: `zlib.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-zlib](https://github.com/crossbind/crossbind/tree/main/ports/zlib#readme).
