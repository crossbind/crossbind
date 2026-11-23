import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled } from '../src/compiled.js';
import { canRunPrebuilt, hasPrebuilt, loadPrebuilt } from '../src/prebuilt.js';
import { PAUSED, runOffReason } from '../src/runReason.js';

test('Run that cannot run says why: the compile the project needs, and what keeps the service from it', () => {
    const unreachable = 'The playground service cannot be reached right now.';
    assert.equal(runOffReason({ prebuilt: true, session: null }), null);
    assert.equal(runOffReason({ prebuilt: false, session: { enabled: true } }), null);
    assert.equal(runOffReason({ prebuilt: false, session: null }), 'This project needs a compile. The playground service has not answered yet.');
    assert.equal(runOffReason({ prebuilt: false, session: { error: unreachable } }), `This project needs a compile. ${unreachable}`);
    assert.equal(runOffReason({ prebuilt: false, session: { enabled: false } }), `This project needs a compile. ${PAUSED}`);
    assert.equal(
        runOffReason({ prebuilt: false, session: { error: unreachable }, canReset: true }),
        `This project needs a compile. ${unreachable} Reset your changes to run it without one.`,
    );
});

const PROJECT = Object.freeze({ files: { 'main.js': "import { greet } from './native/native.h';\n\nconsole.log(greet('a'));", 'native/native.h': 'h' }, packages: [] });
const WASM = [0, 97, 115, 109, 1, 0, 0, 0];
const IMPORTS = { natives: [{ file: 'src/native/native.h', specifiers: [], names: ['greet'] }] };
const dataUrl = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
// A module built ahead of time where its caller keeps it, as the site keeps its demos: here, in the addresses themselves.
const PREBUILT = Object.freeze({
    script: dataUrl('text/javascript', 'globalThis.Crossbind = {};'),
    wasm: dataUrl('application/wasm', WASM),
    imports: dataUrl('application/json', JSON.stringify(IMPORTS)),
});

test('the module its caller keeps for a sample runs the project while it serves it, and one with no import list never runs', () => {
    assert.equal(canRunPrebuilt(PREBUILT, PROJECT, PROJECT), true);
    assert.equal(canRunPrebuilt(PREBUILT, { ...PROJECT, files: { ...PROJECT.files, 'native/native.h': 'changed' } }, PROJECT), false);
    assert.equal(canRunPrebuilt(undefined, PROJECT, PROJECT), false);
    assert.equal(canRunPrebuilt({ ...PREBUILT, imports: undefined }, PROJECT, PROJECT), false);
    assert.equal(hasPrebuilt(PREBUILT), true);
    assert.equal(hasPrebuilt(undefined), false);
});

test('a prebuilt module loads from the addresses its caller gives, in the shape a compile answers with', async () => {
    assert.deepEqual(await loadPrebuilt(PREBUILT), { js: 'globalThis.Crossbind = {};', wasm: Buffer.from(WASM).toString('base64'), imports: IMPORTS });
});

test("a compile's answer gives the run its module, or what to tell its user with the build's log", () => {
    const module = { status: 200, ok: true, js: 'js', wasm: 'AGFzbQEAAAA=', imports: IMPORTS };
    assert.deepEqual(compiled(module), { module });
    assert.deepEqual(compiled({ status: 200, ok: false, reason: 'timeout', log: 'em++: killed' }), { notice: { text: 'The compile ran out of time.' }, log: 'em++: killed' });
    assert.deepEqual(compiled({ status: 200, ok: false, reason: 'unknown', log: '' }), { notice: { text: 'The build failed.' }, log: '' });
    assert.deepEqual(compiled({ status: 429, error: 'No compiles left today.', login: true }), { notice: { text: 'No compiles left today.', login: true } });
    assert.deepEqual(compiled({ status: 502 }), { notice: { text: 'The playground answered 502.', login: false } });
});
