// Cross-runtime conformance: every documented C++ and Rust binding feature as one
// data-driven list. Each leg (node / browser / React Native) wires the surfaces its runtime
// model actually has; everything else becomes an explicit SKIP line - never a silent gap.
//
// Every binding call is awaited on purpose: on worker-backed runtimes each call (including
// `new` and field reads) resolves through the proxy, and on synchronous runtimes the awaits
// are plain passthroughs - so one list serves both models.
//
// Surfaces:
//   cpp:          { ConfBox, ConfCircle, ConfOps }            (any leg - import the .h)
//   rustPkg:      { RustyCounter, Widget, Gauge, Mode, RustIntVector, doubleIt, greet,
//                   checkedParse, parseEven, tag, jsonEcho, jsonTally, jsonPick,
//                   SharedDoc, dupDoc, sharedDropCount }      (any leg - prebuilt package)
//   rustAppLocal: { Counter, Hull }                           (bundler legs; Node legs through the import hooks)
//   rustCrates:   { Uuid, Version, VersionReq, Regex, xxh364, Xxh3, xxh64, Xxh64, xxh32, Xxh32,
//                   Argon2, Argon2Params, Argon2Algorithm, Argon2Version, Argon2ModuleParams,
//                   Argon2Memory, XzOptions, XzWriter, XzReader, LzmaOptions, LzmaWriter,
//                   Lzma2Reader, LzmaReader } (bundler legs; Node legs through the import hooks)
//   jsLive:       { jsPass, jsProbe, jsCall, jsStore, jsFire } (synchronous runtimes only -
//                   on worker-backed legs functions cannot cross and identity dies)
//   pointers, callbacks, strings, wrappers, types: the module namespace of the matching kit
//                   header (any leg; the checks that pass JS functions skip on worker legs)
//   packageFields: { zlib, webp }, the namespaces of @crossbind/port-zlib/zlib.h and
//                   @crossbind/port-webp/encode.h (bundler legs that link both ports)
//   constants:    the names a leg imports from native/confconstants.h, plus `module` (its AllSymbols);
//                   constants bind only for header imports, so a leg that imports no header has none
//   extras:       the names a leg imports from native/confextras.h (variadic functions, function-like and
//                   renaming macros, mutable globals) with the pointer helpers; they bind only when imported by name
//   extrasWhole:  the module of a leg that binds native/confextras.h whole, which gets none of them
//   rustKit:      the exports of @crossbind/conformance-rust (any leg - prebuilt package);
//                   constructs the generator does not carry yet are `todo` entries, reported
//                   as TODO lines and counted apart from the pass/run figures
//   coverage:     { exports, seen } from spec/bridgeExports.mjs + spec/coverage.mjs (legs that build the bridges)

import { callbackChecks } from './sections/callbacks.mjs';
import { constantChecks } from './sections/constants.mjs';
import { extrasChecks } from './sections/extras.mjs';
import { packageFieldChecks } from './sections/packageFields.mjs';
import { pointerChecks } from './sections/pointers.mjs';
import { stringChecks } from './sections/strings.mjs';
import { typeChecks } from './sections/types.mjs';
import { wrapperChecks } from './sections/wrappers.mjs';
import { untouchedExports } from './coverage.mjs';
import { rustCollectionChecks } from './sections/rust/collections.mjs';
import { rustErrorChecks } from './sections/rust/errors.mjs';
import { rustNumberChecks } from './sections/rust/numbers.mjs';
import { rustOwnershipChecks } from './sections/rust/ownership.mjs';
import { rustParityChecks } from './sections/rust/parity.mjs';
import { rustStringChecks } from './sections/rust/strings.mjs';
import { rustSurfaceChecks } from './sections/rust/surface.mjs';
import { rustTypeChecks } from './sections/rust/types.mjs';

function section(list, name, why, fill) {
    if (!fill) {
        list.push({ name: `${name}:*`, skip: why });
        return;
    }
    fill();
}

export function buildChecks(s) {
    const list = [];
    const add = (name, run, expected) => list.push({ name, run, expected });
    const skip = (name, why) => list.push({ name, skip: why });
    // A todo runs like a check but a miss is reported as TODO, not NO: the construct is
    // wanted and not carried yet, so the leg's gate stays green until the generator learns it.
    const todo = (name, run, expected) => list.push({ name, run, expected, todo: true });
    // Worker-backed legs proxy every call; the remaining shape differences are contracts,
    // not gaps: vector returns arrive as plain arrays, plain arrays coerce into vector
    // params, and embind enum values cannot be structured-cloned.
    const worker = Boolean(s.caps?.worker);

    section(list, 'cpp', 'no C++ surface wired on this leg', s.cpp && (() => {
        const { ConfBox, ConfCircle, ConfOps } = s.cpp;
        // Public value fields ride the injected .property lines on every leg (the jsi fork
        // has _embind_register_class_property too); worker legs read and write them through
        // the comlink proxy, so every access is awaited.
        add('cpp:ctor+fields', async () => { const b = await new ConfBox(6, 4); return [await b.width, await b.height]; }, [6, 4]);
        add('cpp:fieldWrite', async () => {
            const b = await new ConfBox(6, 4);
            b.width = 9;
            return [await b.width, await b.area()];
        }, [9, 36]);
        if (worker) {
            // CONTRACT, not a gap: the worker boundary deliberately converts embind vectors
            // to plain arrays (embindVector transfer handler), so returns are arrays here.
            add('cpp:vectorOut', async () => { const d = await (await new ConfBox(6, 4)).dims(); return [d[0], d[1]]; }, [6, 4]);
            // The worker proxy coerces plain arrays into vector params; direct runtimes need
            // a real vector instance (see the else branch).
            add('cpp:vectorIntIn', async () => (await new ConfBox(6, 4)).sum([1, 2, 3]), 6);
            add('cpp:vectorStrIn', async () => (await new ConfBox(6, 4)).join(['x', 'y']), 'x,y');
        } else {
            // Direct legs (node, direct wasm, jsi): by-value returns are real vector
            // proxies; params take a vector instance built from another return.
            add('cpp:vectorOut', async () => { const d = await (await new ConfBox(6, 4)).dims(); return [await d.get(0), await d.get(1)]; }, [6, 4]);
            add('cpp:vectorIntIn', async () => { const b = await new ConfBox(1, 2); return b.sum(await (await new ConfBox(6, 4)).dims()); }, 10);
            add('cpp:vectorStrIn', async () => { const b = await new ConfBox(6, 4); return b.join(await b.letters()); }, 'x,y');
        }
        add('cpp:method', async () => (await new ConfBox(6, 4)).area(), 24);
        add('cpp:bool', async () => (await new ConfBox(6, 4)).wide(), true);
        add('cpp:double', async () => (await new ConfBox(6, 4)).scale(2.5), 60);
        add('cpp:string', async () => (await new ConfBox(6, 4)).tag('a='), 'a=24');
        add('cpp:stringEcho', () => ConfOps.echo('round trip'), 'round trip');
        add('cpp:sharedFactory', async () => (await ConfBox.square(5)).area(), 25);
        add('cpp:virtualDispatch', async () => (await ConfCircle.asShape()).describe(), 'I am circle');
        add('cpp:throw', async () => {
            try { await ConfOps.checkedSqrt(-1); return 'no-throw'; } catch (e) {
                return e !== undefined;
            }
        }, true);
        // wasm legs decode via getExceptionMessage (worker legs re-throw the decoded
        // Error); the jsi fork rethrows std::exception as JSError with the what() text.
        add('cpp:throwMessage', async () => {
            try { await ConfOps.checkedSqrt(-1); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('sqrt of negative');
            }
        }, true);
        add('cpp:noThrow', () => ConfOps.checkedSqrt(9), 3);
        add('cpp:optionalSome', () => ConfOps.half(42), 21);
        add('cpp:optionalNone', async () => (await ConfOps.half(7)) ?? 'empty', 'empty');
        // The jsi dispatch stopped at 15 arguments, a method's receiver counting as one; GDAL calls take up to 19.
        add('cpp:manyArgsStatic', () => ConfOps.sumOfSixteen(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16), 136);
        add('cpp:manyArgsMethod', async () => (await new ConfBox(6, 4)).areaPlusFifteen(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15), 144);
    }));

    section(list, 'rustPkg', 'no Rust package surface wired on this leg', s.rustPkg && (() => {
        const {
            RustyCounter, Widget, Gauge, Mode, RustIntVector,
            doubleIt, greet, checkedParse, parseEven, tag,
            jsonEcho, jsonTally, jsonPick, SharedDoc, dupDoc, sharedDropCount,
        } = s.rustPkg;
        add('rust:ctor+methods', async () => {
            const c = await new RustyCounter(10);
            await c.increment(5);
            const r = [await c.increment(27), await c.current(), await c.addSpan(2, 5)];
            await c.delete();
            return r;
        }, [42, 42, 45]);
        add('rust:bool', async () => { const c = await new RustyCounter(1); const r = await c.isPositive(); await c.delete(); return r; }, true);
        // Worker legs included: the embindEnum transfer handler gives enum values stable
        // token identity across the boundary, so `===` holds in both directions.
        add('rust:enum', async () => {
            const c = await new RustyCounter(1);
            const fast = await Mode.Fast;
            const r = (await c.setMode(fast)) === fast;
            await c.delete();
            return r;
        }, true);
        add('rust:valueObject', async () => {
            const c = await new RustyCounter(45);
            const p = await c.asPoint();
            const r = [p.x, p.y, await c.sumPoint({ x: 3, y: 4 })];
            await c.delete();
            return r;
        }, [45, 0, 7]);
        add('rust:double', async () => { const c = await new RustyCounter(45); const r = await c.scale(2.5); await c.delete(); return r; }, 112.5);
        add('rust:vector', async () => {
            const v = await new RustIntVector();
            await v.push_back(11);
            await v.push_back(22);
            const r = [await v.size(), await v.get(1)];
            await v.delete();
            return r;
        }, [2, 22]);
        add('rust:staticFactory', async () => { const w = await Widget.create(6); const r = await w.area(); await w.delete(); return r; }, 36);
        add('rust:strParam', async () => {
            const t = await RustyCounter.fromText(' 42 ');
            const r = await t.label('n=');
            await t.delete();
            return r;
        }, 'n=42');
        add('rust:resultThrow', async () => {
            try { await RustyCounter.fromText('nope'); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('invalid digit');
            }
        }, true);
        add('rust:optionNull', () => RustyCounter.parseOpt('nope'), null);
        add('rust:ctorThrow', async () => {
            try { const g = await new Gauge(101); await g.delete(); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('out of range');
            }
        }, true);
        add('rust:bigint', async () => {
            const b = await new RustyCounter(42);
            const r = (await b.addBig(1000000000000n)) === 1000000000042n && (await b.maxU64()) === 18446744073709551615n;
            await b.delete();
            return r;
        }, true);
        add('rust:display', async () => { const g = await new Gauge(40); const r = await g.toString(); await g.delete(); return r; }, 'gauge(40)');
        add('rust:freeFns', async () => [await doubleIt(21), await greet('conf')], [42, 'hello conf']);
        add('rust:freeThrow', async () => {
            try { await checkedParse('x'); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('invalid digit');
            }
        }, true);
        add('rust:optionalReturns', async () => {
            const b = await new RustyCounter(42);
            // None is null on every runtime (never undefined), like a C++ nullptr or empty optional.
            const r = [await b.half(), await b.ratio(2), await b.maybeLabel(), await b.ratio(0)];
            await b.delete();
            return [...r, await parseEven(' 8 '), (await parseEven('7')) ?? 'odd'];
        }, [21, 21, 'v42', null, 8, 'odd']);
        add('rust:optionalParams', async () => {
            const b = await new RustyCounter(10);
            const r = [await b.bump(5), await b.bump(undefined), await b.bump(null)];
            await b.delete();
            return [...r, await tag('x'), await tag(undefined)];
        }, [15, 16, 17, '[x]', '[none]']);
        add('rust:classRef', async () => {
            const a = await new RustyCounter(42);
            const b = await new RustyCounter(10);
            const r = await a.diff(b);
            await a.delete();
            await b.delete();
            return r;
        }, 32);
        add('rust:jsonRoundtrip', () => jsonEcho({ a: 1, list: [1, 2.5, 'x', null, true], nested: { k: 'v' } }), { a: 1, list: [1, 2.5, 'x', null, true], nested: { k: 'v' } });
        add('rust:jsonBuild', () => jsonTally({ items: [1, 2, 3] }), { hasItems: true, total: 6 });
        add('rust:jsonThrow', async () => {
            try { await jsonPick({}, 'zz'); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('missing key zz');
            }
        }, true);
        add('rust:arcShared', async () => {
            const base = await sharedDropCount();
            const d1 = await SharedDoc.create('conf');
            const d2 = await dupDoc(d1);
            const same = await d1.sameAs(d2);
            const label = await d2.label();
            await d1.delete();
            const half = (await sharedDropCount()) - base;
            await d2.delete();
            const full = (await sharedDropCount()) - base;
            return [same, label, half, full];
        }, [true, 'conf', 0, 1]);
    }));

    section(list, 'rustAppLocal', 'app-local .rs surfaces need a bundler (vite/webpack/metro) leg or the Node import hooks', s.rustAppLocal && (() => {
        const { Counter, Hull } = s.rustAppLocal;
        if (Counter) {
            add('rustLocal:class', async () => {
                const k = await new Counter(40);
                await k.add(2);
                const r = await k.total();
                await k.delete();
                return r;
            }, 42);
        }
        if (Hull) {
            // The two playground surfaces expose different Hull shapes; accept either.
            add('rustLocal:upstreamCrate', async () => {
                if (typeof Hull.fromWkt === 'function') {
                    const h = await Hull.fromWkt('MULTIPOINT((0 0),(4 0),(0 4),(4 4),(2 2))');
                    const ok = (await h.isValid()) && (await h.hullArea()) === 16 && (await h.hullWkt()).startsWith('POLYGON');
                    await h.delete();
                    return ok;
                }
                const h = await new Hull();
                await h.add(0, 0);
                await h.add(4, 0);
                await h.add(4, 4);
                await h.add(0, 4);
                await h.add(2, 2);
                const wkt = await h.wkt();
                await h.delete();
                return typeof wkt === 'string' && wkt.includes('POLYGON');
            }, true);
        }
    }));

    section(list, 'rustCrates', 'cargo: crate imports need a bundler (vite/webpack/metro) leg or the Node import hooks', s.rustCrates && (() => {
        const {
            Uuid, Version, VersionReq, Regex, xxh364, Xxh3, xxh64, Xxh64, xxh32, Xxh32,
            Argon2, Argon2Params, Argon2Algorithm, Argon2Version, Argon2ModuleParams, Argon2Memory,
            XzOptions, XzWriter, XzReader, LzmaOptions, LzmaWriter, Lzma2Reader, LzmaReader,
        } = s.rustCrates;
        add('crate:uuid', async () => {
            const u = await Uuid.newV4();
            const t = await u.toString();
            await u.delete();
            return /^[0-9a-f-]{36}$/.test(t);
        }, true);
        add('crate:semver', async () => {
            const req = await VersionReq.parse('^1.2');
            const v = await Version.parse('1.4.0');
            const r = await req.matches(v);
            await req.delete();
            await v.delete();
            return r;
        }, true);
        add('crate:regex', async () => {
            const re = await new Regex('^c[a-z]+$');
            const r = await re.isMatch('conf');
            await re.delete();
            return r;
        }, true);
        // `cargo:xxhash-rust/xxh3`: one module of a crate whose root exports nothing. The
        // expected hash is the reference C xxHash's XXH3-64 of the same bytes.
        add('crate:submodule', async () => {
            const bytes = Uint8Array.from('crossbind', (c) => c.charCodeAt(0));
            const h = await new Xxh3();
            await h.update(bytes.subarray(0, 5));
            await h.update(bytes.subarray(5));
            const streamed = await h.digest();
            await h.delete();
            return [await xxh364(bytes), streamed];
        }, [0x2edc9101d5f4ce96n, 0x2edc9101d5f4ce96n]);
        // xxh64 and Xxh64::update take `mut input: &[u8]`; the expected hash is the reference
        // C xxHash's XXH64 (seed 0) of the same bytes.
        add('crate:mutParam', async () => {
            const bytes = Uint8Array.from('crossbind', (c) => c.charCodeAt(0));
            const h = await new Xxh64(0n);
            await h.update(bytes);
            const streamed = await h.digest();
            await h.delete();
            return [await xxh64(bytes, 0n), streamed];
        }, [0x43a59ffc3189a5dcn, 0x43a59ffc3189a5dcn]);
        // xxh32 returns a u32: the reference XXH32 of these bytes is above 2^31, so a signed read
        // would come back negative.
        add('crate:xxh32', async () => {
            const bytes = Uint8Array.from('crossbind', (c) => c.charCodeAt(0));
            const h = await new Xxh32(0);
            await h.update(bytes);
            const streamed = await h.digest();
            await h.delete();
            return [await xxh32(bytes, 0), streamed];
        }, [0x841c676a, 0x841c676a]);
        // argon2-rust with no wrapper: modules declared inside a macro, a hex-valued enum, `impl
        // Default`, a Copy struct passed by value and a static function. The expected tag is
        // OpenSSL's Argon2id of the same input with the crate's defaults (m=19456, t=2, p=1).
        add('crate:argon2', async () => {
            const bytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
            const argon2id = await Argon2Algorithm.Argon2id;
            const params = await new Argon2Params();
            const argon2 = await new Argon2(argon2id, await Argon2Version.V0x13, params);
            const tag = await argon2.hash(bytes('crossbind'), bytes('conformance-salt'));
            const encoded = await argon2.hashEncoded(bytes('crossbind'), bytes('conformance-salt'));
            await Argon2.verifyPassword(encoded, bytes('crossbind'), argon2id);
            let rejected = false;
            try { await Argon2.verifyPassword(encoded, bytes('wrong'), argon2id); } catch { rejected = true; }
            await argon2.delete();
            await params.delete();
            return [Array.from(tag, (b) => b.toString(16).padStart(2, '0')).join(''), encoded.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'), rejected];
        }, ['8002e385972b1dec0c1fc20e4b2fde506e82acca7cde6620b6da05400b710196', true, true]);
        // All imports of one crate share its bridge: Params built through the `params` module's
        // builder is the root's Params, so the root's Argon2 takes it. The expected tag is
        // OpenSSL's Argon2id with those parameters (m=8192, t=1, p=1).
        add('crate:argon2Builder', async () => {
            const bytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
            const memory = await Argon2Memory.kib(8192n);
            const steps = [await Argon2ModuleParams.builder()];
            steps.push(await steps.at(-1).memory(memory));
            steps.push(await steps.at(-1).passes(1));
            steps.push(await steps.at(-1).lanes(1));
            const params = await steps.at(-1).build();
            const argon2 = await new Argon2(await Argon2Algorithm.Argon2id, await Argon2Version.V0x13, params);
            const tag = await argon2.hash(bytes('crossbind'), bytes('conformance-salt'));
            const encoded = await argon2.hashEncoded(bytes('crossbind'), bytes('conformance-salt'));
            for (const handle of [argon2, params, memory, ...steps]) await handle.delete();
            return [Array.from(tag, (b) => b.toString(16).padStart(2, '0')).join(''), encoded.startsWith('$argon2id$v=19$m=8192,t=1,p=1$')];
        }, ['9a8811bfd0c7a2af216940b7bfe5d293eebc8d054999f7e735e91ea70ceadaa2', true]);
        // lzma-rust2's XzWriter<W: Write> and XzReader<R: Read> with no wrapper: each writer call
        // returns the bytes it produced, and a reader reads the bytes it was built with. The fixture
        // is `xz -6` (XZ Utils 5.8.3) of the same text, so the reader is checked against an
        // independent encoder and the writer through that reader.
        add('crate:xzStreams', async () => {
            const text = 'crossbind '.repeat(64);
            const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
            const fixture = Uint8Array.from('fd377a585a000004e6d6b44604c01c80052101160000000000000000807372bfe0027f00145d00319c8a2301640a4db63433829d7cde304546e00000c957f093758601780001388005000000bd1144adb1c467fb020000000004595a'.match(/../g), (h) => parseInt(h, 16));
            const ascii = (data) => String.fromCharCode(...data);
            const decode = async (input) => {
                const reader = await new XzReader(input, false);
                const head = await reader.read(16);
                const rest = await reader.readAll();
                await reader.delete();
                return head.length === 16 && ascii(head) + ascii(rest) === text;
            };
            const options = await XzOptions.withPreset(6);
            const writer = await new XzWriter(options);
            const parts = [await writer.write(bytes.subarray(0, 100)), await writer.write(bytes.subarray(100)), await writer.finish()];
            let finished = false;
            try { await writer.finish(); } catch (e) { finished = /XzWriter is finished/.test(String(e?.message ?? e)); }
            for (const handle of [writer, options]) await handle.delete();
            const xz = Uint8Array.from(parts.flatMap((part) => Array.from(part)));
            return [Array.from(xz.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join(''), await decode(xz), await decode(fixture), finished];
        }, ['fd377a585a00', true, true, true]);
        // Option<u64> and Option<&[u8]> parameters through lzma-rust2. LzmaWriter writes its
        // expected size into the .lzma header; the expected bytes are lzma-rust2's own output run
        // natively, and the xz CLI decodes them. Lzma2Reader reads raw LZMA2 that liblzma 5.8.3
        // encoded against a preset dictionary: it decodes with that dictionary and is rejected
        // without one.
        add('crate:lzmaOptional', async () => {
            const bytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
            const fromHex = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
            const toHex = (data) => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
            const body = bytes('crossbind '.repeat(64));
            const lzma = async (endMarker, size) => {
                const options = await LzmaOptions.withPreset(6);
                const writer = await new LzmaWriter(options, true, endMarker, size);
                const parts = [await writer.write(body.subarray(0, 100)), await writer.write(body.subarray(100)), await writer.finish()];
                for (const handle of [writer, options]) await handle.delete();
                return toHex(Uint8Array.from(parts.flatMap((part) => Array.from(part))));
            };
            const decode = async (hex, dict) => {
                const reader = await new Lzma2Reader(fromHex(hex), 1 << 16, dict);
                try { return String.fromCharCode(...await reader.readAll()); } catch { return 'rejected'; } finally { await reader.delete(); }
            };
            const dict = bytes('crossbind preset dictionary: the quick brown fox jumps over the lazy dog. ');
            const withDict = 'c0005e000b5d00b1b28ac4bbf3289cf6000000';
            const noDict = 'e0005e004d5d003a1a08ce76c7e5e9d60734c3d10ebfce55e1aabde0e48f9801dd8de507549e65255f273a6a7eb4d3490389c12cfaedd637886688ba7a8f787cc7208778cd2389d725621aaf083665fa321cb80000';
            return [await lzma(false, 640n), await lzma(true, null), await decode(withDict, dict), await decode(withDict, null), await decode(noDict, null)];
        }, [
            '5d00008000800200000000000000319c8a2301640a4db63433829d7cde304546e000',
            '5d00008000ffffffffffffffff00319c8a2301640a4db63433829d7cde30516d3bfffffa1d8000',
            'the quick brown fox jumps over the lazy dog. crossbind preset dictionary: the quick brown fox. ',
            'rejected',
            'the quick brown fox jumps over the lazy dog. crossbind preset dictionary: the quick brown fox. ',
        ]);
        // An Option<NonZeroU64> parameter: XzOptions.setBlockSize. The writer raises the block size
        // to the dictionary size, 256 KiB at preset 0, so 600 000 bytes make three blocks at 256 KiB
        // and one without a size (as `xz -lvv` counts lzma-rust2's native output). The count is read
        // from the stream's own index; 0 is rejected before the call.
        add('crate:nonZero', async () => {
            const unit = Uint8Array.from('crossbind ', (c) => c.charCodeAt(0));
            const input = new Uint8Array(600000);
            for (let i = 0; i < input.length; i += unit.length) input.set(unit.subarray(0, input.length - i), i);
            const blocks = (xz) => {
                const backward = new DataView(xz.buffer, xz.byteOffset, xz.byteLength).getUint32(xz.length - 8, true);
                let at = xz.length - 12 - (backward + 1) * 4 + 1;
                let count = 0;
                for (let shift = 0; ; shift += 7) {
                    const b = xz[at++];
                    count += (b & 0x7f) * 2 ** shift;
                    if (b < 0x80) return count;
                }
            };
            const compress = async (blockSize) => {
                const options = await XzOptions.withPreset(0);
                await options.setBlockSize(blockSize);
                const writer = await new XzWriter(options);
                const parts = [await writer.write(input), await writer.finish()];
                for (const handle of [writer, options]) await handle.delete();
                return Uint8Array.from(parts.flatMap((part) => Array.from(part)));
            };
            const split = await compress(262144n);
            const reader = await new XzReader(split, false);
            const back = await reader.readAll();
            await reader.delete();
            const options = await XzOptions.withPreset(0);
            let zero = 'accepted';
            try { await options.setBlockSize(0n); } catch (e) { zero = String(e?.message ?? e); }
            await options.delete();
            return [blocks(split), blocks(await compress(null)), back.length === input.length && back.every((b, i) => b === input[i]), zero.includes('NonZeroU64 cannot be 0')];
        }, [3, 1, true, true]);
        // A 7-argument constructor: LzmaReader::new(reader, uncomp_size, lc, lp, pb, dict_size,
        // preset_dict). The .lzma fixture is the xz CLI's (XZ Utils 5.8.3); its 13-byte header gives
        // the arguments, read here per the format, and swapping lc and pb breaks the decode.
        add('crate:lzmaReader', async () => {
            const lzma = Uint8Array.from('5d00008000ffffffffffffffff00319c8a2301640a4db63433829d7cde30516d3bfffffa1d8000'.match(/../g), (h) => parseInt(h, 16));
            const header = new DataView(lzma.buffer, lzma.byteOffset, 13);
            const props = header.getUint8(0);
            const [lc, lp, pb] = [props % 9, Math.floor(props / 9) % 5, Math.floor(props / 45)];
            const dictSize = header.getUint32(1, true);
            const size = header.getBigUint64(5, true);
            const decode = async (lcArg, pbArg) => {
                let reader;
                try {
                    reader = await new LzmaReader(lzma.subarray(13), size, lcArg, lp, pbArg, dictSize, null);
                    return String.fromCharCode(...await reader.readAll());
                } catch {
                    return 'rejected';
                } finally {
                    await reader?.delete();
                }
            };
            return [size, await decode(lc, pb) === 'crossbind '.repeat(64), await decode(pb, lc)];
        }, [18446744073709551615n, true, 'rejected']);
    }));

    section(list, 'jsLive', 'JsValue/JsFunction need a synchronous runtime (worker-backed legs cannot pass functions or keep identity)', s.jsLive && (() => {
        const { jsPass, jsProbe, jsCall, jsStore, jsFire } = s.jsLive;
        add('live:identity', () => { const o = { a: 1 }; return jsPass(o) === o; }, true);
        add('live:getSet', () => {
            const o = { a: 21 };
            const r = jsProbe(o);
            return [r === o, o.b, o.note];
        }, [true, 42, 'set-by-rust']);
        add('live:callback', () => jsCall((x) => ({ doubled: x * 2 }), 3.5), { doubled: 7 });
        add('live:callbackThrow', () => {
            try { jsCall(() => { throw new Error('cb boom'); }, 1); return 'no-throw'; } catch (e) {
                return String(e?.message ?? e).includes('cb boom');
            }
        }, true);
        add('live:retainedCallback', () => { jsStore((x) => x + 100); return jsFire(7); }, 107);
    }));

    // Worker legs pass handles and instances back through the adapter's object registry; only JS
    // functions cannot cross, and identity/vector shapes differ as in the cpp section.
    section(list, 'pointers', 'no pointer surface wired on this leg', s.pointers && (() => pointerChecks({ add }, s.pointers, { worker })));
    section(list, 'callbacks', 'no callback surface wired on this leg', s.callbacks && (() => callbackChecks({ add, skip }, s.callbacks, { worker })));
    section(list, 'strings', 'no string surface wired on this leg', s.strings && (() => stringChecks({ add }, s.strings)));
    section(list, 'wrappers', 'no wrapper surface wired on this leg', s.wrappers && (() => wrapperChecks({ add }, s.wrappers, { worker })));
    section(list, 'types', 'no type surface wired on this leg', s.types && (() => typeChecks({ add }, s.types, { worker })));
    section(list, 'packageFields', 'no package header surface wired on this leg (standalone builds bridge only paths.header)', s.packageFields && (() => packageFieldChecks({ add }, s.packageFields, { worker })));
    section(list, 'constants', 'no header import on this leg (constants bind only for the names an app imports)', s.constants && (() => constantChecks({ add }, s.constants, { native: Boolean(s.caps?.jsiNative) })));
    section(list, 'extras', 'no header import on this leg (variadic functions, macros and mutable globals bind only for the names an app imports)', (s.extras || s.extrasWhole) && (() => extrasChecks({ add }, s.extras ?? s.extrasWhole, { byName: Boolean(s.extras) })));
    section(list, 'rustKit', 'no Rust kit surface wired on this leg', s.rustKit && (() => {
        rustNumberChecks({ add, todo, skip }, s.rustKit);
        rustStringChecks({ add, todo }, s.rustKit);
        rustCollectionChecks({ add, todo }, s.rustKit);
        rustTypeChecks({ add, todo, skip }, s.rustKit);
        rustErrorChecks({ add, todo }, s.rustKit);
        rustOwnershipChecks({ add, todo }, s.rustKit);
        rustSurfaceChecks({ add, todo, skip }, s.rustKit, { worker });
        rustParityChecks({ add, todo, skip }, s.rustKit, { worker, jsi: Boolean(s.caps?.jsiNative) });
    }));
    // Last on purpose: it reads what every earlier check touched.
    section(list, 'coverage', 'no export list wired on this leg', s.coverage && (() => add('coverage:everyExportTouched', () => untouchedExports(s.coverage.exports, s.coverage.seen), [])));
    return list;
}

const encode = (v) => JSON.stringify(v, (key, x) => (typeof x === 'bigint' ? `${x}n` : x));

// Checks like rust:arcShared read a process-wide counter and assert on its delta, so two
// runs overlapping in the same runtime read each other's drops. React StrictMode double-invokes
// effects in dev, which is exactly how that happens - serialize instead of interleaving, so a
// leg that starts the kit twice still measures one run at a time.
let inFlight = Promise.resolve();

export function runConformance(surfaces) {
    const result = inFlight.then(() => runChecks(surfaces));
    inFlight = result.catch(() => {});
    return result;
}

async function runChecks(surfaces) {
    const lines = [];
    let pass = 0;
    let run = 0;
    let skipped = 0;
    let todos = 0;
    for (const check of buildChecks(surfaces)) {
        if (check.skip) {
            skipped += 1;
            lines.push(`SKIP ${check.name} (${check.skip})`);
            continue;
        }
        let got;
        let error;
        try {
            got = await check.run();
        } catch (e) {
            error = e?.message ?? e;
        }
        const ok = error === undefined && (check.expected === undefined || encode(got) === encode(check.expected));
        const detail = error === undefined ? `${check.name}=${encode(got)}` : `${check.name} ERR:${error}`;
        if (check.todo && !ok) {
            todos += 1;
            lines.push(`TODO ${detail}`);
            continue;
        }
        run += 1;
        if (ok) pass += 1;
        // A todo that passes is ready to become a plain check.
        lines.push(`${ok ? 'OK' : 'NO'} ${detail}${check.todo ? ' (todo passes: promote it)' : ''}`);
    }
    const counts = [skipped ? `skipped: ${skipped}` : '', todos ? `todo: ${todos}` : ''].filter(Boolean);
    const summary = `CONFORMANCE ${pass}/${run}${counts.length ? ` (${counts.join(', ')})` : ''}`;
    return { pass, run, skipped, todos, summary, lines };
}
