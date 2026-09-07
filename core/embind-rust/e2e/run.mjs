// e2e: two legs. (1) WEB - build the demo crate to wasm, link with the web adapter, call the
// embind class from node. (2) MOBILE-SHAPE - build the same crate native, run it against a
// jsi-shaped mock consumer (validates the adapter's wrapping/marshalling/param-dropping; the
// real Hermes/device smoke is separate - see the README status matrix).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const emsdkEnv = process.env.CROSSBIND_EMSDK_ENV || '/Users/bugra/Documents/other/emsdk/emsdk_env.sh';
const sourceEmsdk = existsSync(emsdkEnv);

function sh(cmd, opts = {}) {
    const { env: extraEnv = {}, ...spawnOptions } = opts;
    const script = `${sourceEmsdk ? 'source "$CROSSBIND_E2E_EMSDK_ENV" >/dev/null 2>&1; ' : ''}${cmd}`;
    return execFileSync('bash', ['-c', script], {
        cwd: root,
        stdio: 'pipe',
        encoding: 'utf8',
        env: { ...process.env, CROSSBIND_E2E_EMSDK_ENV: emsdkEnv, ...extraEnv },
        ...spawnOptions,
    });
}

// emcc+node here instead of wasmtime; cargo is required.
try { execFileSync('cargo', ['--version'], { stdio: 'ignore' }); } catch {
    console.log('SKIP: cargo not found - install Rust + `rustup target add wasm32-unknown-emscripten`.');
    process.exit(0);
}
try { sh('emcc --version'); } catch {
    console.log('SKIP: emsdk not found on PATH and CROSSBIND_EMSDK_ENV does not name emsdk_env.sh.');
    process.exit(0);
}

// (0) BRIDGE GENERATION - the demo is plain Rust; the engine generates the companion bridge
// crate exactly as buildCargo does, and both legs below build/link THAT crate's staticlib.
sh('cd demo && node ../../crossbind/src/utils/rustBridgeGen.js');
const bridgeLib = (triple) => `demo/.crossbind/bridge-crate/target/${triple}/release/libdemo_crossbind_bridge.a`;

// (1) WEB
const wasmSysroot = process.env.CROSSBIND_E2E_RUST_SYSROOT;
const wasmEnv = wasmSysroot
    ? { CARGO_ENCODED_RUSTFLAGS: `--sysroot${String.fromCharCode(0x1f)}${wasmSysroot}` }
    : {};
sh('cargo build --release --target wasm32-unknown-emscripten -q --manifest-path demo/.crossbind/bridge-crate/Cargo.toml', { env: wasmEnv });
// whole-archive: no C++ trigger references the demo, so force its init-array ctor into the link.
sh(`em++ adapters/web.cpp -Wl,--whole-archive ${bridgeLib('wasm32-unknown-emscripten')} -Wl,--no-whole-archive -lembind -O1 -sMODULARIZE -sEXPORT_ES6 -o e2e/demo.mjs`);
// FORCE_COLOR off: the markers below match console.log values, which node would otherwise wrap in ANSI codes.
const web = execFileSync('node', ['e2e/use.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
// f64/bool (scale, positive) are verified here against real embind-js; the jsi-mock leg below
// covers int/string/smart-ptr shapes and doesn't re-marshal every primitive.
for (const m of ['current: 50', 'scale: 125', 'positive: true', 'mode: true', 'point.x: 50', 'sum: 7', 'vec: 2 20', 'void: undefined', 'describe: count=50', 'span 2..10', 'area: 36',
    'fromText: 42', 'label: n=42', 'checkedDiv: 21', 'checkedDiv0 threw: division by zero',
    'fromTextBad threw:', 'invalid digit', 'parseOpt none: null', 'parseOpt some: 7',
    'gaugeBad threw: level 101 out of range', 'gauge level: 40', 'gaugeStr: gauge(40)',
    'addBig: true', 'maxU64: true', 'doubleIt: 42', 'greet: hello rust',
    'checkedParse: 7', 'checkedParseBad threw:',
    'half: 21', 'ratio: 21', 'ratio0: undefined', 'maybeLabel: v42', 'half7: undefined',
    'parseEven: 8', 'parseEvenOdd: undefined',
    'bump5: 15', 'bumpU: 16', 'bumpN: 17', 'tag: [x]', 'tagU: [none]', 'tagN: [none]',
    'diff: 32',
    'jsonEcho: {"a":1,"list":[1,2.5,"x",null,true],"nested":{"k":"v"}}',
    'jsonTally: 6 true', 'jsonPick: [7]', 'jsonPick threw: missing key zz',
    'jsonSnapshot: 42 e2e',
    'arcLabel: arc', 'arcSame: true', 'arcHalfFree: 0', 'arcFullFree: 1',
    'jsIdentity: true', 'jsGetSet: true 42 set-by-rust', 'cbCall: {"doubled":7}',
    'cbThrow: true', 'cbStored: 107',
    'EMBIND-RS: PASS']) {
    if (!web.includes(m)) { console.error(`FAIL web: missing "${m}"\n${web}`); process.exit(1); }
}
console.log('ok web: rust producer -> flat ABI -> web adapter -> embind-js class');

// (2) MOBILE-SHAPE (host build: no --target, so the artifact sits under target/release directly)
sh('cargo build --release -q --manifest-path demo/.crossbind/bridge-crate/Cargo.toml');
const nativeBridge = 'demo/.crossbind/bridge-crate/target/release/libdemo_crossbind_bridge.a';
const keepNativeBridge = process.platform === 'darwin'
    ? `-Wl,-force_load,${nativeBridge}`
    : `-Wl,--whole-archive ${nativeBridge} -Wl,--no-whole-archive`;
sh(`c++ -std=c++17 e2e/jsi-shape-check.cpp ${keepNativeBridge} -o e2e/jsi-shape-check`);
const mob = execFileSync('./e2e/jsi-shape-check', { cwd: root, encoding: 'utf8' });
for (const m of ['current: 50', 'describe: count=50', 'span 2..10', 'area: 36', 'mode: 1',
    'fromText current: 42', 'label: n=42', 'checkedDiv raised: 1 msg: division by zero',
    'fromText raised: 1 null: 1', 'invalid digit', 'parseOpt null: 1 raised: 0',
    'gauge raised: 1 null: 1', 'gauge level: 40', 'gaugeStr: gauge(40)',
    'addBig: 1000000000042', 'maxU64: 18446744073709551615', 'doubleIt: 42',
    'greet: hello rust', 'checkedParse: 7', 'checkedParse raised: 1',
    'half cell: 21', 'maybeLabel: v42', 'half7 null: 1',
    'NATIVE MOBILE-SHAPED (jsi adapter): PASS']) {
    if (!mob.includes(m)) { console.error(`FAIL mobile-shape: missing "${m}"\n${mob}`); process.exit(1); }
}
console.log('ok mobile-shape: rust producer -> flat ABI -> jsi adapter -> jsi-shaped consumer');
console.log('embind-rust e2e: PASS (web tested; mobile shape-validated, device smoke pending)');
