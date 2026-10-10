# @crossbind/port-expat
**Precompiled Expat XML parser library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-expat">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-expat/beta?style=for-the-badge" />
</a>
<a href="https://github.com/libexpat/libexpat">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.npmjs.org%2F%40crossbind%2Fport-expat%2Fbeta&query=%24.nativeVersion&style=for-the-badge&label=Expat" />
</a>
<a href="https://github.com/libexpat/libexpat/blob/master/COPYING">
    <img alt="License" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.npmjs.org%2F%40crossbind%2Fport-expat%2Fbeta&query=%24.license&style=for-the-badge&label=license" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/expat](https://crossbind.dev/ports/expat/#apps)** run this package in your browser, on the same generated data every time:

- **XML firehose.** Parses an OpenStreetMap-style document that is generated as it goes: up to 1.07 GB and 28.8 million elements, 1 MiB at a time, inside the Web Worker the module runs in. The module's memory stays the same size from start to finish. An XML file you pick streams through the same way.
- **Attack lab.** A 784-byte billion-laughs document that would expand to 3 GB stops at line 14, column 6, after 2.6 MB of text. A quadratic blowup, an external entity pointing at `file:///etc/passwd` (reported to a handler, never loaded) and 100,000 levels of nesting run the same way, with the limits adjustable.
- **GPX reader.** A namespace-aware parse finds Garmin's heart-rate extension whether a file spells it `gpxtpx:` or `ns3:`; the reader draws the track and exports GeoJSON. The generated sample ride comes out at 64.043 km, 9,113 points, 803.3 m of climb and an average heart rate of 126.7 bpm.

Their C++ wrappers, and the self-check the site build runs against results computed independently of this package, are in [`landing/demos/lib-expat`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-expat).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-expat@beta @crossbind/port-expat-wasm@beta @crossbind/port-expat-android@beta @crossbind/port-expat-ios@beta
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import expatWasm from '@crossbind/port-expat-wasm/crossbind.config.js';
+import expatAndroid from '@crossbind/port-expat-android/crossbind.config.js';
+import expatIos from '@crossbind/port-expat-ios/crossbind.config.js';

export default {
    dependencies: [
+        expatWasm,
+        expatAndroid,
+        expatIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon (`crossbind build -e node`) links the build of its platform: `-p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-expat-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one turns XML into plain objects with Expat's element and character data handlers, and reports errors with their line and column. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/xml_tree.h
#pragma once

#include <expat.h>

#include <stdexcept>
#include <string>
#include <vector>

// XML in, JSON out. Each element becomes {"name","attributes","children","text"}: `children` holds
// its child elements and `text` its own character data, left out when it is only whitespace.
// Malformed XML throws Expat's message with the line and column where parsing stopped.
class XmlTree {
public:
    static std::string version() {
        const XML_Expat_Version v = XML_ExpatVersionInfo();
        return std::to_string(v.major) + "." + std::to_string(v.minor) + "." + std::to_string(v.micro);
    }

    static std::string parse(const std::string& xml) {
        Builder builder;
        XML_Parser parser = XML_ParserCreate(nullptr);
        if (!parser) throw std::runtime_error("out of memory");
        XML_SetUserData(parser, &builder);
        XML_SetElementHandler(parser, onStart, onEnd);
        XML_SetCharacterDataHandler(parser, onText);
        const bool ok = XML_Parse(parser, xml.data(), static_cast<int>(xml.size()), XML_TRUE) == XML_STATUS_OK;
        const std::string error = ok ? "" : std::string(XML_ErrorString(XML_GetErrorCode(parser))) + " at line " +
                                                std::to_string(XML_GetCurrentLineNumber(parser)) + ", column " +
                                                std::to_string(XML_GetCurrentColumnNumber(parser));
        XML_ParserFree(parser);
        if (!ok) throw std::runtime_error(error);
        return builder.json;
    }

private:
    struct Builder {
        std::string json;
        std::vector<std::string> text;       // character data of each open element
        std::vector<bool> hasChildren;
    };

    // Expat delivers UTF-8; JSON only needs quotes, backslashes and control characters escaped.
    static std::string quote(const std::string& value) {
        std::string out = "\"";
        for (const char c : value) {
            if (c == '"' || c == '\\') {
                out += '\\';
                out += c;
            } else if (c == '\n') {
                out += "\\n";
            } else if (c == '\t') {
                out += "\\t";
            } else if (c == '\r') {
                out += "\\r";
            } else {
                out += c;
            }
        }
        return out + "\"";
    }

    static void XMLCALL onStart(void* data, const XML_Char* name, const XML_Char** attributes) {
        Builder& builder = *static_cast<Builder*>(data);
        if (!builder.hasChildren.empty()) {
            if (builder.hasChildren.back()) builder.json += ",";
            builder.hasChildren.back() = true;
        }
        builder.json += "{\"name\":" + quote(name) + ",\"attributes\":{";
        for (int i = 0; attributes[i]; i += 2) builder.json += (i ? "," : "") + quote(attributes[i]) + ":" + quote(attributes[i + 1]);
        builder.json += "},\"children\":[";
        builder.text.emplace_back();
        builder.hasChildren.push_back(false);
    }

    static void XMLCALL onText(void* data, const XML_Char* text, int length) {
        static_cast<Builder*>(data)->text.back().append(text, static_cast<size_t>(length));
    }

    static void XMLCALL onEnd(void* data, const XML_Char*) {
        Builder& builder = *static_cast<Builder*>(data);
        const std::string& text = builder.text.back();
        builder.json += "]";
        if (text.find_first_not_of(" \t\r\n") != std::string::npos) builder.json += ",\"text\":" + quote(text);
        builder.json += "}";
        builder.text.pop_back();
        builder.hasChildren.pop_back();
    }
};
```

Then call it from JavaScript:

```js
import { initNative, XmlTree } from './native/xml_tree.h';

await initNative();
console.log('Expat', await XmlTree.version()); // Expat 2.8.5
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
    <book id="1" lang="en"><title>Dune</title><price currency="EUR">9.99</price></book>
    <book id="2" lang="fr"><title>L'Étranger</title><price currency="EUR">7.50</price></book>
    <book id="3" lang="en"><title>Pride &amp; Prejudice</title><price currency="GBP">5.25</price></book>
</catalog>`;
const catalog = JSON.parse(await XmlTree.parse(xml));
for (const book of catalog.children) {
    const [title, price] = book.children;
    console.log(book.attributes.id, book.attributes.lang, title.text, price.text, price.attributes.currency);
}
// 1 en Dune 9.99 EUR
// 2 fr L'Étranger 7.50 EUR
// 3 en Pride & Prejudice 5.25 GBP

try {
    await XmlTree.parse('<catalog>\n    <book id="4"><title>Emma</book>\n</catalog>');
} catch (error) {
    console.log(error.cppMessage ?? error.message); // mismatched tag at line 2, column 30
}
```

- Expat is a stream parser and builds no tree of its own: it calls your handlers as it reads, and the handlers decide what to keep. Text can arrive in several calls for one run of characters, which is why the wrapper appends it.
- Expat reports UTF-8, and its columns count from 0.
- On WebAssembly a C++ exception reaches JavaScript with `error.message` prefixed by its type (`std::runtime_error: ...`); `error.cppMessage` holds Expat's text alone. On React Native, `error.message` is the text itself.
- For large documents, pass a path instead of a string and let Expat read the file in pieces: the streaming example below does that.

### More examples
Each one runs in your browser on [crossbind.dev/ports/expat](https://crossbind.dev/ports/expat/#usage), next to the code shown there:

- [Stream a file through Expat](https://crossbind.dev/ports/expat/#02-stream): `XML_GetBuffer` and `XML_ParseBuffer`, 64 KiB at a time.
- [Read namespaced XML whatever the prefixes](https://crossbind.dev/ports/expat/#03-namespaces): `XML_ParserCreateNS` and `XML_SetStartNamespaceDeclHandler`.
- [Expand entities without a billion laughs](https://crossbind.dev/ports/expat/#04-limits): `XML_SetBillionLaughsAttackProtectionMaximumAmplification` and `XML_SetBillionLaughsAttackProtectionActivationThreshold`.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/expat/wasm/) · [Android](https://crossbind.dev/ports/expat/android/) · [iOS](https://crossbind.dev/ports/expat/ios/) · [macOS](https://crossbind.dev/ports/expat/darwin/) · [Linux](https://crossbind.dev/ports/expat/linux/) · [Windows](https://crossbind.dev/ports/expat/win32/) · [WASI](https://crossbind.dev/ports/expat/wasi/), which also has a command-line program built with `crossbind build -p wasi -e wasi`.

## What this build includes
- Expat 2.8.5 as a static library, built with upstream's CMake defaults: DTD and general entity support (`XML_DTD`, `XML_GE`), namespaces (`XML_NS`) and 1,024 bytes of context (`XML_CONTEXT_BYTES`). The API speaks UTF-8.
- Upstream's protections at their defaults. Entity expansion may reach at most 100 times the input once 8 MiB has been processed. Allocations may reach at most 100 times the input once 64 MiB has been allocated.
- `expat.h` declares the setters for those limits (`XML_SetBillionLaughsAttackProtection*`, `XML_SetAllocTracker*`) only when `XML_DTD` is defined or `XML_GE` is 1, and it does not include the build's `expat_config.h`. Define `XML_GE` as 1 before including it, as the attack-limit example does; the library has them compiled in.
- The built-in encodings: UTF-8, UTF-16, ISO-8859-1 and US-ASCII. A document declaring any other, such as `windows-1252` or `Shift_JIS`, fails with `unknown encoding` unless you set `XML_SetUnknownEncodingHandler`.
- No `XML_LARGE_SIZE`. On `wasm32` (WebAssembly and WASI), `XML_GetCurrentByteIndex` and `XML_GetCurrentByteCount` are 32-bit and cannot report positions past 2 GiB, so count bytes yourself; parsing itself goes on, and a 2.43 GB stream parsed in full in a test of this build. On 64-bit Android and iOS they are 64-bit.
- Upstream's README warns that Expat has unfixed security issues ([libexpat#1160](https://github.com/libexpat/libexpat/issues/1160)). Keep the limits on for untrusted input and update with upstream releases.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-expat-wasm`](https://www.npmjs.com/package/@crossbind/port-expat-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-expat-android`](https://www.npmjs.com/package/@crossbind/port-expat-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-expat-ios`](https://www.npmjs.com/package/@crossbind/port-expat-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-expat-darwin`](https://www.npmjs.com/package/@crossbind/port-expat-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-expat-linux`](https://www.npmjs.com/package/@crossbind/port-expat-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Linux (musl) | [`@crossbind/port-expat-linuxmusl`](https://www.npmjs.com/package/@crossbind/port-expat-linuxmusl) | `x64`, `arm64` — musl 1.2.5 or later (Alpine 3.21 and later), native Node.js addons |
| Windows | [`@crossbind/port-expat-win32`](https://www.npmjs.com/package/@crossbind/port-expat-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-expat-wasi`](https://www.npmjs.com/package/@crossbind/port-expat-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-expat-standalone-wasi`](https://www.npmjs.com/package/@crossbind/port-expat-standalone-wasi) | the upstream `xmlwf` well-formedness checker as an `xmlwf-wasi` command (wasmtime 47+) |
| Node.js, ready-made | [`@crossbind/port-expat-standalone-napi`](https://www.npmjs.com/package/@crossbind/port-expat-standalone-napi) | prebuilt addons for macOS, Linux (glibc and musl) and Windows, `arm64` and `x64`: nothing to build |

## License
This project includes the precompiled Expat library, which is distributed under the [MIT License](https://github.com/libexpat/libexpat/blob/master/COPYING).

Expat Homepage: [https://libexpat.github.io/](https://libexpat.github.io/)
