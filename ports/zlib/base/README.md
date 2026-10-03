# @crossbind/port-zlib
**Precompiled zlib library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-zlib">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-zlib?style=for-the-badge" />
</a>
<a href="https://zlib.net/">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-zlib%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=zlib" />
</a>
<a href="https://zlib.net/zlib_license.html">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-zlib?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/zlib](https://crossbind.dev/ports/zlib/#apps)** run this package in your browser, on the same generated data every time:

- **Seekable gzip.** Gzips a generated 16,000,000-byte log to 3,001,352 B and indexes it in one pass, the technique of zlib's own `examples/zran.c`. Reading line 123,456 then decompresses 864,773 B instead of the 7,901,183 B before it.
- **PNG squeezer.** Filters a PNG's rows again and deflates them at level 9, copying every other chunk as it was. The sample chart goes from 17,191 B to 4,989 B, and both zlib and the browser's own PNG decoder confirm the pixels are unchanged.
- **ZIP inspector.** Reads a ZIP's central directory, inflates one entry with raw deflate and checks every CRC-32, as `unzip -t` does. A .docx, .xlsx, .epub or .jar opens the same way.

Their C++ wrappers, and the self-check the site build runs against values computed independently of this package, are in [`landing/demos/lib-zlib`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-zlib).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-zlib @crossbind/port-zlib-wasm @crossbind/port-zlib-android @crossbind/port-zlib-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import zlibWasm from '@crossbind/port-zlib-wasm/crossbind.config.js';
+import zlibAndroid from '@crossbind/port-zlib-android/crossbind.config.js';
+import zlibIos from '@crossbind/port-zlib-ios/crossbind.config.js';

export default {
    dependencies: [
+        zlibWasm,
+        zlibAndroid,
+        zlibIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon links the build of its platform: `crossbind build -p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-zlib-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one compresses and decompresses in one call. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/zlib_codec.h
#pragma once

#include <zlib.h>

#include <stdexcept>
#include <string>

// One-shot zlib: compress2 and uncompress, in the zlib format (RFC 1950). Bytes cross the binding as
// a byte string: one UTF-16 code unit (0-255) per byte.
class Zlib {
public:
    static std::string version() { return zlibVersion(); }

    static std::u16string compress(const std::string& text, int level) {
        uLongf size = compressBound(static_cast<uLong>(text.size()));
        std::string out(size, '\0');
        const int status = compress2(reinterpret_cast<Bytef*>(&out[0]), &size, reinterpret_cast<const Bytef*>(text.data()), static_cast<uLong>(text.size()), level);
        if (status != Z_OK) throw std::runtime_error(status == Z_STREAM_ERROR ? "level must be between -1 and 9" : zError(status));
        std::u16string bytes(size, u'\0');
        for (uLongf i = 0; i < size; ++i) bytes[i] = static_cast<unsigned char>(out[i]);
        return bytes;
    }

    // The zlib format does not record the original size, so the caller keeps it next to the data.
    static std::string decompress(const std::u16string& bytes, int originalSize) {
        if (originalSize < 0 || originalSize > (256 << 20)) throw std::invalid_argument("originalSize must be between 0 and 256 MiB");
        std::string in(bytes.size(), '\0');
        for (size_t i = 0; i < bytes.size(); ++i) {
            if (bytes[i] > 0xFF) throw std::invalid_argument("not a byte string");
            in[i] = static_cast<char>(bytes[i]);
        }
        std::string out(static_cast<size_t>(originalSize), '\0');
        uLongf size = static_cast<uLongf>(out.size());
        const int status = uncompress(reinterpret_cast<Bytef*>(&out[0]), &size, reinterpret_cast<const Bytef*>(in.data()), static_cast<uLong>(in.size()));
        if (status == Z_BUF_ERROR) throw std::runtime_error("the data is larger than originalSize");
        if (status != Z_OK) throw std::runtime_error(status == Z_DATA_ERROR ? "corrupt or incomplete zlib data" : zError(status));
        out.resize(size);
        return out;
    }
};
```

Then call it from JavaScript:

```js
import { initNative, Zlib } from './native/zlib_codec.h';

await initNative();
const text = 'crossbind '.repeat(100);
const packed = await Zlib.compress(text, 9);
const bytes = Uint8Array.from(packed, (c) => c.charCodeAt(0));
console.log(await Zlib.version(), bytes.length, [...bytes.slice(0, 2)].map((b) => b.toString(16)).join(' ')); // 1.3.2 27 78 da
console.log((await Zlib.decompress(packed, text.length)) === text); // true
```

- Binary data crosses the binding as a string with one UTF-16 code unit (0-255) per byte, which is why `compress` returns `std::u16string`. `Uint8Array.from(packed, (c) => c.charCodeAt(0))` turns it into bytes.
- `compress2` writes the zlib format (RFC 1950): the bytes Python's `zlib.decompress` and the browser's `DecompressionStream('deflate')` read.
- The zlib format does not store the original size, so `decompress` takes it from the caller and refuses anything above 256 MiB. When the size is not known, loop over `inflate()` instead, as the gzip examples below do.
- For files, pass paths instead of bytes: mount the file into the module's filesystem (`autoMountFiles`) and read it in C++ with `fopen`. The three apps above work that way.

### More examples
Each one runs in your browser on [crossbind.dev/ports/zlib](https://crossbind.dev/ports/zlib/#usage), next to the code shown there:

- [Write a .gz that remembers its file name](https://crossbind.dev/ports/zlib/#02-gzip): `deflateInit2` with windowBits 15 + 16 for gzip, `deflateSetHeader` for the name and date, `inflateGetHeader` to read them back.
- [Stream a file through gzip](https://crossbind.dev/ports/zlib/#03-stream): the `deflate()` and `inflate()` loops of zlib's `zpipe.c`, file to file in 64 KB steps, reading every member of a concatenated .gz.
- [Compress small messages with a preset dictionary](https://crossbind.dev/ports/zlib/#04-dictionary): raw deflate with `deflateSetDictionary` and `inflateSetDictionary`; a 59-byte message goes from 59 B to 11 B.
- [Checksum data in pieces](https://crossbind.dev/ports/zlib/#05-checksum): `crc32` and `adler32` as running values, and `crc32_combine` and `adler32_combine` to join pieces checksummed separately.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/zlib/wasm/) · [Android](https://crossbind.dev/ports/zlib/android/) · [iOS](https://crossbind.dev/ports/zlib/ios/) · [macOS](https://crossbind.dev/ports/zlib/darwin/) · [Linux](https://crossbind.dev/ports/zlib/linux/) · [Windows](https://crossbind.dev/ports/zlib/win32/) · [WASI](https://crossbind.dev/ports/zlib/wasi/), which also has a gzip command-line program built with `crossbind build -p wasi`.

## What this build includes
- zlib 1.3.2 from the release tarball, pinned by SHA-256, built with zlib's own CMake options at their defaults apart from `ZLIB_BUILD_TESTING=OFF` and the library type: static on every platform. On Android the archive is position-independent and goes into the libraries that use it, because the app process already holds the system's own `libz.so`, which would shadow a shared build. Its symbols are hidden there, so every library that links it keeps its copy private and calls its own.
- The stock `zlib.h` and `zconf.h`, unchanged. The examples and apps here use `deflateSetHeader`, `inflateGetHeader`, `deflateSetDictionary`, `inflatePrime`, `crc32_combine` and, in the WASI program, the `gz*` file functions.
- No `contrib/minizip` (`ZLIB_BUILD_MINIZIP` is off by default) and none of the programs in zlib's `examples/`, such as `zran.c`. The ZIP inspector and the seekable gzip app bring their own code for those jobs.
- Every compressed byte the examples and apps above produce is identical to what stock zlib 1.3.2, built natively from the same tarball, produces, except the operating-system byte in a gzip header: zlib writes 3 (Unix) in the WebAssembly and WASI builds, and its `zutil.h` writes 19 wherever `__APPLE__` is defined, which includes iOS. Set the byte with `deflateSetHeader` when files must match across platforms.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-zlib-wasm`](https://www.npmjs.com/package/@crossbind/port-zlib-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-zlib-android`](https://www.npmjs.com/package/@crossbind/port-zlib-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-zlib-ios`](https://www.npmjs.com/package/@crossbind/port-zlib-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-zlib-darwin`](https://www.npmjs.com/package/@crossbind/port-zlib-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-zlib-linux`](https://www.npmjs.com/package/@crossbind/port-zlib-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Windows | [`@crossbind/port-zlib-win32`](https://www.npmjs.com/package/@crossbind/port-zlib-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-zlib-wasi`](https://www.npmjs.com/package/@crossbind/port-zlib-wasi) | `wasm32-wasip3` — single-threaded |

## License
This project includes the precompiled zlib library, which is distributed under the [zlib License](https://zlib.net/zlib_license.html).

zlib Homepage: [https://zlib.net/](https://zlib.net/)
