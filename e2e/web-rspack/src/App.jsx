import React from "react";
import { useEffect, useState } from "react";
import { initNative, Native } from './native/native.h';
// Conformance kit: every documented C++/Rust feature as one shared data-driven list.
import { runConformance } from '@crossbind/conformance/spec/run.mjs';
import { ConfBox, ConfCircle, ConfOps } from '@crossbind/conformance/native/conformance.h';
// The pointer, callback, string, wrapper and type rules: one namespace per kit header.
import * as confPointers from '@crossbind/conformance/native/confpointers.h';
import * as confCallbacks from '@crossbind/conformance/native/confcallbacks.h';
import * as confText from '@crossbind/conformance/native/conftext.h';
import * as confWrappers from '@crossbind/conformance/native/confwrappers.h';
import * as confTypes from '@crossbind/conformance/native/conftypes.h';
import * as confTypes2 from '@crossbind/conformance/native/conftypes2.h';
import * as confKindA from '@crossbind/conformance/native/confkinda.h';
import * as confKindB from '@crossbind/conformance/native/confkindb.h';
import * as confPrelude from '@crossbind/conformance/native/confprelude.h';
import * as confPreludeDeps from '@crossbind/conformance/native/confpreludedeps.h';
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
import "./App.css";

let started = false;

function App() {
	const [message, setMessage] = useState("compiling ...");
	const [threadResult, setThreadResult] = useState("...");
	const [conf, setConf] = useState("conformance: running ...");

    // No ops_JSPI here: this playground builds the mt (pthreads) browser
    // runtime, which cannot carry -sJSPI, so the JSPI demo binding is guarded
    // out of the build. The mt demo is the thread roundtrip below.
    // useEffect, not render-body: re-renders must not start concurrent init chains
    // (two interleaved conformance runs race the shared drop counter). An empty dep list is
    // not enough - StrictMode deliberately double-invokes effects in dev - so the guard lives
    // at module scope.
    useEffect(() => {
    if (started) return;
    started = true;
    initNative().then(async () => {
        await Native.runOnThread();
        setMessage("ready (pthreads)");
        // Await before setState: rendering a pending thenable child suspends the whole
        // tree in React 19, which blanks all three paragraphs under load.
        setTimeout(async () => {
            setThreadResult(await Native.getThreadResult());
        }, 1000);

        // Shared conformance list. The mt runtime here is WORKER-BACKED (comlink proxy;
        // the seemingly-sync thread demo above only renders because React 19 resolves
        // thenable children), so worker semantics apply and live-JS stays a SKIP.
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
            setConf(firstBad ? `${result.summary} | ${firstBad}` : result.summary);
        } catch (e) {
            setConf(`CONFORMANCE ERR: ${e?.message ?? e}`);
        }
    });
    }, []);

	return (
        <div className="App">
			<p>crossbind module &nbsp;&nbsp;=&gt;&nbsp;&nbsp; {message}</p>
            <p>Thread result &nbsp;&nbsp;:&nbsp;&nbsp;  {threadResult}</p>
            <p id="conf">{conf}</p>
		</div>
	);
}

export default App;
