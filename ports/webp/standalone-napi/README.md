# @crossbind/port-webp-standalone-napi

webp for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-webp-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as webp from '@crossbind/port-webp-standalone-napi';

await webp.initNative();
```

Headers: `webp/decode.h`, `webp/encode.h`, `webp/types.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-webp](https://www.npmjs.com/package/@crossbind/port-webp).
