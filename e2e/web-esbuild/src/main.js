import { initNative, Native } from './native/native.h';
// Conformance kit: every documented C++/Rust feature as one shared data-driven list.
import { runConformance } from '@crossbind/conformance/spec/run.mjs';
import { ConfBox, ConfCircle, ConfOps } from '@crossbind/conformance/native/conformance.h';
// The pointer, callback, string, wrapper and type rules: one namespace per kit header.
import * as confPointers from '@crossbind/conformance/native/confpointers.h';
import * as confCallbacks from '@crossbind/conformance/native/confcallbacks.h';
import * as confText from '@crossbind/conformance/native/conftext.h';
import * as confWrappers from '@crossbind/conformance/native/confwrappers.h';
import * as confExtend from '@crossbind/conformance/native/confextend.h';
import * as confTypes from '@crossbind/conformance/native/conftypes.h';
import * as confTypes2 from '@crossbind/conformance/native/conftypes2.h';
import * as confKindA from '@crossbind/conformance/native/confkinda.h';
import * as confKindB from '@crossbind/conformance/native/confkindb.h';
import * as confPrelude from '@crossbind/conformance/native/confprelude.h';
import * as confPreludeDeps from '@crossbind/conformance/native/confpreludedeps.h';
// Constants bind only for the names imported here; the header also defines one no leg imports.
import {
    AllSymbols as confConstantsModule, CONF_BASE, CONF_BASE_NAME, CONF_CHAR, CONF_DOUBLE, CONF_EXPRESSION, CONF_HEX, CONF_INT,
    CONF_NEGATIVE, CONF_PLATFORM, CONF_STRING, CONF_TRUE, CONF_WIDE, confGlobal, confGlobalName,
} from '@crossbind/conformance/native/confconstants.h';
// Package headers as the ports ship them: their C structs' fields are the packageFields section.
import * as zlibHeader from '@crossbind/port-zlib/zlib.h';
import * as webpEncode from '@crossbind/port-webp/encode.h';
import {
    initNative as initRustDemo,
    RustyCounter, Widget, Gauge, Mode, RustIntVector,
    doubleIt, greet, checkedParse, parseEven, tag,
    jsonEcho, jsonTally, jsonPick, SharedDoc, dupDoc, sharedDropCount,
} from '@crossbind/embind-rust-demo';
import * as confRust from '@crossbind/conformance-rust';
// App-local surface over upstream crates (geo + wkt): same file as the vite/RN legs.
import { initNative as initHull, Hull } from './native/geo_surface.rs';
// Direct crate imports: bridged from the crates' own sources, no surface file.
import { initNative as initUuidCrate, Uuid } from 'cargo:uuid';
import { initNative as initSemver, Version, VersionReq } from 'cargo:semver';
import { initNative as initRegex, Regex } from 'cargo:regex';
// One module of a crate: xxhash-rust's root exports nothing, its xxh3 module does.
import { xxh364, Xxh3 } from 'cargo:xxhash-rust/xxh3';
import { xxh64, Xxh64 } from 'cargo:xxhash-rust/xxh64';
import { xxh32, Xxh32 } from 'cargo:xxhash-rust/xxh32';
// argon2-rust has a `Version` of its own, next to semver's.
import { Argon2, Params as Argon2Params, Algorithm as Argon2Algorithm, Version as Argon2Version } from 'cargo:argon2-rust';
import { Params as Argon2ModuleParams, Memory as Argon2Memory } from 'cargo:argon2-rust/params';
import { XzOptions, XzWriter, XzReader, LzmaOptions, LzmaWriter, Lzma2Reader, LzmaReader } from 'cargo:lzma-rust2';

const show = (id, text) => { document.getElementById(id).textContent = text; };

// The same page as web-rspack's, without React: esbuild and Bun bundle it alike.
await initNative();
await Native.runOnThread();
show('message', 'ready (pthreads)');
setTimeout(async () => {
    show('thread', await Native.getThreadResult());
}, 1000);

// The mt runtime is worker-backed (a comlink proxy), so worker semantics apply and live-JS stays a SKIP.
try {
    await initRustDemo();
    await initHull();
    await initUuidCrate();
    await initSemver();
    await initRegex();
    const result = await runConformance({
        cpp: { ConfBox, ConfCircle, ConfOps },
        rustPkg: {
            RustyCounter, Widget, Gauge, Mode, RustIntVector,
            doubleIt, greet, checkedParse, parseEven, tag,
            jsonEcho, jsonTally, jsonPick, SharedDoc, dupDoc, sharedDropCount,
        },
        rustAppLocal: { Hull },
        rustCrates: {
            Uuid, Version, VersionReq, Regex, xxh364, Xxh3, xxh64, Xxh64, xxh32, Xxh32,
            Argon2, Argon2Params, Argon2Algorithm, Argon2Version, Argon2ModuleParams, Argon2Memory,
            XzOptions, XzWriter, XzReader, LzmaOptions, LzmaWriter, Lzma2Reader, LzmaReader,
        },
        jsLive: null,
        pointers: confPointers,
        callbacks: confCallbacks,
        strings: confText,
        wrappers: confWrappers,
        extend: confExtend,
        // The type checks reach across headers; the namespaces merge after initNative bound them.
        types: { ...confTypes, ...confTypes2, ...confKindA, ...confKindB, ...confPrelude, ...confPreludeDeps },
        packageFields: { zlib: zlibHeader, webp: webpEncode },
        constants: {
            CONF_BASE, CONF_BASE_NAME, CONF_CHAR, CONF_DOUBLE, CONF_EXPRESSION, CONF_HEX, CONF_INT, CONF_NEGATIVE,
            CONF_PLATFORM, CONF_STRING, CONF_TRUE, CONF_WIDE, confGlobal, confGlobalName, module: confConstantsModule,
        },
        rustKit: confRust,
        caps: { worker: true },
    });
    const firstBad = result.lines.find((line) => line.startsWith('NO'));
    if (firstBad) console.log(`CONF LINES:\n${result.lines.join('\n')}`);
    show('conf', firstBad ? `${result.summary} | ${firstBad}` : result.summary);
} catch (error) {
    show('conf', `CONFORMANCE ERR: ${error?.message ?? error}`);
}
