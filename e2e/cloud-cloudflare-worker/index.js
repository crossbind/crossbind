import initNative from './dist/crossbind-e2e-cloud-cloudflare-worker-wasm-wasm32-st-release.edge.js';
import wasmContent from './dist/crossbind-e2e-cloud-cloudflare-worker-wasm-wasm32-st-release.edge.wasm';
import { runConformance } from '@crossbind/conformance/spec/run.mjs';

// globalThis.WorkerGlobalScope = undefined;

// Workers forbid random generation in global scope, and the Rust stdlib's wasm ctors call
// random_get at module init - so the whole boot (and the conformance run) is deferred into
// the first request instead of top-level await.
let bootPromise = null;

function boot() {
    if (!bootPromise) bootPromise = bootNow();
    return bootPromise;
}

async function bootNow() {
    const m = await initNative({ getWasmFunction: () => wasmContent });

    // Shared conformance list. The edge runtime is the direct module (no worker layer), so
    // the full direct surface runs, live-JS included; bundler-only Rust models stay skips.
    const conformance = await runConformance({
    cpp: { ConfBox: m.ConfBox, ConfCircle: m.ConfCircle, ConfOps: m.ConfOps },
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
    rustAppLocal: null,
    rustCrates: null,
        jsLive: {
            jsPass: m.jsPass,
            jsProbe: m.jsProbe,
            jsCall: m.jsCall,
            jsStore: m.jsStore,
            jsFire: m.jsFire,
        },
        pointers: m,
        callbacks: m,
        strings: m,
        wrappers: m,
        types: m,
        rustKit: m,
        caps: {},
    });

    return { m, conformance };
}

export default {
    async fetch(request, env, ctx) {
        const { m, conformance } = await boot();
        const z = m.Native.sample();
        const detail = conformance.pass === conformance.run ? '' : `\n${conformance.lines.join('\n')}`;

        return new Response(`- ${z} - | ${conformance.summary}${detail}`);
    },
};
