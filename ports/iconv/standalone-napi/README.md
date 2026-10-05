# @crossbind/port-iconv-standalone-napi

iconv for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-iconv-standalone-napi
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as iconv from '@crossbind/port-iconv-standalone-napi';

await iconv.initNative();
```

Headers: `iconv.h`, `localcharset.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-iconv](https://github.com/crossbind/crossbind/tree/main/ports/iconv#readme).
