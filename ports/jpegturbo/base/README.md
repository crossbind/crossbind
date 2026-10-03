# @crossbind/port-jpegturbo
**Precompiled libjpeg-turbo (JPEG) library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-jpegturbo">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-jpegturbo?style=for-the-badge" />
</a>
<a href="https://github.com/libjpeg-turbo/libjpeg-turbo">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-jpegturbo%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=LIBJPEG-TURBO" />
</a>
<a href="https://github.com/libjpeg-turbo/libjpeg-turbo/blob/3.2.0/LICENSE.md">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-jpegturbo?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/jpegturbo](https://crossbind.dev/ports/jpegturbo/#apps)** run this package in your browser, on the same generated pictures every time:

- **Privacy check.** Shows what a photo's metadata reveals, such as its GPS position, the camera's serial number and a preview image stored in its EXIF block, then writes a copy without it. The image is copied coefficient by coefficient, not re-encoded: the sample goes from 123,613 B to 106,361 B, and 0 of its 2,880,000 decoded samples change.
- **Encoder lab.** Quality, chroma subsampling, progressive scans, optimised Huffman tables and arithmetic coding on one 960×640 picture, with the bytes and PSNR of each next to what the browser's own `canvas.toBlob` makes. At quality 75 with the standard Huffman tables, the sample is 59,481 B at 31.40 dB with 4:2:0 subsampling and 74,930 B at 36.06 dB with 4:4:4.
- **Instant thumbnails.** Decodes a 4032×3024 photo at 1/1, 1/2, 1/4 and 1/8 of its size with DCT scaling and times each decode in the tab. The 1/8 decode fills 762,048 B of pixels instead of 48,771,072 B.

Their C++ wrappers, and the self-check the site build runs against files that native libjpeg-turbo 3.2.0 (`cjpeg`, `djpeg`, `jpegtran`) produced from the same pixels, are in [`landing/demos/lib-jpegturbo`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-jpegturbo).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-jpegturbo @crossbind/port-jpegturbo-wasm @crossbind/port-jpegturbo-android @crossbind/port-jpegturbo-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import jpegturboWasm from '@crossbind/port-jpegturbo-wasm/crossbind.config.js';
+import jpegturboAndroid from '@crossbind/port-jpegturbo-android/crossbind.config.js';
+import jpegturboIos from '@crossbind/port-jpegturbo-ios/crossbind.config.js';

export default {
    dependencies: [
+        jpegturboWasm,
+        jpegturboAndroid,
+        jpegturboIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon links the build of its platform: `crossbind build -p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-jpegturbo-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one encodes RGBA pixels to a JPEG in memory with a chosen quality and chroma subsampling. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/jpeg_encoder.h
#pragma once

#include <cstdio>
#include <cstdlib>
#include <jpeglib.h>

#include <stdexcept>
#include <string>

// Pixels in, a JPEG file out, both in memory. Bytes cross the binding as a byte string: one UTF-16
// code unit (0-255) per byte.
class JpegEncoder {
public:
    static std::string version() {
        const int number = LIBJPEG_TURBO_VERSION_NUMBER;
        return std::to_string(number / 1000000) + "." + std::to_string(number / 1000 % 1000) + "." + std::to_string(number % 1000);
    }

    // rgba holds width * height * 4 bytes. subsampling is 444, 422 or 420: the chroma resolution
    // kept for each 2x2 block of pixels (all of it, half, a quarter).
    static std::u16string encode(const std::u16string& rgba, int width, int height, int quality, int subsampling) {
        if (width < 1 || height < 1 || rgba.size() != static_cast<size_t>(width) * height * 4) throw std::invalid_argument("rgba must hold width * height * 4 bytes");
        if (quality < 1 || quality > 100) throw std::invalid_argument("quality must be between 1 and 100");
        if (subsampling != 444 && subsampling != 422 && subsampling != 420) throw std::invalid_argument("subsampling must be 444, 422 or 420");
        std::string pixels(rgba.size(), '\0');
        for (size_t i = 0; i < rgba.size(); ++i) {
            if (rgba[i] > 0xFF) throw std::invalid_argument("not a byte string");
            pixels[i] = static_cast<char>(rgba[i]);
        }

        Compressor jpeg;
        unsigned char* buffer = nullptr;
        unsigned long size = 0;
        jpeg_mem_dest(&jpeg.cinfo, &buffer, &size);
        jpeg.cinfo.image_width = static_cast<JDIMENSION>(width);
        jpeg.cinfo.image_height = static_cast<JDIMENSION>(height);
        jpeg.cinfo.input_components = 4;
        jpeg.cinfo.in_color_space = JCS_EXT_RGBA;
        jpeg_set_defaults(&jpeg.cinfo);
        jpeg_set_quality(&jpeg.cinfo, quality, TRUE);
        jpeg.cinfo.comp_info[0].h_samp_factor = subsampling == 444 ? 1 : 2;
        jpeg.cinfo.comp_info[0].v_samp_factor = subsampling == 420 ? 2 : 1;
        jpeg_start_compress(&jpeg.cinfo, TRUE);
        while (jpeg.cinfo.next_scanline < jpeg.cinfo.image_height) {
            JSAMPROW row = reinterpret_cast<JSAMPROW>(&pixels[static_cast<size_t>(jpeg.cinfo.next_scanline) * width * 4]);
            jpeg_write_scanlines(&jpeg.cinfo, &row, 1);
        }
        // jpeg_mem_dest reallocates as the file grows and hands the final buffer over only here.
        jpeg_finish_compress(&jpeg.cinfo);
        std::u16string file(buffer, buffer + size);
        std::free(buffer);
        return file;
    }

private:
    // libjpeg's default error handler ends the process; this one throws libjpeg's message instead.
    [[noreturn]] static void throwError(j_common_ptr cinfo) {
        char message[JMSG_LENGTH_MAX];
        (*cinfo->err->format_message)(cinfo, message);
        throw std::runtime_error(message);
    }

    struct Compressor {
        jpeg_compress_struct cinfo;
        jpeg_error_mgr jerr;
        Compressor() {
            cinfo.err = jpeg_std_error(&jerr);
            jerr.error_exit = throwError;
            jpeg_create_compress(&cinfo);
        }
        ~Compressor() { jpeg_destroy_compress(&cinfo); }
        Compressor(const Compressor&) = delete;
        Compressor& operator=(const Compressor&) = delete;
    };
};
```

Then call it from JavaScript:

```js
import { initNative, JpegEncoder } from './native/jpeg_encoder.h';

await initNative();
const [width, height] = [100, 75];
const rgba = new Uint8Array(width * height * 4);
for (let i = 0; i < width * height; i += 1) {
    const [x, y] = [i % width, Math.floor(i / width)];
    const disc = (x - 50) ** 2 + (y - 37) ** 2 < 400;
    rgba.set(disc ? [230, 30, 40, 255] : [x * 2, y * 3, 160, 255], i * 4);
}
const pixels = String.fromCharCode(...rgba);
console.log(`libjpeg-turbo ${await JpegEncoder.version()}: ${width}x${height}, ${rgba.length} B of RGBA`); // libjpeg-turbo 3.2.0: 100x75, 30000 B of RGBA
for (const [quality, subsampling] of [[90, 444], [90, 420], [50, 420]]) {
    const jpeg = await JpegEncoder.encode(pixels, width, height, quality, subsampling);
    console.log(`quality ${quality}, subsampling ${subsampling}: ${jpeg.length} B`);
}
// quality 90, subsampling 444: 2791 B
// quality 90, subsampling 420: 1932 B
// quality 50, subsampling 420: 1171 B
```

- Binary data crosses the binding as a string with one UTF-16 code unit (0-255) per byte, which is why `encode` takes and returns `std::u16string`. `Uint8Array.from(jpeg, (c) => c.charCodeAt(0))` turns the result into bytes, ready for a `Blob` or a file.
- libjpeg's default error handler ends the process. The wrapper installs one that throws libjpeg's own message instead, so a bad input rejects the call with, for example, `Not a JPEG file: starts with 0x63 0x72`, and the module keeps working.
- `jpeg_mem_dest` reallocates its buffer as the file grows and hands the final one back only in `jpeg_finish_compress`: read the buffer and its size after that call, then `free()` it.
- For files, pass paths instead of bytes: mount the file into the module's filesystem (`autoMountFiles`) and read it in C++ with `fopen`. The apps above work that way.

### More examples
Each one runs in your browser on [crossbind.dev/ports/jpegturbo](https://crossbind.dev/ports/jpegturbo/#usage), next to the code shown there:

- [Decode a JPEG and read its header](https://crossbind.dev/ports/jpegturbo/#02-decode): `jpeg_mem_src`, `jpeg_read_header` and `jpeg_read_scanlines` to RGBA, and the error a file that is not a JPEG raises.
- [Decode straight to a thumbnail](https://crossbind.dev/ports/jpegturbo/#03-thumbnail): `scale_num` and `scale_denom`, with `jpeg_calc_output_dimensions` for the size before decoding.
- [Make a JPEG smaller without re-encoding it](https://crossbind.dev/ports/jpegturbo/#04-transcode): `jpeg_read_coefficients` and `jpeg_write_coefficients` with optimised or progressive Huffman coding, byte for byte what `jpegtran -copy all` writes.
- [Read and write EXIF and comments](https://crossbind.dev/ports/jpegturbo/#05-markers): `jpeg_save_markers` and `jpeg_write_marker`.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/jpegturbo/wasm/) · [Android](https://crossbind.dev/ports/jpegturbo/android/) · [iOS](https://crossbind.dev/ports/jpegturbo/ios/) · [macOS](https://crossbind.dev/ports/jpegturbo/darwin/) · [Linux](https://crossbind.dev/ports/jpegturbo/linux/) · [Windows](https://crossbind.dev/ports/jpegturbo/win32/) · [WASI](https://crossbind.dev/ports/jpegturbo/wasi/), which also has a command-line program built with `crossbind build -p wasi`.

## What this build includes
- libjpeg-turbo 3.2.0's libjpeg API (`jpeglib.h`): a static `libjpeg.a` for WebAssembly, WASI and iOS, and a shared `libjpeg.so` for Android.
- Baseline, progressive and arithmetic coding in both directions, in-memory I/O (`jpeg_mem_src`, `jpeg_mem_dest`), decoding straight to a reduced size (`scale_num`, `scale_denom`), the coefficient API for lossless transcoding and marker handling (`jpeg_save_markers`, `jpeg_write_marker`). The examples and apps above use each of these, and their output matches native libjpeg-turbo 3.2.0 byte for byte.
- The 12-bit and lossless entry points (`jpeg12_*`, `jpeg16_*`, `jpeg_enable_lossless`) and the ICC profile helpers (`jpeg_read_icc_profile`, `jpeg_write_icc_profile`) are exported too; nothing here exercises them yet.
- No TurboJPEG API: the recipe builds with `WITH_TURBOJPEG=OFF`, so there is no `turbojpeg.h` and no `tj3*` function.
- No lossless transforms: `transupp` (`jtransform_*`: `jpegtran`'s rotate, flip and crop) is not part of `libjpeg.a`. For those, `@crossbind/port-jpegturbo-bin-wasi` runs the upstream `jpegtran` as a WASI command.
- SIMD is compiled into the iOS, Android, Linux, Windows and Apple silicon macOS builds (`WITH_SIMD` in their `jconfig.h`) but not into the WebAssembly and WASI builds, which run libjpeg-turbo's portable C code, nor into the Intel macOS build: it is built with Apple's tools alone, which have no assembler for libjpeg-turbo's x86 SIMD code.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-jpegturbo-wasm`](https://www.npmjs.com/package/@crossbind/port-jpegturbo-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-jpegturbo-android`](https://www.npmjs.com/package/@crossbind/port-jpegturbo-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-jpegturbo-ios`](https://www.npmjs.com/package/@crossbind/port-jpegturbo-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-jpegturbo-darwin`](https://www.npmjs.com/package/@crossbind/port-jpegturbo-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-jpegturbo-linux`](https://www.npmjs.com/package/@crossbind/port-jpegturbo-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Windows | [`@crossbind/port-jpegturbo-win32`](https://www.npmjs.com/package/@crossbind/port-jpegturbo-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-jpegturbo-wasi`](https://www.npmjs.com/package/@crossbind/port-jpegturbo-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-jpegturbo-bin-wasi`](https://www.npmjs.com/package/@crossbind/port-jpegturbo-bin-wasi) | the upstream `cjpeg`, `djpeg` and `jpegtran` as `cjpeg-wasi`, `djpeg-wasi` and `jpegtran-wasi` commands (wasmtime 47+) |

## License
This project includes the precompiled libjpeg-turbo library, which is distributed under the [libjpeg-turbo licenses](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/3.2.0/LICENSE.md) (IJG AND BSD-3-Clause AND Zlib): the [IJG License](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/3.2.0/README.ijg) for the libjpeg API library, the [Modified (3-clause) BSD License](https://spdx.org/licenses/BSD-3-Clause.html) for its build system, and the [zlib License](https://spdx.org/licenses/Zlib.html) for the SIMD code in the iOS and Android builds.

libjpeg-turbo Homepage: [https://libjpeg-turbo.org](https://libjpeg-turbo.org)
