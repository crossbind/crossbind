# @crossbind/port-expat-standalone-napi

expat for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-expat-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as expat from '@crossbind/port-expat-standalone-napi';

await expat.initNative();
```

Headers: `expat.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-expat](https://www.npmjs.com/package/@crossbind/port-expat).
