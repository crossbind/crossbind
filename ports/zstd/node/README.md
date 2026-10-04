# @crossbind/port-zstd-node

zstd for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-zstd-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as zstd from '@crossbind/port-zstd-node/zstd.h';
```

Headers: `zstd.h`, `zdict.h`, `zstd_errors.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-zstd](https://github.com/crossbind/crossbind/tree/main/ports/zstd#readme).
