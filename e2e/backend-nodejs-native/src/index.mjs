import { fileURLToPath } from 'node:url';
import { runConformance } from '@crossbind/conformance/spec/run.mjs';
import { kitExports } from '@crossbind/conformance/spec/bridgeExports.mjs';
import { trackExports } from '@crossbind/conformance/spec/coverage.mjs';
// The hooks the build writes (node --import ./dist/node/napi.register.mjs) serve these imports from the
// addon, and the build binds what they name, as a bundler does.
// Constants bind only for the names imported here; the header also defines one no leg imports.
import {
    initNative, AllSymbols as confConstantsModule, CONF_BASE, CONF_BASE_NAME, CONF_CHAR, CONF_DOUBLE, CONF_EXPRESSION,
    CONF_HEX, CONF_INT, CONF_NEGATIVE, CONF_PLATFORM, CONF_STRING, CONF_TRUE, CONF_WIDE, confGlobal, confGlobalName,
} from '@crossbind/conformance/native/confconstants.h';
// Variadic functions, function-like and renaming macros and mutable globals bind only for the names imported here.
import {
    ConfVaBuffer, confCounter, confCounterValue, confGreeting, confGreetingValue, confMacroAdd, confMacroAdd_, confMacroWide, confMacroWide_, confVaNoexcept, confMacroHalf,
    confMacroHalf_, confMacroLength, confMacroLength_, confRenamed, confRenamedTarget, confVaFormat, confVaSum, vaDouble,
    allocBuffer, cstring, readCString, readNumberAt, readPointerAt, writeNumberAt, writePointerAt,
} from '@crossbind/conformance/native/confextras.h';
import { Counter } from './native/counter.rs';
// Direct crate imports: bridged from the crates' own sources, no surface file.
import { Uuid } from 'cargo:uuid';
import { Version, VersionReq } from 'cargo:semver';
import { Regex } from 'cargo:regex';
import { xxh364, Xxh3 } from 'cargo:xxhash-rust/xxh3';
import { xxh64, Xxh64 } from 'cargo:xxhash-rust/xxh64';
import { xxh32, Xxh32 } from 'cargo:xxhash-rust/xxh32';
import { Argon2, Params as Argon2Params, Algorithm as Argon2Algorithm, Version as Argon2Version } from 'cargo:argon2-rust';
import { Params as Argon2ModuleParams, Memory as Argon2Memory } from 'cargo:argon2-rust/params';
import { XzOptions, XzWriter, XzReader, LzmaOptions, LzmaWriter, Lzma2Reader, LzmaReader } from 'cargo:lzma-rust2';

// The addon runs embind-jsi like React Native does: a synchronous runtime, so every section runs
// with the jsi expectations.
initNative().then(async (m) => {
    try {
        // Every kit export must be touched by a check: the proxies record what the checks read.
        const { proxy, seen } = trackExports(m);
        const constants = trackExports({
            CONF_BASE, CONF_BASE_NAME, CONF_CHAR, CONF_DOUBLE, CONF_EXPRESSION, CONF_HEX, CONF_INT, CONF_NEGATIVE,
            CONF_PLATFORM, CONF_STRING, CONF_TRUE, CONF_WIDE, confGlobal, confGlobalName, module: confConstantsModule,
        }, seen).proxy;
        const extras = trackExports({
            ConfVaBuffer, confCounter, confCounterValue, confGreeting, confGreetingValue, confMacroAdd, confMacroAdd_, confMacroWide, confMacroWide_, confVaNoexcept, confMacroHalf,
            confMacroHalf_, confMacroLength, confMacroLength_, confRenamed, confRenamedTarget, confVaFormat, confVaSum, vaDouble,
            allocBuffer, cstring, readCString, readNumberAt, readPointerAt, writeNumberAt, writePointerAt,
        }, seen).proxy;
        const result = await runConformance({
            cpp: { ConfBox: proxy.ConfBox, ConfCircle: proxy.ConfCircle, ConfOps: proxy.ConfOps, ConfShape: proxy.ConfShape },
            rustPkg: {
                RustyCounter: m.RustyCounter,
                Widget: m.Widget,
                Gauge: m.Gauge,
                Mode: m.Mode,
                RustIntVector: m.RustIntVector,
                doubleIt: m.doubleIt,
                greet: m.greet,
                checkedParse: m.checkedParse,
                parseEven: m.parseEven,
                tag: m.tag,
                jsonEcho: m.jsonEcho,
                jsonTally: m.jsonTally,
                jsonPick: m.jsonPick,
                SharedDoc: m.SharedDoc,
                dupDoc: m.dupDoc,
                sharedDropCount: m.sharedDropCount,
            },
            rustAppLocal: { Counter },
            rustCrates: {
                Uuid, Version, VersionReq, Regex, xxh364, Xxh3, xxh64, Xxh64, xxh32, Xxh32,
                Argon2, Argon2Params, Argon2Algorithm, Argon2Version, Argon2ModuleParams, Argon2Memory,
                XzOptions, XzWriter, XzReader, LzmaOptions, LzmaWriter, Lzma2Reader, LzmaReader,
            },
            jsLive: {
                jsPass: m.jsPass,
                jsProbe: m.jsProbe,
                jsCall: m.jsCall,
                jsStore: m.jsStore,
                jsFire: m.jsFire,
            },
            pointers: proxy,
            callbacks: proxy,
            strings: proxy,
            wrappers: proxy,
            types: proxy,
            constants,
            extras,
            rustKit: proxy,
            coverage: { exports: kitExports(fileURLToPath(new URL('../.crossbind/build/bridge/', import.meta.url))), seen },
            caps: { jsiNative: true },
        });
        console.log(result.summary);
        if (result.pass !== result.run) console.log(result.lines.join('\n'));
    } catch (e) {
        console.error('CONFORMANCE ERR:', e?.message ?? e);
    }
});
