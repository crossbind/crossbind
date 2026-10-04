# @crossbind/port-geos-node

geos for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-geos-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as geos from '@crossbind/port-geos-node/geos_c.h';
```

Headers: `geos_c.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-geos](https://github.com/crossbind/crossbind/tree/main/ports/geos#readme).
