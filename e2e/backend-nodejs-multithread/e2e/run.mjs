// CurlProbe.run_JSPI needs WebAssembly.Suspending, which Node still gates behind
// --experimental-wasm-jspi; without it the glue aborts at boot ("JSPI not
// supported by current environment"). Unlike the mt BROWSER targets, mt+JSPI
// works in Node: the main thread enters wasm through promising exports.
import { execFile } from 'node:child_process';
import { curlProbeMismatch, startCurlProbeServer } from '../../config/curl-probe-server.mjs';

const expected = /hello from thread/;
const fsync = /^FSYNC fsync=0 fdatasync=0 sqlite=kept$/m;
// Shared conformance list: pass must equal run (backreference); skips are explicit lines.
const conformance = /^CONFORMANCE (\d+)\/\1\b.*$/m;

const server = await startCurlProbeServer();
const env = { ...process.env, CURL_PROBE_URL: server.url, CURL_PROBE_DEAD_URL: server.deadUrl };

execFile('node', ['--experimental-wasm-jspi', '--expose-gc', 'src/index.mjs'], { timeout: 120000, env }, async (err, stdout, stderr) => {
    await server.close();
    const out = `${stdout}\n${stderr}`;
    if (err) {
        console.error(out);
        console.error('run failed:', err.message);
        process.exit(1);
    }
    if (!expected.test(out)) {
        console.error(`unexpected output:\n${out}`);
        process.exit(1);
    }
    // The probe runs on Node's main thread, which cannot block: curl suspends (JSPI).
    const mismatch = curlProbeMismatch(out, { blocking: false });
    if (mismatch) {
        console.error(mismatch);
        process.exit(1);
    }
    if (!conformance.test(out)) {
        console.error(`conformance failed:\n${out}`);
        process.exit(1);
    }
    if (!fsync.test(out)) {
        console.error(`fsync on a host file failed:\n${out}`);
        process.exit(1);
    }
    console.log('ok:', stdout.trim().split('\n').find((line) => expected.test(line)));
    console.log('ok: curl probe');
    console.log('ok: fsync');
    console.log('ok:', out.match(conformance)[0]);
});
