const initNative = require('../dist/crossbind-example-backend-nodejs-wasm-wasm-wasm32-st-release.node.bundle.js');

function wait(ms, fn) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(fn());
        }, ms);
    });
}

initNative().then(async ({ CurlProbe }) => {
    // e2e/run.mjs starts the server the curl cases talk to; a plain run has none.
    if (!process.env.CURL_PROBE_URL) return;
    try {
        const report = await CurlProbe.run_JSPI(process.env.CURL_PROBE_URL, process.env.CURL_PROBE_DEAD_URL);
        console.log(`CURLPROBE ${JSON.stringify(report)}`);
    } catch (e) {
        console.error('CURLPROBE ERR:', e?.message ?? e);
    }
});
