# @crossbind/port-webp-node

webp 1.6.0 for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-webp-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as webp from '@crossbind/port-webp-node/webp/decode.h';
```

Headers: `webp/decode.h`, `webp/encode.h`, `webp/demux.h`, `webp/mux.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-webp](https://github.com/crossbind/crossbind/tree/main/ports/webp#readme).
