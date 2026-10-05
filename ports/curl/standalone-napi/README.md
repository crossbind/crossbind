# @crossbind/port-curl-standalone-napi

curl for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-curl-standalone-napi
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as curl from '@crossbind/port-curl-standalone-napi';

await curl.initNative();
```

Headers: `curl/curl.h`, `curl/curlver.h`, `curl/easy.h`, `curl/multi.h`, `curl/urlapi.h`, `curl/options.h`, `curl/header.h`, `curl/websockets.h`, `curl/curl_crossbind.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-curl](https://github.com/crossbind/crossbind/tree/main/ports/curl#readme).
