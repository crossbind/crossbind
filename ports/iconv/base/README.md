# @crossbind/port-iconv
**Precompiled GNU libiconv (character encoding conversion) library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-iconv">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-iconv?style=for-the-badge" />
</a>
<a href="https://www.gnu.org/software/libiconv/">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-iconv%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=iconv" />
</a>
<a href="https://spdx.org/licenses/LGPL-2.1-or-later.html">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-iconv?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/iconv](https://crossbind.dev/ports/iconv/#apps)** run this package in your browser:

- **Mojibake doctor.** Turns `Ã©tÃ©` back into `été` and `ÐŸÑ€Ð¸Ð²ÐµÑ‚` into `Привет`. It encodes the garbled text back into Windows-1252 bytes, which no browser API can do, then reads those bytes again. We garbled 516 strings through 25 common mix-ups; it ranked the original first for 498 of them, including all 414 that had been saved as UTF-8.
- **Legacy exporter.** Writes a two-line Japanese customer list as 86 bytes of Windows Shift_JIS (132 bytes in UTF-8). It names the one character CP932 lacks (`€` at line 2, column 31), flags `表` and `ソ`, whose second byte is the backslash `5C`, and pads fixed-width fields by bytes.
- **Beyond TextDecoder.** Reads nine samples that `TextDecoder` rejects with a `RangeError`: ISO-2022-KR, HZ, ISO-2022-CN, UTF-7, UTF-32LE, EUC-TW, DOS 850, Mac Central European and VISCII. It also tries 106 encodings on a file you open.

Their C++ wrappers are in [`landing/demos/lib-iconv`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-iconv), together with the self-check the site build runs. That check compares their output with values from CPython's codecs, the WHATWG Encoding Standard's indexes, RFC examples and Unicode's mapping tables.

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-iconv @crossbind/port-iconv-wasm @crossbind/port-iconv-android @crossbind/port-iconv-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import iconvWasm from '@crossbind/port-iconv-wasm/crossbind.config.js';
+import iconvAndroid from '@crossbind/port-iconv-android/crossbind.config.js';
+import iconvIos from '@crossbind/port-iconv-ios/crossbind.config.js';

export default {
    dependencies: [
+        iconvWasm,
+        iconvAndroid,
+        iconvIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon links the build of its platform: `crossbind build -p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-iconv-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one converts strictly between UTF-8 and any encoding libiconv knows. Put it in your project's native folder (`src/native/` by default), and don't call it `iconv.h`, which would hide the library's own header:

```cpp
// src/native/charset.h
#pragma once

#include <iconv.h>

#include <cerrno>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Strict conversion between UTF-8 text and the bytes of any encoding libiconv knows. Bytes cross the
// binding as a byte string: one UTF-16 code unit (0-255) per byte.
class Charset {
public:
    static std::u16string encode(const std::string& text, const std::string& encoding) {
        const std::string bytes = convert(text, "UTF-8", encoding);
        std::u16string units(bytes.size(), u'\0');
        for (size_t i = 0; i < bytes.size(); ++i) units[i] = static_cast<unsigned char>(bytes[i]);
        return units;
    }

    static std::string decode(const std::u16string& bytes, const std::string& encoding) {
        std::string input(bytes.size(), '\0');
        for (size_t i = 0; i < bytes.size(); ++i) {
            if (bytes[i] > 0xFF) throw std::invalid_argument("not a byte string");
            input[i] = static_cast<char>(bytes[i]);
        }
        return convert(input, encoding, "UTF-8");
    }

private:
    static std::string convert(const std::string& input, const std::string& from, const std::string& to) {
        const iconv_t opened = iconv_open(to.c_str(), from.c_str());
        if (opened == reinterpret_cast<iconv_t>(-1)) throw std::invalid_argument("iconv cannot convert " + from + " to " + to);
        std::unique_ptr<void, int (*)(iconv_t)> cd(opened, iconv_close);
        std::string output;
        std::vector<char> buffer(4096);
        char* in = const_cast<char*>(input.data());
        size_t inLeft = input.size();
        for (;;) {
            char* out = buffer.data();
            size_t outLeft = buffer.size();
            // Once the input is used up, a call without input ends a stateful encoding (ISO-2022-JP
            // switches back to ASCII); for the others it writes nothing.
            const bool finishing = inLeft == 0;
            const size_t status = finishing ? iconv(cd.get(), nullptr, nullptr, &out, &outLeft) : iconv(cd.get(), &in, &inLeft, &out, &outLeft);
            output.append(buffer.data(), buffer.size() - outLeft);
            if (status != static_cast<size_t>(-1)) {
                if (finishing) return output;
            } else if (errno != E2BIG) {  // E2BIG only means the buffer is full, and it was just emptied
                const size_t at = input.size() - inLeft;
                if (errno == EINVAL) throw std::runtime_error("incomplete " + from + " input at byte " + std::to_string(at));
                if (from != "UTF-8") throw std::runtime_error("invalid " + from + " input at byte " + std::to_string(at));
                throw std::runtime_error(missing(input, at, to));
            }
        }
    }

    // Text coming from JavaScript is valid UTF-8, so EILSEQ means the target has no such character.
    static std::string missing(const std::string& text, size_t at, const std::string& to) {
        const auto lead = static_cast<unsigned char>(text[at]);
        const size_t length = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
        unsigned long codePoint = length == 1 ? lead : lead & (0xFF >> (length + 1));
        for (size_t i = 1; i < length; ++i) codePoint = (codePoint << 6) | (static_cast<unsigned char>(text[at + i]) & 0x3F);
        size_t character = 0;
        for (size_t i = 0; i < at; ++i) character += (static_cast<unsigned char>(text[i]) & 0xC0) != 0x80;
        char name[16];
        std::snprintf(name, sizeof name, "U+%04lX", codePoint);
        return "cannot encode " + std::string(name) + " at character " + std::to_string(character) + " in " + to;
    }
};
```

Then call it from JavaScript:

```js
import { initNative, Charset } from './native/charset.h';

await initNative();
const hex = (bytes) => [...bytes].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
const sjis = await Charset.encode('日本語', 'SHIFT_JIS');
console.log(hex(sjis)); // 93 fa 96 7b 8c ea
console.log(await Charset.decode(sjis, 'SHIFT_JIS')); // 日本語
console.log(hex(await Charset.encode('日本語', 'ISO-2022-JP'))); // 1b 24 42 46 7c 4b 5c 38 6c 1b 28 42
try {
    await Charset.encode('Total: €5', 'ISO-8859-1');
} catch (error) {
    console.log(error.cppMessage ?? error.message); // cannot encode U+20AC at character 7 in ISO-8859-1
}
```

- Bytes cross the binding as a string with one UTF-16 code unit (0-255) per byte, which is why `encode` returns `std::u16string`. `Uint8Array.from(bytes, (c) => c.charCodeAt(0))` turns it into bytes.
- `E2BIG` only means the output buffer is full: the loop empties it and calls again. The last call passes no input, which returns a stateful encoding such as ISO-2022-JP to its initial state; that writes the closing `1b 28 42`.
- For Windows software in Japan, write `CP932`. `SHIFT_JIS` is the JIS standard, which reads byte `5C` as `¥`, has no encoding for a backslash and has no NEC extras such as `①`.
- On WebAssembly a C++ exception's `.message` starts with its C++ type; `cppMessage` holds the text alone.
- For files, pass paths instead of bytes: mount the file into the module's filesystem (`autoMountFiles`) and read it in C++ with `fopen`. The TextDecoder app above works that way.

### More examples
Each one runs in your browser on [crossbind.dev/ports/iconv](https://crossbind.dev/ports/iconv/#usage), next to the code shown there:

- [Transliterate or drop what the target cannot hold](https://crossbind.dev/ports/iconv/#02-fallbacks): the `//TRANSLIT` and `//IGNORE` suffixes, and the count `iconv` returns.
- [Decode a stream that cuts characters in two](https://crossbind.dev/ports/iconv/#03-stream): `EINVAL` at a cut character, whose bytes wait for the next piece.
- [List the encodings and check a name](https://crossbind.dev/ports/iconv/#04-encodings): `iconvlist`, `iconv_canonicalize`, and `iconv_open` as the real test.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/iconv/wasm/) · [Android](https://crossbind.dev/ports/iconv/android/) · [iOS](https://crossbind.dev/ports/iconv/ios/) · [macOS](https://crossbind.dev/ports/iconv/darwin/) · [Linux](https://crossbind.dev/ports/iconv/linux/) · [Windows](https://crossbind.dev/ports/iconv/win32/) · [WASI](https://crossbind.dev/ports/iconv/wasi/), which also has an iconv-style command-line program built with `crossbind build -p wasi`.

## What this build includes
- GNU libiconv 1.19 as a static library. The GPL `iconv` program and its gnulib support are not built.
- 198 encodings under 736 names, as `iconvlist` reports them, each usable in both directions, plus the locale-dependent `char` and `wchar_t`:
  - European and Semitic: ASCII, ISO-8859-1 to -16, KOI8-R, KOI8-U, KOI8-RU, Windows-1250 to -1258, DOS 850, 862, 866 and 1131, eleven Mac code pages, HP-ROMAN8 and NEXTSTEP.
  - Japanese: EUC-JP, SHIFT_JIS, CP932, ISO-2022-JP, -JP-1, -JP-2 and -JP-MS.
  - Chinese: EUC-CN, HZ, GBK, CP936, GB18030, GB18030:2022, EUC-TW, BIG5, CP950, BIG5-HKSCS (1999, 2001, 2004 and 2008 editions), ISO-2022-CN and ISO-2022-CN-EXT.
  - Korean: EUC-KR, CP949, ISO-2022-KR and JOHAB.
  - Other scripts: ARMSCII-8, Georgian-Academy, Georgian-PS, KOI8-T, PT154, RK1048, TIS-620, CP874, MacThai, MuleLao-1, CP1133, VISCII and TCVN.
  - Unicode: UTF-8, UTF-16, UTF-32, UCS-2, UCS-4 (each with BE and LE forms), UTF-7, C99 and JAVA escapes, and the machine-order UCS-2-INTERNAL and UCS-4-INTERNAL with their byte-swapped forms.
  - libiconv's extra encodings, which the recipe enables with `--enable-extra-encodings`: the DOS code pages 437, 737, 775, 852, 853, 855 to 858, 860, 861, 863 to 865, 869 and 1125; EBCDIC code pages such as IBM037, IBM500 and IBM1047, and the euro forms IBM1140 to IBM1149; EUC-JIS-2004, SHIFT_JIS-2004 (SHIFT_JISX0213), ISO-2022-JP-2004, CP943, DEC-KANJI, BIG5-2003 and DEC-HANYU; TDS565, ATARIST and RISCOS-LATIN1.
  - Character sets on their own: JIS X 0201, JIS X 0208, JIS X 0212, ISO646-JP, GB 2312, ISO-IR-165, ISO646-CN and KS C 5601.
- **Not included.** The library is configured without `--enable-extra-encodings`, so `iconv_open` fails for:
  - CP437 and the other DOS code pages: CP737, 775, 852, 853, 855, 857, 858, 860, 861, 863, 864, 865, 869 and 1125;
  - every EBCDIC code page (IBM-037, IBM-1047, …);
  - EUC-JISX0213, Shift_JISX0213 and ISO-2022-JP-3;
  - BIG5-2003, TDS565, ATARIST and RISCOS-LATIN1.
- `UTF8` without the hyphen is not a name this build knows; write `UTF-8`.
- `//TRANSLIT` follows libiconv's own table in every locale, so `ASCII//TRANSLIT` writes `è` as `` `e ``.
- A module whose only wrapper is `charset.h` is 1,197,470 bytes of WebAssembly, 731,915 gzipped. `iconv_open` picks converters by name at run time, so every conversion table is linked.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-iconv-wasm`](https://www.npmjs.com/package/@crossbind/port-iconv-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-iconv-android`](https://www.npmjs.com/package/@crossbind/port-iconv-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-iconv-ios`](https://www.npmjs.com/package/@crossbind/port-iconv-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-iconv-darwin`](https://www.npmjs.com/package/@crossbind/port-iconv-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-iconv-linux`](https://www.npmjs.com/package/@crossbind/port-iconv-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Windows | [`@crossbind/port-iconv-win32`](https://www.npmjs.com/package/@crossbind/port-iconv-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI | [`@crossbind/port-iconv-wasi`](https://www.npmjs.com/package/@crossbind/port-iconv-wasi) | `wasm32-wasip3` — single-threaded |

## License
This project includes the precompiled GNU libiconv library, which is distributed under the [GNU Lesser General Public License v2.1 or later](https://spdx.org/licenses/LGPL-2.1-or-later.html) (LGPL-2.1-or-later). A closed-source app can use it by following the [LGPL playbook](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/licensing-lgpl.md):

- keep the WebAssembly a separate, replaceable file;
- keep your own native code in an openly published package;
- ship the notices that `crossbind licenses --notices` writes.

libiconv homepage: [https://www.gnu.org/software/libiconv/](https://www.gnu.org/software/libiconv/)
