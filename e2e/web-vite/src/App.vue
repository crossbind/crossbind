<script setup>
import { ref } from 'vue'
import { initNative, Native } from './native/native.h'
// Rust package import: same proxy-module shape as the .h flow, served by the vite plugin.
import { initNative as initRustDemo, RustyCounter, Gauge, doubleIt, greet, parseEven, tag } from '@crossbind/embind-rust-demo'
import * as confRust from '@crossbind/conformance-rust'
// Two more DIRECT crate imports: semver (class-typed param via matches) and regex (throwing ctor).
import { initNative as initSemver, Version, VersionReq } from 'cargo:semver'
import { initNative as initRegex, Regex } from 'cargo:regex'
// DIRECT crate import: no surface file - bridged from the uuid crate's own source
// (declared in crossbind.config.js export.bindings.cargoDependencies).
import { initNative as initUuidCrate, Uuid } from 'cargo:uuid'
// App-local surface over upstream crates (geo + wkt): the same file the RN playground uses.
import { initNative as initHull, Hull } from './native/geo_surface.rs'
// Conformance kit: every documented C++/Rust feature as one shared data-driven list.
import { runConformance } from '@crossbind/conformance/spec/run.mjs'
import { ConfBox, ConfCircle, ConfOps } from '@crossbind/conformance/native/conformance.h'
// The pointer, callback, string, wrapper and type rules: one namespace per kit header.
import * as confPointers from '@crossbind/conformance/native/confpointers.h'
import * as confCallbacks from '@crossbind/conformance/native/confcallbacks.h'
import * as confText from '@crossbind/conformance/native/conftext.h'
import * as confWrappers from '@crossbind/conformance/native/confwrappers.h'
import * as confTypes from '@crossbind/conformance/native/conftypes.h'
import * as confTypes2 from '@crossbind/conformance/native/conftypes2.h'
import * as confKindA from '@crossbind/conformance/native/confkinda.h'
import * as confKindB from '@crossbind/conformance/native/confkindb.h'
import * as confPrelude from '@crossbind/conformance/native/confprelude.h'
import * as confPreludeDeps from '@crossbind/conformance/native/confpreludedeps.h'
import {
    Widget, Mode, RustIntVector, checkedParse,
    jsonEcho, jsonTally, jsonPick, SharedDoc, dupDoc, sharedDropCount,
} from '@crossbind/embind-rust-demo'

const message = ref("compiling ...")
const rust = ref("rust: compiling ...")
const conf = ref("conformance: running ...")

initNative().then(async () => {
    // await keeps this correct in both modes: with a worker every binding (including `new`,
    // via comlink's construct support) returns a Promise.
    message.value = await Native.sample();

    await initRustDemo();
    try {
        const c = await new RustyCounter(10);
        await c.increment(5);
        await c.increment(27);
        const current = await c.current();
        const scaled = await c.scale(2.5);
        await c.delete();
        // Idioms: &str param, Result -> rejected promise, Option<Self> -> null (worker mode too).
        const t = await RustyCounter.fromText(' 42 ');
        const lbl = await t.label('n=');
        await t.delete();
        let threw = '';
        try { await RustyCounter.fromText('nope'); } catch (e) { threw = e?.message ?? String(e); }
        const none = await RustyCounter.parseOpt('nope');
        // BigInt (i64/u64), Display -> toString (async in worker mode), free functions.
        const gg = await new Gauge(40);
        const gs = await gg.toString();
        await gg.delete();
        const big = await new RustyCounter(42);
        const isBig = (await big.addBig(1000000000000n)) === 1000000000042n;
        const isU64 = (await big.maxU64()) === 18446744073709551615n;
        await big.delete();
        const free = `${await doubleIt(21)}:${await greet('web')}`;
        // Optional returns: None arrives as undefined, Some as the plain value (worker mode too).
        const ob = await new RustyCounter(42);
        const optOk = (await ob.half()) === 21
            && (await ob.ratio(0)) === null
            && (await ob.maybeLabel()) === 'v42'
            && (await parseEven(' 8 ')) === 8
            && (await parseEven('7')) === null;
        await ob.delete();
        // Optional params (undefined/null -> None) and a class-typed param (&RustyCounter).
        const oc2 = await new RustyCounter(10);
        const optParamOk = (await oc2.bump(5)) === 15
            && (await oc2.bump(undefined)) === 16
            && (await oc2.bump(null)) === 17
            && (await tag('x')) === '[x]'
            && (await tag(undefined)) === '[none]';
        const od = await new RustyCounter(42);
        const refOk = (await od.diff(oc2)) === 25;
        await od.delete();
        await oc2.delete();
        // semver: VersionReq.matches(Version) across two crate-import classes.
        await initSemver();
        const req = await VersionReq.parse('>=1.2.3, <2');
        const v15 = await Version.parse('1.5.0');
        const v21 = await Version.parse('2.1.0');
        const svOk = (await req.matches(v15)) === true && (await req.matches(v21)) === false;
        await v15.delete(); await v21.delete(); await req.delete();
        let svThrew = '';
        try { await Version.parse('nope'); } catch (e) { svThrew = e?.message ?? String(e); }
        // regex: throwing ctor + isMatch.
        await initRegex();
        const re = await new Regex('^a+$');
        const reOk = (await re.isMatch('aaaa')) === true && (await re.isMatch('bbb')) === false;
        await re.delete();
        let reThrew = '';
        try { await new Regex('('); } catch (e) { reThrew = e?.message ?? String(e); }
        // Direct crate import: generate, format via Display, and reject bad input from JS.
        await initUuidCrate();
        const u = await Uuid.newV4();
        const us = await u.toString();
        await u.delete();
        const okV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(us);
        let uThrew = '';
        try { await Uuid.parseStr('nope'); } catch (e) { uThrew = e?.message ?? String(e); }
        // geo ConvexHull through the app-local surface: browser gets what upstream never shipped.
        await initHull();
        const h = await Hull.fromWkt('MULTIPOINT((0 0),(4 0),(0 4),(4 4),(2 2))');
        const hullOk = (await h.isValid()) && (await h.hullArea()) === 16 && (await h.hullWkt()).startsWith('POLYGON');
        await h.delete();
        rust.value = `rust current=${current} scale=${scaled} label=${lbl} err=${threw.includes('invalid digit')} none=${none === null}`
            + ` gstr=${gs} big=${isBig} u64=${isU64} free=${free} uuid=${okV4} uuidErr=${uThrew.includes('invalid')} hull=${hullOk} opt=${optOk}`
            + ` optP=${optParamOk} ref=${refOk} sv=${svOk && svThrew.includes('unexpected')} re=${reOk && reThrew.length > 0}`;
    } catch (e) {
        rust.value = `rust ERR: ${e?.message ?? e}`;
    }

    // Shared conformance list. This playground's runtime is worker-backed, so every check
    // resolves through the proxy (the list awaits every call) and the live-JS section stays
    // a documented SKIP: functions cannot cross the worker boundary.
    try {
        const result = await runConformance({
            cpp: { ConfBox, ConfCircle, ConfOps },
            rustPkg: {
                RustyCounter, Widget, Gauge, Mode, RustIntVector,
                doubleIt, greet, checkedParse, parseEven, tag,
                jsonEcho, jsonTally, jsonPick, SharedDoc, dupDoc, sharedDropCount,
            },
            rustAppLocal: { Hull },
            rustCrates: { Uuid, Version, VersionReq, Regex },
            jsLive: null,
            pointers: confPointers,
            callbacks: confCallbacks,
            strings: confText,
            wrappers: confWrappers,
            // The type checks reach across headers; the namespaces merge after initNative bound them.
            types: { ...confTypes, ...confTypes2, ...confKindA, ...confKindB, ...confPrelude, ...confPreludeDeps },
            rustKit: confRust,
            caps: { worker: true },
        });
        const firstBad = result.lines.find((l) => l.startsWith('NO'));
        if (firstBad) console.log(`CONF LINES:\n${result.lines.join('\n')}`);
        conf.value = firstBad ? `${result.summary} | ${firstBad}` : result.summary;
    } catch (e) {
        conf.value = `CONFORMANCE ERR: ${e?.message ?? e}`;
    }
});
</script>

<template>
  <p>Matrix multiplier with c++ &nbsp;&nbsp;=&gt;&nbsp;&nbsp;  {{message}}</p>
  <p id="rust">{{rust}}</p>
  <p id="conf">{{conf}}</p>
</template>
