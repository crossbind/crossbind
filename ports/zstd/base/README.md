# @crossbind/port-zstd
**Precompiled Zstandard (zstd) library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-zstd">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-zstd?style=for-the-badge" />
</a>
<a href="https://github.com/facebook/zstd">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-zstd%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=ZSTD" />
</a>
<a href="https://github.com/facebook/zstd/blob/dev/LICENSE">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-zstd?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/zstd](https://crossbind.dev/ports/zstd/#apps)** run this package in your browser, on the same generated data every time:

- **Dictionary trainer.** Trains a 4 KB dictionary on 1,000 JSON records in the tab. The next 1,000 records, compressed one by one, shrink 7.55× with it against 1.82× without.
- **Ship only the diff.** A 1,081,692-byte dataset update, compressed with the previous version as its dictionary, becomes a 1,022-byte [RFC 9842](https://www.rfc-editor.org/rfc/rfc9842.html) `dcz` stream.
- **.tar.zst opener.** Streams a `.tar.zst` in 128 KB steps and lists what is inside without unpacking it.

Their C++ wrappers, and the self-check the site build runs against numbers computed independently of this package, are in [`landing/demos/lib-zstd`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-zstd).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-zstd @crossbind/port-zstd-wasm @crossbind/port-zstd-android @crossbind/port-zstd-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import zstdWasm from '@crossbind/port-zstd-wasm/crossbind.config.js';
+import zstdAndroid from '@crossbind/port-zstd-android/crossbind.config.js';
+import zstdIos from '@crossbind/port-zstd-ios/crossbind.config.js';

export default {
    dependencies: [
+        zstdWasm,
+        zstdAndroid,
+        zstdIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon links the build of its platform: `crossbind build -p darwin`, `-p linux` or `-p win32` takes `@crossbind/port-zstd-darwin`, `-linux` or `-win32`. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one compresses and decompresses in one call. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/zstd_codec.h
#pragma once

#include <zstd.h>

#include <stdexcept>
#include <string>

// One-shot Zstandard. Bytes cross the binding as a byte string: one UTF-16 code unit (0-255) per byte.
class Zstd {
public:
    static std::string version() { return ZSTD_versionString(); }

    static std::u16string compress(const std::string& text, int level) {
        std::string out(ZSTD_compressBound(text.size()), '\0');
        const size_t size = ZSTD_compress(&out[0], out.size(), text.data(), text.size(), level);
        if (ZSTD_isError(size)) throw std::runtime_error(ZSTD_getErrorName(size));
        std::u16string bytes(size, u'\0');
        for (size_t i = 0; i < size; ++i) bytes[i] = static_cast<unsigned char>(out[i]);
        return bytes;
    }

    static std::string decompress(const std::u16string& bytes) {
        std::string in(bytes.size(), '\0');
        for (size_t i = 0; i < bytes.size(); ++i) {
            if (bytes[i] > 0xFF) throw std::invalid_argument("not a byte string");
            in[i] = static_cast<char>(bytes[i]);
        }
        const unsigned long long size = ZSTD_getFrameContentSize(in.data(), in.size());
        if (size == ZSTD_CONTENTSIZE_ERROR) throw std::runtime_error("not a zstd frame");
        if (size == ZSTD_CONTENTSIZE_UNKNOWN) throw std::runtime_error("size not stored in the frame; use streaming");
        if (size > (256u << 20)) throw std::runtime_error("refusing to allocate more than 256 MiB");
        std::string out(static_cast<size_t>(size), '\0');
        const size_t got = ZSTD_decompress(&out[0], out.size(), in.data(), in.size());
        if (ZSTD_isError(got)) throw std::runtime_error(ZSTD_getErrorName(got));
        out.resize(got);
        return out;
    }
};
```

Then call it from JavaScript:

```js
import { initNative, Zstd } from './native/zstd_codec.h';

await initNative();
const text = 'crossbind '.repeat(100);
const frame = await Zstd.compress(text, 19);
const bytes = Uint8Array.from(frame, (c) => c.charCodeAt(0));
console.log(await Zstd.version(), bytes.length, [...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' ')); // 1.5.7 27 28 b5 2f fd
console.log((await Zstd.decompress(frame)) === text); // true
```

- Binary data crosses the binding as a string with one UTF-16 code unit (0-255) per byte, which is why `compress` returns `std::u16string`. `Uint8Array.from(frame, (c) => c.charCodeAt(0))` turns it into bytes.
- `decompress` reads the size from the frame and refuses anything above 256 MiB, which guards against decompression bombs. Frames written without a content size need the streaming API (`ZSTD_decompressStream`).
- For files, pass paths instead of bytes: mount the file into the module's filesystem (`autoMountFiles`) and read it in C++ with `fopen`. The `.tar.zst` opener above works that way.

### More examples
Each one runs in your browser on [crossbind.dev/ports/zstd](https://crossbind.dev/ports/zstd/#usage), next to the code shown there:

- [Stream a file through zstd](https://crossbind.dev/ports/zstd/#02-stream): `ZSTD_compressStream2` and `ZSTD_decompressStream`, file to file in 128 KB steps.
- [Choose a level, a checksum and a window](https://crossbind.dev/ports/zstd/#03-parameters): `ZSTD_CCtx_setParameter`, read back with `ZSTD_getFrameHeader`.
- [Compress small messages with a dictionary](https://crossbind.dev/ports/zstd/#04-dictionary): train with `ZDICT_trainFromBuffer`, then compress against `ZSTD_createCDict` and `ZSTD_createDDict`.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/zstd/wasm/) · [Android](https://crossbind.dev/ports/zstd/android/) · [iOS](https://crossbind.dev/ports/zstd/ios/) · [macOS](https://crossbind.dev/ports/zstd/darwin/) · [Linux](https://crossbind.dev/ports/zstd/linux/) · [Windows](https://crossbind.dev/ports/zstd/win32/) · [WASI](https://crossbind.dev/ports/zstd/wasi/), which also has a command-line program built with `crossbind build -p wasi`.

## What this build includes
- zstd 1.5.7 as a static library, with the dictionary builder (`ZDICT_*`) compiled in.
- No multithreaded compression: setting `ZSTD_c_nbWorkers` above 0 returns `Unsupported parameter`.
- No legacy formats: frames written by zstd before v0.8 are rejected.
- On `wasm32` the largest window is 1 GiB (`windowLog` 30), which covers `zstd --long=30` frames.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-zstd-wasm`](https://www.npmjs.com/package/@crossbind/port-zstd-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-zstd-android`](https://www.npmjs.com/package/@crossbind/port-zstd-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-zstd-ios`](https://www.npmjs.com/package/@crossbind/port-zstd-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-zstd-darwin`](https://www.npmjs.com/package/@crossbind/port-zstd-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-zstd-linux`](https://www.npmjs.com/package/@crossbind/port-zstd-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Windows | [`@crossbind/port-zstd-win32`](https://www.npmjs.com/package/@crossbind/port-zstd-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-zstd-wasi`](https://www.npmjs.com/package/@crossbind/port-zstd-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-zstd-bin-wasi`](https://www.npmjs.com/package/@crossbind/port-zstd-bin-wasi) | the upstream `zstd` CLI as a `zstd-wasi` command (wasmtime 47+) |

## License
This project includes the precompiled zstd library, which is distributed under the [zstd License](https://github.com/facebook/zstd/blob/dev/LICENSE).

zstd Homepage: [https://facebook.github.io/zstd/](https://facebook.github.io/zstd/)
