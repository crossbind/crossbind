# @crossbind/port-openssl-standalone-napi

openssl for Node.js with nothing to build: prebuilt Node-API addons for macOS, Linux (glibc and musl) and Windows, on arm64 and x64. npm installs only the addon for your machine.

```bash
npm install @crossbind/port-openssl-standalone-napi@beta
```

The package root exports every function, class and constant of the public headers, ready once `initNative()` resolves:

```js
import * as openssl from '@crossbind/port-openssl-standalone-napi';

await openssl.initNative();
```

Headers: `openssl/opensslv.h`, `openssl/crypto.h`, `openssl/err.h`, `openssl/evp.h`, `openssl/rand.h`, `openssl/sha.h`, `openssl/hmac.h`, `openssl/bio.h`, `openssl/pem.h`, `openssl/x509.h`, `openssl/ssl.h`.

Built with [crossbind](https://crossbind.dev) from [@crossbind/port-openssl](https://www.npmjs.com/package/@crossbind/port-openssl).
