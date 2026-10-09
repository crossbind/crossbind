import initNative from '../dist/crossbind-example-backend-nodejs-wasm-wasm-wasm32-mt-release.node.js';
import { runConformance } from '@crossbind/conformance/spec/run.mjs';
import { kitExports } from '@crossbind/conformance/spec/bridgeExports.mjs';
import { trackExports } from '@crossbind/conformance/spec/coverage.mjs';

function wait(ms, fn) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(fn());
        }, ms);
    });
}

initNative().then(async (m) => {
    const { Native } = m;
    try {
        Native.runOnThread();
        const threadResult = await wait(5000, () => Native.getThreadResult());

        console.log(threadResult);
    } catch (e) {
        console.error(e, e.message, e.stack);
    }

    // e2e/run.mjs starts the server the curl cases talk to; a plain `pnpm start` has none.
    if (process.env.CURL_PROBE_URL) {
        try {
            const report = await m.CurlProbe.run_JSPI(process.env.CURL_PROBE_URL, process.env.CURL_PROBE_DEAD_URL);
            console.log(`CURLPROBE ${JSON.stringify(report)}`);
        } catch (e) {
            console.error('CURLPROBE ERR:', e?.message ?? e);
        }
    }

    // Shared conformance list. The mt node runtime is still the direct module (pthreads
    // live in worker_threads, bindings stay synchronous on the main thread), so the full
    // direct surface runs - same shape as the st node leg.
    try {
        // Every kit export must be touched by a check: the proxy records what the checks read.
        const { proxy, seen } = trackExports(m);
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
            rustAppLocal: null,
            rustCrates: null,
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
            rustKit: proxy,
            extrasWhole: proxy,
            coverage: { exports: kitExports(new URL('../.crossbind/build/bridge/', import.meta.url).pathname), seen },
            caps: {},
        });
        console.log(result.summary);
        if (result.pass !== result.run) console.log(result.lines.join('\n'));
    } catch (e) {
        console.error('CONFORMANCE ERR:', e?.message ?? e);
    }
});
