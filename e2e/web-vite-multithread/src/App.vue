<script setup>
import { ref } from 'vue'
import { initNative, Native } from './native/native.h'
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
    initNative as initRustDemo,
    RustyCounter, Widget, Gauge, Mode, RustIntVector,
    doubleIt, greet, checkedParse, parseEven, tag,
    jsonEcho, jsonTally, jsonPick, SharedDoc, dupDoc, sharedDropCount,
} from '@crossbind/embind-rust-demo'
import * as confRust from '@crossbind/conformance-rust'

const message = ref("compiling ...")
const threadResult = ref("...")
const instanceResult = ref("...")
const constructResult = ref("...")
const conf = ref("conformance: running ...")

initNative({ useWorker: true }).then(async (A) => {
    message.value = "ready (worker + pthreads)";
    await Native.runOnThread();
    threadResult.value = await Native.getThreadResult();

    // Instance methods through the worker proxy: statics skip embind's
    // `this` conversion, so only instance calls cover identity handling.
    // joinTags takes a plain array on purpose (vector coercion).
    const counter = await A.Counter.create(40);
    await counter.increment(1);
    await counter.increment(1);
    const described = await counter.describe("count");
    const joined = await counter.joinTags(["a", "b"]);
    instanceResult.value = `${described} ${joined}`;

    // `new` through the worker proxy (Comlink CONSTRUCT): embind's prototype
    // identity check used to reject this path, so cover it separately from
    // the static factory above.
    const constructed = await new A.Counter(20);
    await constructed.increment(1);
    constructResult.value = await constructed.describe("ctor");

    // Shared conformance list: worker + pthreads, so worker contracts apply (vector
    // returns arrive as arrays, enum identity rides the transfer-handler tokens) and
    // live-JS stays a documented skip.
    try {
        await initRustDemo();
        const result = await runConformance({
            cpp: { ConfBox, ConfCircle, ConfOps },
            rustPkg: {
                RustyCounter, Widget, Gauge, Mode, RustIntVector,
                doubleIt, greet, checkedParse, parseEven, tag,
                jsonEcho, jsonTally, jsonPick, SharedDoc, dupDoc, sharedDropCount,
            },
            rustAppLocal: null,
            rustCrates: null,
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
  <p>crossbind module &nbsp;&nbsp;=&gt;&nbsp;&nbsp;  {{message}}</p>
  <p>Thread result &nbsp;&nbsp;:&nbsp;&nbsp;  {{threadResult}}</p>
  <p>Instance result &nbsp;&nbsp;:&nbsp;&nbsp;  {{instanceResult}}</p>
  <p>Construct result &nbsp;&nbsp;:&nbsp;&nbsp;  {{constructResult}}</p>
  <p id="conf">{{conf}}</p>
</template>
