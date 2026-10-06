# @crossbind/port-tiff
**Precompiled TIFF (libtiff) image library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-tiff">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-tiff?style=for-the-badge" />
</a>
<a href="https://gitlab.com/libtiff/libtiff">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-tiff%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=TIFF" />
</a>
<a href="https://libtiff.gitlab.io/libtiff/project/license.html">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-tiff?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/tiff](https://crossbind.dev/ports/tiff/#apps)** run this package in your browser, on the same generated files every time:

- **TIFF viewer.** Opens TIFFs in any browser, every page with its tags, and stretches 16-bit and float pages to their own range. Its sample is a four-page, 1,317,918-byte file written in the tab: a CCITT Group 4 letter, a JPEG photo, 12-bit cells in ZSTD tiles and a float elevation model with a no-data value.
- **Page photos to one archival TIFF.** Two A4 page photos, turned black and white with Otsu's threshold and stored as CCITT Group 4, take 19,640 bytes in one multi-page file.
- **Codec comparison.** A 512 × 512 float elevation model written with every codec in the build and read back: ZSTD with the floating-point predictor keeps every sample in 3.8× less space than raw, and LERC within 0.1 m takes 4.0× less.

Their C++ wrappers, and the self-check the site build runs against numbers verified independently of this package, are in [`landing/demos/lib-tiff`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-tiff).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-tiff@beta @crossbind/port-tiff-wasm@beta @crossbind/port-tiff-android@beta @crossbind/port-tiff-ios@beta
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import tiffWasm from '@crossbind/port-tiff-wasm/crossbind.config.js';
+import tiffAndroid from '@crossbind/port-tiff-android/crossbind.config.js';
+import tiffIos from '@crossbind/port-tiff-ios/crossbind.config.js';

export default {
    dependencies: [
+        tiffWasm,
+        tiffAndroid,
+        tiffIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon links the build of its platform: `crossbind build -p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-tiff-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one writes pixels as a TIFF and reads them back, in memory. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/tiff_codec.h
#pragma once

#include <tiffio.h>
#include <tiffio.hxx>

#include <cstdint>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Canvas pixels to a TIFF and back, in memory: TIFFStreamOpen gives libtiff a std::ostream or
// std::istream instead of a file. Bytes cross the binding as std::u16string, one code unit (0-255)
// per byte.
class Tiff {
public:
    static std::string version() { return TIFFLIB_VERSION_STR_MAJ_MIN_MIC; }

    // RGBA pixels, as ImageData holds them, to an 8-bit RGB TIFF (alpha is not stored). `compression`
    // is a COMPRESSION_* code from tiff.h: 1 none, 5 LZW, 8 Deflate, 32773 PackBits, 50000 ZSTD.
    static std::u16string encode(const std::u16string& rgba, int width, int height, int compression) {
        if (width <= 0 || height <= 0 || rgba.size() != static_cast<size_t>(width) * height * 4) throw std::invalid_argument("rgba must hold width x height x 4 bytes");
        if (!TIFFIsCODECConfigured(static_cast<uint16_t>(compression))) throw std::invalid_argument("compression " + std::to_string(compression) + " is not in this build");
        std::vector<unsigned char> rgb(static_cast<size_t>(width) * height * 3);
        for (size_t pixel = 0; pixel < rgb.size() / 3; ++pixel) {
            for (size_t channel = 0; channel < 3; ++channel) {
                const char16_t unit = rgba[pixel * 4 + channel];
                if (unit > 0xFF) throw std::invalid_argument("not a byte string: a code unit is above 255");
                rgb[pixel * 3 + channel] = static_cast<unsigned char>(unit);
            }
        }
        std::ostringstream out;
        TIFF* tif = TIFFStreamOpen("memory", &out);
        if (!tif) throw std::runtime_error("libtiff could not open a stream for writing");
        TIFFSetField(tif, TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif, TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 3);
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 8);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_RGB);
        TIFFSetField(tif, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, compression);
        TIFFSetField(tif, TIFFTAG_ROWSPERSTRIP, TIFFDefaultStripSize(tif, 0));
        for (int y = 0; y < height; ++y) {
            if (TIFFWriteScanline(tif, &rgb[static_cast<size_t>(y) * width * 3], static_cast<uint32_t>(y), 0) < 0) {
                TIFFClose(tif);
                throw std::runtime_error("libtiff could not write row " + std::to_string(y));
            }
        }
        TIFFClose(tif);
        const std::string bytes = out.str();
        std::u16string units(bytes.size(), u'\0');
        for (size_t i = 0; i < bytes.size(); ++i) units[i] = static_cast<unsigned char>(bytes[i]);
        return units;
    }

    // The first page's size, samples and codec, and the page count.
    static std::string describe(const std::u16string& tiff) {
        std::istringstream in(fromUnits(tiff));
        TIFF* tif = open(in);
        uint32_t width = 0;
        uint32_t height = 0;
        uint16_t samples = 0;
        uint16_t bits = 0;
        uint16_t compression = 0;
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &height);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLESPERPIXEL, &samples);
        TIFFGetFieldDefaulted(tif, TIFFTAG_BITSPERSAMPLE, &bits);
        TIFFGetFieldDefaulted(tif, TIFFTAG_COMPRESSION, &compression);
        const unsigned pages = TIFFNumberOfDirectories(tif);
        TIFFClose(tif);
        const TIFFCodec* codec = TIFFFindCODEC(compression);
        return std::to_string(width) + "x" + std::to_string(height) + ", " + std::to_string(samples) + " x " + std::to_string(bits) + "-bit samples, " +
               (codec ? codec->name : "compression " + std::to_string(compression)) + ", " + std::to_string(pages) + (pages == 1 ? " page" : " pages");
    }

    // The first page as RGBA, top row first, whatever its bit depth, colour model, layout or codec.
    static std::u16string decode(const std::u16string& tiff) {
        std::istringstream in(fromUnits(tiff));
        TIFF* tif = open(in);
        uint32_t width = 0;
        uint32_t height = 0;
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &height);
        if (static_cast<uint64_t>(width) * height > (64u << 20)) {
            TIFFClose(tif);
            throw std::runtime_error("more than 64 megapixels: decode it from a file instead");
        }
        std::vector<uint32_t> raster(static_cast<size_t>(width) * height);
        const int ok = TIFFReadRGBAImageOriented(tif, width, height, raster.data(), ORIENTATION_TOPLEFT, 0);
        TIFFClose(tif);
        if (!ok) throw std::runtime_error("libtiff cannot convert this page to RGBA");
        std::u16string rgba(raster.size() * 4, u'\0');
        for (size_t i = 0; i < raster.size(); ++i) {
            rgba[i * 4] = static_cast<char16_t>(TIFFGetR(raster[i]));
            rgba[i * 4 + 1] = static_cast<char16_t>(TIFFGetG(raster[i]));
            rgba[i * 4 + 2] = static_cast<char16_t>(TIFFGetB(raster[i]));
            rgba[i * 4 + 3] = static_cast<char16_t>(TIFFGetA(raster[i]));
        }
        return rgba;
    }

private:
    static TIFF* open(std::istringstream& in) {
        TIFF* tif = TIFFStreamOpen("memory", &in);
        if (!tif) throw std::runtime_error("not a TIFF libtiff can read");
        return tif;
    }

    static std::string fromUnits(const std::u16string& units) {
        std::string bytes(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string: a code unit is above 255");
            bytes[i] = static_cast<char>(units[i]);
        }
        return bytes;
    }
};
```

Then call it from JavaScript:

```js
import { initNative, Tiff } from './native/tiff_codec.h';

await initNative();
const width = 160;
const height = 120;
let rgba = ''; // one character per byte, in the order ImageData uses
for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rgba += String.fromCharCode(x, 64 + (y >> 5) * 32, 255 - x, 255);
}
const tiff = await Tiff.encode(rgba, width, height, 5); // 5 = COMPRESSION_LZW
console.log(`libtiff ${await Tiff.version()}: ${rgba.length} B of RGBA -> ${tiff.length} B, starts with ${tiff.slice(0, 3)}`); // libtiff 4.7.2: 76800 B of RGBA -> 27692 B, starts with II*
console.log(await Tiff.describe(tiff)); // 160x120, 3 x 8-bit samples, LZW, 1 page
console.log((await Tiff.decode(tiff)) === rgba); // true
```

- Binary data crosses the binding as a string with one UTF-16 code unit (0-255) per byte, which is why `encode` and `decode` take and return `std::u16string`. `Uint8Array.from(tiff, (c) => c.charCodeAt(0))` turns it into bytes.
- `TIFFReadRGBAImageOriented` turns 1 to 16-bit samples in any colour model, including palette, CMYK, JPEG YCbCr and alpha, into 8-bit RGBA. It does not take 32-bit integer or float samples: read those with `TIFFReadScanline`, as [Keep 32-bit float samples exact](https://crossbind.dev/ports/tiff/#03-samples) does.
- `TIFFStreamOpen` on a `std::ostream` writes one page. Adding a second page makes libtiff read the first one back, which an `ostream` cannot do, so a multi-page file in memory needs `TIFFClientOpen`, as [Store several pages in one file](https://crossbind.dev/ports/tiff/#02-pages) shows.
- For files, pass paths instead of bytes: mount the file into the module's memory with `m.autoMountFiles([file], await m.getRandomPath('/memfs'))` and open it in C++ with `TIFFOpen`. The viewer above works that way, and its pages never need a full-size RGBA copy.

### More examples
Each one runs in your browser on [crossbind.dev/ports/tiff](https://crossbind.dev/ports/tiff/#usage), next to the code shown there:

- [Store several pages in one file](https://crossbind.dev/ports/tiff/#02-pages): `TIFFWriteDirectory`, `TIFFReadDirectory` and `TIFFSetDirectory`, with 1-bit CCITT Group 4 pages.
- [Keep 32-bit float samples exact](https://crossbind.dev/ports/tiff/#03-samples): `SAMPLEFORMAT_IEEEFP`, the floating-point predictor and `TIFFReadScanline`.
- [Read one tile of a big image](https://crossbind.dev/ports/tiff/#04-tiles): `TIFFWriteTile`, `TIFFComputeTile` and `TIFFReadTile`.
- [Open a TIFF file and print its tags](https://crossbind.dev/ports/tiff/#05-open-file): `m.autoMountFiles`, `TIFFOpen` and `TIFFPrintDirectory`, on WebAssembly.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/tiff/wasm/) · [Android](https://crossbind.dev/ports/tiff/android/) · [iOS](https://crossbind.dev/ports/tiff/ios/) · [macOS](https://crossbind.dev/ports/tiff/darwin/) · [Linux](https://crossbind.dev/ports/tiff/linux/) · [Windows](https://crossbind.dev/ports/tiff/win32/) · [WASI](https://crossbind.dev/ports/tiff/wasi/), which also has a command-line program built with `crossbind build -p wasi`.

## What this build includes
- libtiff 4.7.2 with libtiffxx, the C++ stream API (`TIFFStreamOpen`): static libraries on WebAssembly, iOS, macOS, Linux, Windows and WASI, shared ones (`libtiff.so`, `libtiffxx.so`) on Android.
- Codecs on WebAssembly, as `TIFFGetConfiguredCODECs` lists them: None, LZW, PackBits, ThunderScan, NeXT, JPEG, Old-style JPEG, CCITT RLE, CCITT RLE/W, CCITT Group 3, CCITT Group 4, Deflate, AdobeDeflate, PixarLog, SGILog, SGILog24, ZSTD and LERC. Android and iOS are built from the same recipe with the same four codec libraries: zlib, libjpeg-turbo, zstd and LERC.
- No WebP, LZMA or JBIG: files that use them open and list their tags, but their pixels cannot be decoded.
- The WASI build links zlib only, so it has None, LZW, PackBits, ThunderScan, NeXT, the CCITT codecs, Deflate, PixarLog and SGILog: no JPEG, ZSTD or LERC. The `-standalone-wasi` tools have the same set.
- On WASI, a multi-page TIFF written straight to a file with `TIFFOpen` comes out corrupt: with wasi-sdk 34's `wasm32-wasip2` and `-wasip3` libc, a write after `lseek(fd, 0, SEEK_END)` lands at the previous position, and libtiff seeks that way before each page after the first. One-page files are not affected, and neither is a file built in memory with `TIFFClientOpen` and saved in one write, as the [WASI program](https://crossbind.dev/ports/tiff/wasi/) does.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-tiff-wasm`](https://www.npmjs.com/package/@crossbind/port-tiff-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-tiff-android`](https://www.npmjs.com/package/@crossbind/port-tiff-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-tiff-ios`](https://www.npmjs.com/package/@crossbind/port-tiff-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-tiff-darwin`](https://www.npmjs.com/package/@crossbind/port-tiff-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-tiff-linux`](https://www.npmjs.com/package/@crossbind/port-tiff-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Windows | [`@crossbind/port-tiff-win32`](https://www.npmjs.com/package/@crossbind/port-tiff-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-tiff-wasi`](https://www.npmjs.com/package/@crossbind/port-tiff-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-tiff-standalone-wasi`](https://www.npmjs.com/package/@crossbind/port-tiff-standalone-wasi) | the 18 tools libtiff installs, from `tiffinfo` to `tiff2pdf`, as `<tool>-wasi` commands (wasmtime 47+) |

## License
This project includes the precompiled libtiff library, which is distributed under the [libtiff License](https://libtiff.gitlab.io/libtiff/project/license.html).

libtiff Homepage: [https://libtiff.gitlab.io/libtiff/](https://libtiff.gitlab.io/libtiff/)
