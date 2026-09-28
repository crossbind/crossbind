import initNative from '../dist/crossbind-e2e-backend-nodejs-native.native.cjs';
import { runConformance } from '@crossbind/conformance/spec/run.mjs';
import { kitExports } from '@crossbind/conformance/spec/bridgeExports.mjs';
import { trackExports } from '@crossbind/conformance/spec/coverage.mjs';

// The addon runs embind-jsi like React Native does: a synchronous runtime, so every section runs
// with the jsi expectations. Bundler-only surfaces (app-local .rs, cargo: imports) report as skips.
initNative().then(async (m) => {
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
            coverage: { exports: kitExports(new URL('../.crossbind/build/bridge/', import.meta.url).pathname), seen },
            caps: { jsiNative: true },
        });
        console.log(result.summary);
        if (result.pass !== result.run) console.log(result.lines.join('\n'));
    } catch (e) {
        console.error('CONFORMANCE ERR:', e?.message ?? e);
    }
});
