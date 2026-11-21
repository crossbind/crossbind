// A compile, checked against a crossbind cloud that is up, staging by default: a test client signs in as the crossbind
// app with one code approved on the cloud's device page, compiles the playground's function sample with its token
// (`POST /playground/compile`, as the app's extension sends one), and prints the status, the seconds and the module that
// came back; the same compile again must come from the cache; then the token is signed out. A comment of the run's own
// keeps the first compile from an earlier run's cache. It spends one of the account's compiles of the day, and prints
// no token, key or source.
// usage: node scripts/compile-check.mjs [--url https://api-staging.crossbind.dev]
import { randomBytes } from 'node:crypto';
import { CLIENT, deviceClient } from './device-client.mjs';

const DEFAULT_URL = 'https://api-staging.crossbind.dev';
// The cache keeps a compile once it is answered, by a write of its own: a moment for it before the same compile again.
const CACHE_WRITE_MS = 2000;
const WASM_MAGIC = '\0asm';

const at = process.argv.indexOf('--url');
const url = new URL(at === -1 ? DEFAULT_URL : process.argv[at + 1]).origin;
const { call, signIn } = deviceClient(url);
const results = [];
function check(name, ok, detail) {
    results.push(ok);
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}\n`);
}

// The playground's function sample, as its page sends it.
const PROJECT = Object.freeze({
    files: {
        'main.js': "import { initNative, greet, add } from './native/native.h';\n\nawait initNative();\n\nconsole.log(await greet('crossbind'));\nconsole.log('2 + 3 =', await add(2, 3));\n",
        'native/native.h': '#pragma once\n\n#include <string>\n\n// A function declared here is a function in JavaScript.\nstd::string greet(const std::string &name);\nint add(int a, int b);\n',
        'native/native.cpp': `#include "native.h"\n\nstd::string greet(const std::string &name) {\n    return "Hello, " + name + "!";\n}\n\nint add(int a, int b) {\n    return a + b;\n}\n\n// compile-check ${randomBytes(8).toString('hex')}\n`,
    },
    packages: [],
});

// The compile with the app's token: its status, its seconds, its answer and the module in it, and a refusal's words:
// crossbind's, or where no JSON of crossbind's came back, the title of the page that did instead.
async function compile(token) {
    const started = performance.now();
    const response = await fetch(`${url}/playground/compile`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(PROJECT), redirect: 'error',
    });
    const text = await response.text();
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    let answer = {};
    try {
        answer = JSON.parse(text);
    } catch {
        // No JSON of crossbind's: its words come from the page below.
    }
    const page = (/<title>([^<]*)<\/title>/i.exec(text)?.[1] ?? text).replace(/\s+/g, ' ').trim().slice(0, 120);
    const words = answer.error ?? (answer.ok === false ? 'the build failed' : (response.ok ? '' : page));
    const wasm = Buffer.from(typeof answer.wasm === 'string' ? answer.wasm : '', 'base64');
    return {
        status: response.status, seconds, answer, words, wasm,
    };
}
const hasModule = ({ status, answer, wasm }) => status === 200 && answer.ok === true && typeof answer.js === 'string' && answer.js.length > 0
    && wasm.subarray(0, WASM_MAGIC.length).toString('latin1') === WASM_MAGIC;
const told = ({ status, seconds, words }) => `${status} in ${seconds} s${words ? `: ${words}` : ''}`;

const started = await call('POST', '/v1/device/authorize', { body: CLIENT });
if (started.status !== 200) throw new Error(`${url} answered the start with ${started.status}: ${JSON.stringify(started.body)}`);
process.stdout.write(`open ${started.body.verification_uri} signed in as the account to check, and enter the code ${started.body.user_code}; approve it, then type here the number the page shows\n`);
const { signed, refused } = await signIn(started.body);
check('the test client signs in as the crossbind app', signed !== undefined, signed ? signed.account.name : refused?.error_description);
if (signed) {
    const token = signed.access_token;
    const first = await compile(token);
    check('a compile of the playground\'s function sample with the app\'s token answers a module', hasModule(first) && first.answer.cached !== true,
        hasModule(first) ? `${told(first)}, ${first.wasm.length} bytes of WebAssembly, ${first.answer.remaining} compiles left today` : told(first));
    await new Promise((resolve) => { setTimeout(resolve, CACHE_WRITE_MS); });
    const again = await compile(token);
    check('the same compile again comes from the cache, with the same module', hasModule(again) && again.answer.cached === true && again.answer.wasm === first.answer.wasm,
        `${told(again)}, ${again.answer.cached === true ? 'from the cache' : 'not from the cache'}`);
    const signedOut = await call('DELETE', '/v1/token', { token });
    const after = await call('GET', '/v1/account', { token });
    check('the token is signed out', signedOut.status === 204 && after.status === 401, `${signedOut.status}, then ${after.status}`);
}
const passed = results.filter(Boolean).length;
process.stdout.write(`${passed}/${results.length} checks pass\n`);
process.exitCode = results.length > 0 && passed === results.length ? 0 : 1;
