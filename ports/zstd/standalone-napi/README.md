# @crossbind/port-zstd-standalone-napi

zstd for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-zstd-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as zstd from '@crossbind/port-zstd-standalone-napi';

await zstd.initNative();
```

Headers: `zstd.h`, `zdict.h`, `zstd_errors.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-zstd](https://github.com/crossbind/crossbind/tree/main/ports/zstd#readme).
