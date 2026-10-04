# @crossbind/port-proj-node

proj 9.9.0 for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-proj-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as proj from '@crossbind/port-proj-node/proj.h';
```

Headers: `proj.h`, `geodesic.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-proj](https://github.com/crossbind/crossbind/tree/main/ports/proj#readme).
