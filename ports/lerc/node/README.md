# @crossbind/port-lerc-node

lerc 4.2.0 for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-lerc-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as lerc from '@crossbind/port-lerc-node/Lerc_c_api.h';
```

Headers: `Lerc_c_api.h`, `Lerc_types.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-lerc](https://github.com/crossbind/crossbind/tree/main/ports/lerc#readme).
