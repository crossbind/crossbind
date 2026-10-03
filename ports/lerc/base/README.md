# @crossbind/port-lerc
**Precompiled LERC (Limited Error Raster Compression) library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-lerc">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-lerc?style=for-the-badge" />
</a>
<a href="https://github.com/Esri/lerc">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-lerc%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=LERC" />
</a>
<a href="https://github.com/Esri/lerc/blob/master/LICENSE">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-lerc?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

LERC, from Esri, compresses rasters such as elevation models so that no value moves by more than the error you choose, or by nothing at all. ArcGIS elevation services send their tiles as LERC, and GDAL's GeoTIFF and MRF drivers read and write it.

## See it run
Three apps on **[crossbind.dev/ports/lerc](https://crossbind.dev/ports/lerc/#apps)** run this package in your browser, on the same generated rasters every time:

- **Error budgets.** A 512 × 512 elevation model (1,048,576 B of float32) is encoded at six budgets, from lossless to 5 m, and every height is decoded and compared. Within 1 cm, mountains take 464,085 B (2.26× smaller) and a lowland 257,823 B (4.07×); within 5 m the lowland takes 17,190 B (61×), and its relief shows what that error looks like.
- **Tile inspector.** Reads a LERC blob's header without decoding it (size, data type, bands, valid pixels, value range and the error it was stored with), then decodes a band and draws it. Legacy Lerc1 tiles open too.
- **LERC or gzip.** Four rasters through the browser's own gzip and through LERC. Lossless, LERC is smaller on terrain (576,760 B against 888,786 B from Chrome's gzip), on temperature readings and on random values; on a map of whole-number classes gzip wins (17,302 B against 39,300 B).

Their C++ wrappers, and the self-check the site build runs against numbers computed independently of this package, are in [`landing/demos/lib-lerc`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-lerc).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-lerc @crossbind/port-lerc-wasm @crossbind/port-lerc-android @crossbind/port-lerc-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import lercWasm from '@crossbind/port-lerc-wasm/crossbind.config.js';
+import lercAndroid from '@crossbind/port-lerc-android/crossbind.config.js';
+import lercIos from '@crossbind/port-lerc-ios/crossbind.config.js';

export default {
    dependencies: [
+        lercWasm,
+        lercAndroid,
+        lercIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon links the build of its platform: `crossbind build -p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-lerc-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one stores one band of float32 heights within the error you allow and reads them back. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/lerc_codec.h
#pragma once

#include <Lerc_c_api.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

// One band of float32 heights, row by row from the top left, in and out of LERC. Bytes cross the
// binding as a byte string: one UTF-16 code unit (0-255) per byte.
class LercCodec {
public:
    static std::string version() {
        return std::to_string(LERC_VERSION_MAJOR) + "." + std::to_string(LERC_VERSION_MINOR) + "." + std::to_string(LERC_VERSION_PATCH);
    }

    // Every decoded height stays within maxError of the original; 0 keeps every bit.
    static std::u16string encode(const std::u16string& heights, int width, int height, double maxError) {
        const std::vector<float> values = toFloats(heights, width, height);
        const double bound = boundFor(values, maxError);
        unsigned int size = 0;
        check(lerc_computeCompressedSize(values.data(), kFloat, 1, width, height, 1, 0, nullptr, bound, &size), "sizing");
        std::vector<unsigned char> blob(size);
        unsigned int written = 0;
        check(lerc_encode(values.data(), kFloat, 1, width, height, 1, 0, nullptr, bound, blob.data(), size, &written), "encoding");
        return toUnits(blob.data(), written);
    }

    static std::u16string decode(const std::u16string& blob) {
        const std::vector<unsigned char> bytes = fromUnits(blob);
        const auto size = static_cast<unsigned int>(bytes.size());
        unsigned int info[11] = {};
        double range[3] = {};
        check(lerc_getBlobInfo(bytes.data(), size, info, range, 11, 3), "reading the header");
        const int width = static_cast<int>(info[3]);
        const int height = static_cast<int>(info[4]);
        if (info[1] != kFloat || info[2] != 1 || info[5] != 1) throw std::invalid_argument("this codec reads one band of float32");
        if (info[6] != info[3] * info[4]) throw std::invalid_argument("this blob has missing pixels: decode it with its mask");
        std::vector<float> values(static_cast<size_t>(width) * height);
        check(lerc_decode(bytes.data(), size, 0, nullptr, 1, width, height, 1, kFloat, values.data()), "decoding");
        return toUnits(reinterpret_cast<const unsigned char*>(values.data()), values.size() * sizeof(float));
    }

private:
    static constexpr unsigned int kFloat = 6;  // dt_float in Lerc_types.h

    // LERC quantizes in double precision and rounds back to float32, which can overshoot maxError by
    // half a float32 step (31 µm at 1,000 m). Like Esri's own sample, ask for a little less: one
    // float32 step at the largest height.
    static double boundFor(const std::vector<float>& values, double maxError) {
        if (maxError <= 0) return 0;
        float largest = 0;
        for (const float value : values) largest = std::max(largest, std::fabs(value));
        const double step = static_cast<double>(std::nextafter(largest, INFINITY)) - largest;
        return maxError > step ? maxError - step : 0;
    }

    static void check(lerc_status status, const char* step) {
        static const char* const names[] = {"ok", "failed", "wrong parameter", "buffer too small", "NaN", "uses noData", "dimensions too large"};
        if (status != 0) throw std::runtime_error(std::string("LERC failed ") + step + ": " + (status < 7 ? names[status] : "unknown error"));
    }

    static std::vector<float> toFloats(const std::u16string& units, int width, int height) {
        if (width <= 0 || height <= 0 || units.size() != static_cast<size_t>(width) * height * sizeof(float)) {
            throw std::invalid_argument("expected width * height float32 values");
        }
        std::vector<float> values(static_cast<size_t>(width) * height);
        auto* bytes = reinterpret_cast<unsigned char*>(values.data());
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            bytes[i] = static_cast<unsigned char>(units[i]);
        }
        return values;
    }

    static std::vector<unsigned char> fromUnits(const std::u16string& units) {
        std::vector<unsigned char> bytes(units.size());
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            bytes[i] = static_cast<unsigned char>(units[i]);
        }
        return bytes;
    }

    static std::u16string toUnits(const unsigned char* bytes, size_t size) {
        std::u16string units(size, u'\0');
        for (size_t i = 0; i < size; ++i) units[i] = bytes[i];
        return units;
    }
};
```

Then call it from JavaScript:

```js
import { initNative, LercCodec } from './native/lerc_codec.h';

await initNative();
let seed = 42;
const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
const width = 256;
const height = 256;
const heights = new Float32Array(width * height); // metres, row by row from the top left
for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
        const dx = x - 128;
        const dy = y - 128;
        heights[y * width + x] = 1500 - (dx * dx + dy * dy) / 70 + random(1000) / 1000; // a hill, rough to 1 m
    }
}
const toText = (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
const toBytes = (text) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));

const blob = await LercCodec.encode(toText(new Uint8Array(heights.buffer)), width, height, 0.01);
const decoded = new Float32Array(toBytes(await LercCodec.decode(blob)).buffer);
let worst = 0;
for (let i = 0; i < heights.length; i += 1) worst = Math.max(worst, Math.abs(decoded[i] - heights[i]));
console.log(`LERC ${await LercCodec.version()}: ${heights.byteLength} B of float32 heights -> ${blob.length} B`); // LERC 4.2.0: 262144 B of float32 heights -> 94775 B
console.log(`largest error ${worst.toFixed(4)} m, within 1 cm: ${worst <= 0.01}`); // largest error 0.0099 m, within 1 cm: true
```

- Binary data crosses the binding as a string with one UTF-16 code unit (0-255) per byte, which is why `encode` and `decode` take and return `std::u16string`. `toText` and `toBytes` convert on the JavaScript side.
- LERC quantizes in double precision and rounds every value back to float32, which can overshoot `maxZError` by half a float32 step: 31 µm at 1,000 m. Esri's own sample passes a slightly smaller value; this wrapper subtracts one float32 step at the largest height, so every decoded value stays within the error you asked for.
- Pass `0` as `maxError` for a lossless round trip: float32 comes back bit for bit.
- For files, pass paths instead of bytes: mount the file into the module's filesystem (`autoMountFiles`) and read it in C++ with `fopen`. The tile inspector above works that way.

### More examples
Each one runs in your browser on [crossbind.dev/ports/lerc](https://crossbind.dev/ports/lerc/#usage), next to the code shown there:

- [Read a blob's header without decoding it](https://crossbind.dev/ports/lerc/#02-blob-info): `lerc_getBlobInfo` reports size, data type, bands, valid pixels, the value range and the error used.
- [Keep integer data exact](https://crossbind.dev/ports/lerc/#03-lossless): lossless LERC for any of its eight data types, here a 12-bit sensor band in `uint16`.
- [Leave out pixels that have no data](https://crossbind.dev/ports/lerc/#04-nodata): a NoData value goes into LERC's validity mask instead of the heights, through `lerc_encode` and `lerc_decode`.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/lerc/wasm/) · [Android](https://crossbind.dev/ports/lerc/android/) · [iOS](https://crossbind.dev/ports/lerc/ios/) · [macOS](https://crossbind.dev/ports/lerc/darwin/) · [Linux](https://crossbind.dev/ports/lerc/linux/) · [Windows](https://crossbind.dev/ports/lerc/win32/) · [WASI](https://crossbind.dev/ports/lerc/wasi/), which also has a command-line program built with `crossbind build -p wasi`.

## What this build includes
- LERC 4.2.0 with all 12 functions of `Lerc_c_api.h`: encoding as well as decoding, the `_4D` variants with NoData values, and `lerc_encodeForVersion` for older decoders.
- Validity masks and several bands per blob. The examples and apps check float32, uint16 and uint8 data.
- Lossless float compression: with a `maxZError` of 0, float32 comes back bit for bit.
- The legacy Lerc1 decoder: Esri's `world.lerc1` test blob and an ArcGIS Terrain 3D tile decode to the same values as a native build of the same source.
- Lossless float blobs are not byte-reproducible: LERC 4.2.0 leaves four bytes after each Huffman-coded byte plane uninitialized (`fpl_EsriHuffman.cpp`). Decoding ignores them, but two encodes of the same data can differ in those bytes and in the checksum, so do not compare such blobs by hash.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-lerc-wasm`](https://www.npmjs.com/package/@crossbind/port-lerc-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-lerc-android`](https://www.npmjs.com/package/@crossbind/port-lerc-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-lerc-ios`](https://www.npmjs.com/package/@crossbind/port-lerc-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-lerc-darwin`](https://www.npmjs.com/package/@crossbind/port-lerc-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-lerc-linux`](https://www.npmjs.com/package/@crossbind/port-lerc-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Windows | [`@crossbind/port-lerc-win32`](https://www.npmjs.com/package/@crossbind/port-lerc-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-lerc-wasi`](https://www.npmjs.com/package/@crossbind/port-lerc-wasi) | `wasm32-wasip3` — single-threaded |

## License
This project includes the precompiled LERC library, which is distributed under the [Apache License 2.0](https://github.com/Esri/lerc/blob/master/LICENSE). Esri's [NOTICE](https://github.com/Esri/lerc/blob/master/NOTICE) grants the right to practise the LERC patent (US 9,002,126) under the same licence.

LERC Homepage: [https://github.com/Esri/lerc](https://github.com/Esri/lerc)
