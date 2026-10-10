# @crossbind/port-lerc-standalone-napi

lerc for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-lerc-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as lerc from '@crossbind/port-lerc-standalone-napi';

await lerc.initNative();
```

Headers: `Lerc_c_api.h`, `Lerc_types.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-lerc](https://www.npmjs.com/package/@crossbind/port-lerc).
