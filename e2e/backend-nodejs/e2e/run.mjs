// CurlProbe.run_JSPI needs WebAssembly.Suspending, which Node still gates behind
// --experimental-wasm-jspi; without it the glue aborts at boot ("JSPI not
// supported by current environment").
import { execFile } from 'node:child_process';
import { curlProbeMismatch, startCurlProbeServer } from '../../config/curl-probe-server.mjs';

// Shared conformance list: pass must equal run (backreference); skips are explicit lines.
const conformance = /^CONFORMANCE (\d+)\/\1\b.*$/m;

const server = await startCurlProbeServer();
const env = { ...process.env, CURL_PROBE_URL: server.url, CURL_PROBE_DEAD_URL: server.deadUrl };

execFile('node', ['--experimental-wasm-jspi', 'src/index.mjs'], { timeout: 120000, env }, async (err, stdout, stderr) => {
    await server.close();
    const out = `${stdout}\n${stderr}`;
    if (err) {
        console.error(out);
        console.error('run failed:', err.message);
        process.exit(1);
    }
    // Node's main thread cannot block, so curl waits for fetch by suspending (JSPI).
    const mismatch = curlProbeMismatch(out, { blocking: false });
    if (mismatch) {
        console.error(mismatch);
        process.exit(1);
    }
    if (!conformance.test(out)) {
        console.error(`conformance failed:\n${out}`);
        process.exit(1);
    }
    console.log('ok: curl probe');
    console.log('ok:', out.match(conformance)[0]);
});
