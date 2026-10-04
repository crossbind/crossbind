# @crossbind/port-openssl-node

openssl for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-openssl-node
```

Each public header is a module whose functions and constants are ready on import:

```js
import * as openssl from '@crossbind/port-openssl-node/openssl/opensslv.h';
```

Headers: `openssl/opensslv.h`, `openssl/crypto.h`, `openssl/err.h`, `openssl/evp.h`, `openssl/rand.h`, `openssl/sha.h`, `openssl/hmac.h`, `openssl/bio.h`, `openssl/pem.h`, `openssl/x509.h`, `openssl/ssl.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-openssl](https://github.com/crossbind/crossbind/tree/main/ports/openssl#readme).
