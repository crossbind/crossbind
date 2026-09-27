# @crossbind/port-curl
**Precompiled libcurl library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-curl">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-curl?style=for-the-badge" />
</a>
<a href="https://github.com/curl/curl">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-curl%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=curl" />
</a>
<a href="https://github.com/curl/curl/blob/master/COPYING">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-curl?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/curl](https://crossbind.dev/ports/curl/#apps)** run this package in your browser. They use libcurl's URL and date parsers, which need no network, next to the browser's own:

- **URL allowlist check.** Nine URL tricks through `new URL()` and through libcurl's parser, with the flags `curl_easy_perform` uses. Three of them, such as `http://example.com\@attacker.example/`, pass a check on `new URL(url).hostname` for example.com and send libcurl to attacker.example.
- **URL lab.** Every part of a URL as libcurl and your browser read it, and a Location header followed by both. `HTTPS://EXAMPLE.COM:443/` stays `https://EXAMPLE.COM:443/` in libcurl and becomes `https://example.com/` in a browser; from `https://example.com/a/b/c`, a redirect to `..\evil` takes libcurl to `https://example.com/a/b/..\evil` and a browser to `https://example.com/a/evil`.
- **Date lab.** `curl_getdate` beside `Date.parse` on HTTP dates. `Thu, 01-Jan-70 00:00:01 GMT`, an old way to delete a cookie, is 2070 to curl and 1970 to Chromium and WebKit, and ISO 8601 is a date only to the browser.

Their C++ wrappers, and the self-check the site build runs against values computed independently of this package, are in [`landing/demos/lib-curl`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-curl).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-curl @crossbind/port-curl-wasm @crossbind/port-curl-android @crossbind/port-curl-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import curlWasm from '@crossbind/port-curl-wasm/crossbind.config.js';
+import curlAndroid from '@crossbind/port-curl-android/crossbind.config.js';
+import curlIos from '@crossbind/port-curl-ios/crossbind.config.js';

export default {
    dependencies: [
+        curlWasm,
+        curlAndroid,
+        curlIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one parses URLs with libcurl's URL API, the parser curl runs on a URL before every transfer. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/url_parts.h
#pragma once

#include <curl/curl.h>

#include <stdexcept>
#include <string>

// libcurl's URL API, the parser curl runs on a URL before every transfer. Each call parses the URL
// into a fresh CURLU handle, reads one part back and frees the handle.
class UrlParts {
public:
    // The URL as curl stores it: the scheme lowercased and dot segments removed. The host keeps its case.
    static std::string normalize(const std::string& url) { return get(url, CURLUPART_URL, 0); }

    static std::string host(const std::string& url) { return get(url, CURLUPART_HOST, 0); }

    // CURLU_DEFAULT_PORT answers with the scheme's port when the URL does not name one.
    static std::string port(const std::string& url) { return get(url, CURLUPART_PORT, CURLU_DEFAULT_PORT); }

    static std::string path(const std::string& url) { return get(url, CURLUPART_PATH, 0); }

    // CURLU_URLDECODE turns %XX sequences back into the bytes they stand for.
    static std::string query(const std::string& url) { return get(url, CURLUPART_QUERY, CURLU_URLDECODE); }

private:
    static std::string get(const std::string& url, CURLUPart part, unsigned int flags) {
        CURLU* handle = curl_url();
        if (!handle) throw std::runtime_error("out of memory");
        char* value = nullptr;
        CURLUcode code = curl_url_set(handle, CURLUPART_URL, url.c_str(), 0);
        if (code == CURLUE_OK) code = curl_url_get(handle, part, &value, flags);
        curl_url_cleanup(handle);
        if (code != CURLUE_OK) throw std::runtime_error(curl_url_strerror(code));
        const std::string result = value;
        curl_free(value);
        return result;
    }
};
```

Then call it from JavaScript:

```js
import { initNative, UrlParts } from './native/url_parts.h';

await initNative();
const url = 'HTTPS://Example.com/docs/../api/search?q=caf%C3%A9#results';
console.log(await UrlParts.normalize(url)); // https://Example.com/api/search?q=caf%C3%A9#results
console.log(await UrlParts.host(url), await UrlParts.port(url), await UrlParts.path(url)); // Example.com 443 /api/search
console.log(await UrlParts.query(url)); // q=café
try {
    await UrlParts.host('https://example.com:99999/');
} catch (error) {
    console.log(error.message); // std::runtime_error: Port number was not a decimal number between 0 and 65535
}
```

- The URL API needs no network, so this wrapper works the same way in a browser, where this port does not run curl's own transfers (see [What this build includes](#what-this-build-includes)).
- libcurl lowercases the scheme and removes dot segments, but keeps the host as it was written; host names are case-insensitive.
- When libcurl refuses a URL, the wrapper throws the message from `curl_url_strerror`, which JavaScript catches as shown.

### More examples
Each one runs in your browser on [crossbind.dev/ports/curl](https://crossbind.dev/ports/curl/#usage), next to the code shown there:

- [Build a URL from parts without breaking it](https://crossbind.dev/ports/curl/#02-build-url): `curl_url_set` with `CURLU_APPENDQUERY` and `CURLU_URLENCODE`, and a relative reference resolved the way curl follows a redirect.
- [Percent-encode and decode text](https://crossbind.dev/ports/curl/#03-escape): `curl_easy_escape` and `curl_easy_unescape`, the encoding the curl tool's `--data-urlencode` uses.
- [Read the dates in HTTP headers](https://crossbind.dev/ports/curl/#04-dates): `curl_getdate` on the three date formats HTTP allows.
- [Check what this libcurl was built with](https://crossbind.dev/ports/curl/#05-build-info): `curl_version_info`, with the protocols and features of this build.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/curl/wasm/) · [Android](https://crossbind.dev/ports/curl/android/) · [iOS](https://crossbind.dev/ports/curl/ios/) · [WASI](https://crossbind.dev/ports/curl/wasi/), which also has a command-line program built with `crossbind build -p wasi`.

## What this build includes
- libcurl 8.22.0 with OpenSSL 4.0.2 for TLS (`curl_version()` reports `libcurl/8.22.0 OpenSSL/4.0.2`): a static library for WebAssembly, iOS and WASI, a shared one for Android.
- WebAssembly, Android and iOS: the protocols dict, file, ftp, ftps, gopher, gophers, http, https, imap, imaps, mqtt, mqtts, pop3, pop3s, rtsp, smtp, smtps, telnet, tftp, ws and wss, and the features alt-svc, AsynchDNS, HSTS, HTTPS-proxy, Largefile, SSL, threadsafe and UnixSockets. Android and iOS add libz, for gzip and deflate.
- WASI: HTTP and HTTPS only, with alt-svc, HSTS, HTTPS-proxy, Largefile, SSL and threadsafe. No CA bundle is built in; point `CURLOPT_CAINFO` at one.
- None of the builds has HTTP/2, HTTP/3, brotli, zstd, IDN (host names in other scripts stay in UTF-8), the public suffix list or IPv6.
- **In a browser, libcurl does not run its own transfers.** The WebAssembly package replaces `curl_easy_perform` with a call to the browser's fetch, which waits with `emscripten_sleep`: link with `-sJSPI` (`targetSpecs: [{ platform: 'wasm', specs: { binary: { emccFlags: ['-sJSPI'] } } }]`) and call it from a method whose name ends in `_JSPI`. Otherwise the request is still sent, and then the call fails. CORS applies, TLS is the browser's, and the browser follows redirects whatever `CURLOPT_FOLLOWLOCATION` says. Response headers never reach `CURLOPT_HEADERFUNCTION`, a request body stops at its first NUL byte whatever `CURLOPT_POSTFIELDSIZE` says, a `CURLOPT_CUSTOMREQUEST` method may be nine characters at most, and a request that fails or that CORS blocks returns `CURLE_OK` with response code 0. Node.js builds use the same fetch path through the `xhr2` package, which the app has to install.
- The Android, iOS and WASI packages are built from unpatched curl and run libcurl's own transfers. `@crossbind/port-curl-bin-wasi` ships the curl command built from it: `npx -p @crossbind/port-curl-bin-wasi@beta curl-wasi -sS https://example.com -o page.html` fetches over `wasi:sockets` with certificate verification.
- The module behind the five examples and three apps is 4,410,936 bytes of WebAssembly and 138,977 bytes of JavaScript.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-curl-wasm`](https://www.npmjs.com/package/@crossbind/port-curl-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-curl-android`](https://www.npmjs.com/package/@crossbind/port-curl-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-curl-ios`](https://www.npmjs.com/package/@crossbind/port-curl-ios) | device (`arm64`), simulator (`arm64`) |
| WASI library | [`@crossbind/port-curl-wasi`](https://www.npmjs.com/package/@crossbind/port-curl-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-curl-bin-wasi`](https://www.npmjs.com/package/@crossbind/port-curl-bin-wasi) | the upstream `curl` CLI as a `curl-wasi` command (wasmtime 47+) |

## License
This project includes the precompiled libcurl library, which is distributed under the [curl License](https://github.com/curl/curl/blob/master/COPYING). TLS comes from the `@crossbind/port-openssl` packages, under OpenSSL's Apache-2.0 licence.

curl Homepage: [https://curl.se/](https://curl.se/)
