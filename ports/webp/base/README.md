# @crossbind/port-webp
**Precompiled WebP image library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-webp">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-webp/beta?style=for-the-badge" />
</a>
<a href="https://chromium.googlesource.com/webm/libwebp">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.npmjs.org%2F%40crossbind%2Fport-webp%2Fbeta&query=%24.nativeVersion&style=for-the-badge&label=WebP" />
</a>
<a href="https://chromium.googlesource.com/webm/libwebp/+/refs/heads/main/COPYING">
    <img alt="License" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.npmjs.org%2F%40crossbind%2Fport-webp%2Fbeta&query=%24.license&style=for-the-badge&label=license" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/webp](https://crossbind.dev/ports/webp/#apps)** run this package in your browser, on the same generated images every time:

- **WebP Studio.** Encodes a generated 512×384 test card, or your own image, and puts the result next to the original with its size, PSNR and SSIM. The test card is 14,852 B lossy at quality 75 and 114,478 B lossless with every pixel unchanged; a quality sweep runs from 3,980 B at quality 0 to 54,280 B at quality 100. The same wasm runs in Safari's engine, WebKit, which cannot encode WebP from a canvas.
- **Sticker maker.** Crops a picture's transparent border, fits it into 512×512 with an 8 px white outline and finds the highest quality under a byte budget: the sample smiley is 33,610 B at quality 100, and 11,952 B at quality 12 under a 12,000 B budget.
- **Streaming decode.** Feeds a WebP to libwebp's incremental decoder a byte range at a time: of the test card's 14,852 B, the first rows appear at 2,121 B, and half the file shows 135 of its 384 rows.

Their C++ wrappers, and the self-check the site build runs against numbers computed independently of this package, are in [`landing/demos/lib-webp`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-webp).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-webp@beta @crossbind/port-webp-wasm@beta @crossbind/port-webp-android@beta @crossbind/port-webp-ios@beta
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import webpWasm from '@crossbind/port-webp-wasm/crossbind.config.js';
+import webpAndroid from '@crossbind/port-webp-android/crossbind.config.js';
+import webpIos from '@crossbind/port-webp-ios/crossbind.config.js';

export default {
    dependencies: [
+        webpWasm,
+        webpAndroid,
+        webpIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon (`crossbind build -e node`) links the build of its platform: `-p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-webp-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one exposes libwebp's simple API: encode RGBA pixels at a quality or losslessly, read the size from a file's header, and decode it back. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/webp_codec.h
#pragma once

#include <webp/decode.h>
#include <webp/encode.h>

#include <cstdint>
#include <stdexcept>
#include <string>

// libwebp's simple API. Bytes cross the binding as a byte string: one UTF-16 code unit (0-255) per byte.
class WebpCodec {
public:
    // WebPGetEncoderVersion() packs the version into one integer, 0xMMmmpp.
    static std::string version() {
        const int packed = WebPGetEncoderVersion();
        return std::to_string(packed >> 16) + "." + std::to_string((packed >> 8) & 0xff) + "." + std::to_string(packed & 0xff);
    }

    // `rgba` is 4 bytes per pixel, row after row. Quality runs from 0 (smallest file) to 100 (best).
    static std::u16string encode(const std::u16string& rgba, int width, int height, float quality) {
        const std::string pixels = checkedPixels(rgba, width, height);
        uint8_t* output = nullptr;
        const size_t size = WebPEncodeRGBA(reinterpret_cast<const uint8_t*>(pixels.data()), width, height, width * 4, quality, &output);
        return take(output, size);
    }

    static std::u16string encodeLossless(const std::u16string& rgba, int width, int height) {
        const std::string pixels = checkedPixels(rgba, width, height);
        uint8_t* output = nullptr;
        const size_t size = WebPEncodeLosslessRGBA(reinterpret_cast<const uint8_t*>(pixels.data()), width, height, width * 4, &output);
        return take(output, size);
    }

    // "<width>x<height>", read from the file header without decoding the image.
    static std::string dimensions(const std::u16string& webp) {
        const std::string data = fromUnits(webp);
        int width = 0;
        int height = 0;
        if (!WebPGetInfo(reinterpret_cast<const uint8_t*>(data.data()), data.size(), &width, &height)) throw std::runtime_error("not a WebP image");
        return std::to_string(width) + "x" + std::to_string(height);
    }

    static std::u16string decode(const std::u16string& webp) {
        const std::string data = fromUnits(webp);
        int width = 0;
        int height = 0;
        uint8_t* rgba = WebPDecodeRGBA(reinterpret_cast<const uint8_t*>(data.data()), data.size(), &width, &height);
        if (!rgba) throw std::runtime_error("not a decodable WebP image");
        return take(rgba, static_cast<size_t>(width) * height * 4);
    }

private:
    static std::string checkedPixels(const std::u16string& rgba, int width, int height) {
        if (width <= 0 || height <= 0 || rgba.size() != static_cast<size_t>(width) * height * 4) {
            throw std::invalid_argument("expected width * height * 4 bytes of RGBA");
        }
        return fromUnits(rgba);
    }

    // Copies memory libwebp allocated into a byte string, then releases it with WebPFree.
    static std::u16string take(uint8_t* data, size_t size) {
        if (!data || size == 0) {
            WebPFree(data);
            throw std::runtime_error("WebP encoding failed");
        }
        std::u16string units(data, data + size);
        WebPFree(data);
        return units;
    }

    static std::string fromUnits(const std::u16string& units) {
        std::string data(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            data[i] = static_cast<char>(units[i]);
        }
        return data;
    }
};
```

Then call it from JavaScript:

```js
import { initNative, WebpCodec } from './native/webp_codec.h';

await initNative();
let seed = 1;
const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
let rgba = '';
for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
        const sun = (x - 180) ** 2 + (y - 70) ** 2 < 900;
        const hill = y > 170 + (((x - 128) ** 2) >> 8);
        const [r, g, b] = sun ? [255, 214, 90] : hill ? [40 + (y >> 2), 120 + (x >> 3), 50] : [90 + (y >> 1), 150 + (y >> 2), 235];
        rgba += String.fromCharCode(r ^ random(8), g ^ random(8), b ^ random(8), 255);
    }
}

const lossy = await WebpCodec.encode(rgba, 256, 256, 80);
const lossless = await WebpCodec.encodeLossless(rgba, 256, 256);
console.log(await WebpCodec.version(), await WebpCodec.dimensions(lossy)); // 1.6.0 256x256
console.log(`RGBA ${rgba.length} B -> lossy q80 ${lossy.length} B, lossless ${lossless.length} B`); // RGBA 262144 B -> lossy q80 1966 B, lossless 87058 B
console.log((await WebpCodec.decode(lossless)) === rgba); // true
```

- Pixels and files cross the binding as a string with one UTF-16 code unit (0-255) per byte, which is why the wrapper takes and returns `std::u16string`. `Uint8Array.from(lossy, (c) => c.charCodeAt(0))` turns the result into bytes, and `new Blob([bytes], { type: 'image/webp' })` into something an `<img>` or a download link can use.
- `WebPEncodeRGBA` and `WebPEncodeLosslessRGBA` use libwebp's default settings: the lossy file above is byte for byte what `cwebp -q 80` writes from the same pixels. For presets, effort, sharp YUV, a target size or quality metrics, set up a `WebPConfig` and call `WebPEncode`, as the first of the examples below does.
- For large images, pass paths instead of bytes: write the pixels with `m.FS.writeFile`, read and write the files in C++, and read the result back with `m.getFileBytes`. The apps above work that way.

### More examples
Each one runs in your browser on [crossbind.dev/ports/webp](https://crossbind.dev/ports/webp/#usage), next to the code shown there:

- [Tune the encoder and measure what it gave away](https://crossbind.dev/ports/webp/#02-tune): `WebPConfigPreset`, method, sharp YUV and a target size, measured with `WebPPlaneDistortion`.
- [Keep transparency, and decide what happens under it](https://crossbind.dev/ports/webp/#03-transparency): `alpha_quality` for lossy files and `exact` for lossless ones.
- [Inspect a WebP, then decode only what you need](https://crossbind.dev/ports/webp/#04-read): `WebPGetFeatures`, and `WebPDecode` scaling to a thumbnail or cropping a region.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/webp/wasm/) · [Android](https://crossbind.dev/ports/webp/android/) · [iOS](https://crossbind.dev/ports/webp/ios/) · [macOS](https://crossbind.dev/ports/webp/darwin/) · [Linux](https://crossbind.dev/ports/webp/linux/) · [Windows](https://crossbind.dev/ports/webp/win32/) · [WASI](https://crossbind.dev/ports/webp/wasi/), which also has a command-line program built with `crossbind build -p wasi -e wasi`.

## What this build includes
- libwebp 1.6.0: static libraries for WebAssembly, iOS, macOS, Linux, Windows and WASI, shared libraries for Android.
- Linked into your code: `libwebp`, the whole encoder and decoder (the simple and advanced APIs, incremental decoding, `WebPPictureRescale` and `WebPPictureCrop`, `WebPPictureDistortion` and `WebPPlaneDistortion`), and `libsharpyuv` for sharp YUV conversion.
- `libwebpmux` and `libwebpdemux` (`mux.h`, `demux.h`), linked as well: animation (`WebPAnimEncoder*`, `WebPAnimDecoder*`) and ICC, EXIF and XMP chunks (`WebPMux*`, `WebPDemux*`).
- On WebAssembly, every file the demo checks is byte for byte what the native `cwebp` 1.6.0 writes from the same pixels and settings.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-webp-wasm`](https://www.npmjs.com/package/@crossbind/port-webp-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-webp-android`](https://www.npmjs.com/package/@crossbind/port-webp-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-webp-ios`](https://www.npmjs.com/package/@crossbind/port-webp-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-webp-darwin`](https://www.npmjs.com/package/@crossbind/port-webp-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-webp-linux`](https://www.npmjs.com/package/@crossbind/port-webp-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Linux (musl) | [`@crossbind/port-webp-linuxmusl`](https://www.npmjs.com/package/@crossbind/port-webp-linuxmusl) | `x64`, `arm64` — musl 1.2.5 or later (Alpine 3.21 and later), native Node.js addons |
| Windows | [`@crossbind/port-webp-win32`](https://www.npmjs.com/package/@crossbind/port-webp-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-webp-wasi`](https://www.npmjs.com/package/@crossbind/port-webp-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-webp-standalone-wasi`](https://www.npmjs.com/package/@crossbind/port-webp-standalone-wasi) | the upstream `cwebp`, `dwebp` and `webpinfo` as `cwebp-wasi`, `dwebp-wasi` and `webpinfo-wasi` commands (wasmtime 47+) |
| Node.js, ready-made | [`@crossbind/port-webp-standalone-napi`](https://www.npmjs.com/package/@crossbind/port-webp-standalone-napi) | prebuilt addons for macOS, Linux (glibc and musl) and Windows, `arm64` and `x64`: nothing to build |

## License
This project includes the precompiled WebP library, which is distributed under the [BSD 3-Clause License](https://chromium.googlesource.com/webm/libwebp/+/refs/heads/main/COPYING).

WebP Homepage: [https://developers.google.com/speed/webp](https://developers.google.com/speed/webp)
