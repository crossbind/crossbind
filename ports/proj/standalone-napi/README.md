# @crossbind/port-proj-standalone-napi

proj for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-proj-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as proj from '@crossbind/port-proj-standalone-napi';

await proj.initNative();
```

Headers: `proj.h`, `geodesic.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-proj](https://www.npmjs.com/package/@crossbind/port-proj).
