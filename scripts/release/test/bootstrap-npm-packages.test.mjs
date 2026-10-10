import assert from 'node:assert/strict';
import test from 'node:test';
import {
    approve,
    BOOTSTRAP_TAG,
    BOOTSTRAP_VERSION,
    isPlaceholderOnly,
    npmAuthorized,
    npmError,
    otpChallenge,
    placeholderManifest,
    publishCommand,
    selectPackages,
    trustCommand,
    trustListCommand,
    trustsReleaseWorkflow,
    trustTargets,
    versionsCommand,
    versionsOn,
    waitForApproval,
    waitUntilPublished,
} from '../bootstrap-npm-packages.mjs';

const candidate = (name) => ({
    name,
    version: '2.0.0-beta.62',
    manifest: { name, license: 'Zlib', repository: 'https://github.com/crossbind/crossbind.git' },
});

test('selects the workspace packages still waiting for their first release', () => {
    const candidates = [candidate('@crossbind/port-zlib-linux'), candidate('@crossbind/port-zlib-linuxmusl'), candidate('@crossbind/port-zlib-wasm')];
    const versions = {
        '@crossbind/port-zlib-linux': [],
        '@crossbind/port-zlib-linuxmusl': [BOOTSTRAP_VERSION],
        '@crossbind/port-zlib-wasm': [BOOTSTRAP_VERSION, '2.0.0-beta.62'],
    };

    const selected = selectPackages(candidates, { requested: [], isPending: (name) => isPlaceholderOnly(versions[name]) });

    assert.deepEqual(
        selected.map((entry) => entry.name),
        ['@crossbind/port-zlib-linux', '@crossbind/port-zlib-linuxmusl'],
    );
});

test('takes named packages as they are, and refuses a name the workspace does not publish', () => {
    const candidates = [candidate('@crossbind/port-zlib-linux'), candidate('@crossbind/port-zlib-wasm')];
    const isPending = () => false;

    assert.deepEqual(
        selectPackages(candidates, { requested: ['@crossbind/port-zlib-wasm'], isPending }).map((entry) => entry.name),
        ['@crossbind/port-zlib-wasm'],
    );
    assert.throws(() => selectPackages(candidates, { requested: ['@crossbind/port-nope'], isPending }), /@crossbind\/port-nope/);
});

test('the placeholder carries no code and sorts below every real release', () => {
    const manifest = placeholderManifest(candidate('@crossbind/port-zlib-linux'));

    assert.equal(manifest.version, BOOTSTRAP_VERSION);
    assert.match(BOOTSTRAP_VERSION, /^0\.0\.0-/);
    assert.equal(manifest.license, 'Zlib');
    assert.equal(manifest.repository, 'https://github.com/crossbind/crossbind.git');
    for (const field of ['main', 'exports', 'bin', 'files', 'scripts', 'dependencies']) assert.equal(manifest[field], undefined, field);
});

test('publishes under its own dist-tag, and trusts the release workflow for direct publish', () => {
    assert.deepEqual(publishCommand('/tmp/placeholder'), [
        'publish',
        '/tmp/placeholder',
        '--access',
        'public',
        '--tag',
        BOOTSTRAP_TAG,
        '--provenance=false',
        '--json',
    ]);
    assert.deepEqual(trustCommand('@crossbind/port-zlib-linux'), [
        'trust',
        'github',
        '@crossbind/port-zlib-linux',
        '--repo',
        'crossbind/crossbind',
        '--file',
        'release-crossbind.yml',
        '--env',
        'npm-release',
        '--allow-publish',
        '--yes',
        '--json',
    ]);
    assert.deepEqual(trustListCommand('@crossbind/port-zlib-linux'), ['trust', 'list', '@crossbind/port-zlib-linux', '--json']);
});

test('reads npm view: the versions, none for a name npm never published, or an error it will not guess about', () => {
    assert.deepEqual(versionsOn({ status: 0, stdout: '["0.0.0-bootstrap.0","2.0.0-beta.62"]', stderr: '' }), ['0.0.0-bootstrap.0', '2.0.0-beta.62']);
    assert.deepEqual(versionsOn({ status: 0, stdout: '"0.0.0-bootstrap.0"\n', stderr: '' }), ['0.0.0-bootstrap.0']);
    assert.deepEqual(versionsOn({ status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found' }), []);
    assert.throws(() => versionsOn({ status: 1, stdout: '', stderr: 'npm error code ETIMEDOUT' }), /ETIMEDOUT/);
});

test('asks npm past its cache, which keeps an earlier 404 after the first publish', () => {
    assert.deepEqual(versionsCommand('@crossbind/core-embind-napi'), [
        'view',
        '@crossbind/core-embind-napi',
        'versions',
        '--json',
        '--prefer-online',
    ]);
});

test('a name waits for its first release while it holds nothing, the placeholder or the stage npm publishes through', () => {
    assert.equal(isPlaceholderOnly([]), true);
    assert.equal(isPlaceholderOnly([BOOTSTRAP_VERSION]), true);
    assert.equal(isPlaceholderOnly([BOOTSTRAP_VERSION, '0.0.0-stage']), true);
    assert.equal(isPlaceholderOnly([BOOTSTRAP_VERSION, '0.0.0-stage', '2.0.0-beta.63']), false);
});

test('reads npm trust list: trusted only through the release workflow of this repository', () => {
    const config = (repository, file) => `${JSON.stringify({ type: 'github', repository, file, environment: 'npm-release' }, null, 2)}\n\n`;

    assert.equal(trustsReleaseWorkflow(''), false);
    assert.equal(trustsReleaseWorkflow(config('crossbind/crossbind', 'release-crossbind.yml')), true);
    assert.equal(trustsReleaseWorkflow(config('crossbind/crossbind', '.github/workflows/release-crossbind.yml')), true);
    assert.equal(trustsReleaseWorkflow(config('someone/else', 'release-crossbind.yml')), false);
    assert.equal(trustsReleaseWorkflow(config('crossbind/crossbind', 'other.yml') + config('crossbind/crossbind', 'release-crossbind.yml')), true);
});

const CHALLENGE = { authUrl: 'https://www.npmjs.com/auth/cli/0000', doneUrl: 'https://registry.npmjs.org/-/v1/done?authId=0000' };
const EOTP_OUTPUT = JSON.stringify({ error: { code: 'EOTP', summary: 'This operation requires a one-time password.', ...CHALLENGE } });

test('reads a 2FA prompt from npm --json output, and nothing else as one', () => {
    const preview = JSON.stringify({ package: '@crossbind/port-zlib-linux', type: 'github', permissions: ['package:create'] }, null, 2);

    assert.deepEqual(otpChallenge(EOTP_OUTPUT), CHALLENGE);
    assert.deepEqual(otpChallenge(`\n${preview}\n${JSON.stringify(JSON.parse(EOTP_OUTPUT), null, 2)}\n`), CHALLENGE);
    assert.equal(otpChallenge(JSON.stringify({ error: { code: 'E409', summary: 'Conflict' } })), null);
    assert.equal(otpChallenge('\n{\n  "type": "github"\n}\n\n{\n  "type": "github"\n}\n'), null);
    assert.equal(otpChallenge(''), null);
});

test("reports npm's own error: the JSON summary, or else its error lines", () => {
    const conflict = JSON.stringify({ error: { code: 'E409', summary: 'Conflict', detail: 'A configuration exists.' } });

    assert.equal(npmError({ stdout: conflict, stderr: '' }), 'Conflict A configuration exists.');
    assert.equal(
        npmError({ stdout: '', stderr: 'npm warn cli old node\nnpm error code E429\nnpm error Too many requests\n' }),
        'npm error code E429 npm error Too many requests',
    );
});

test('polls the 2FA approval until npm hands out the one-time password, returns none for an expired link, and gives up on an error or after ten minutes', async () => {
    const response = ({ status, retryAfter = null, body = {} }) => ({ status, headers: { get: () => retryAfter }, json: async () => body });
    const answers = [{ status: 202, retryAfter: '5' }, { status: 202 }, { status: 200, body: { token: 'otp' } }];
    const pauses = [];

    const token = await waitForApproval(CHALLENGE.doneUrl, { request: async () => response(answers.shift()), pause: async (ms) => pauses.push(ms) });

    assert.equal(token, 'otp');
    assert.deepEqual(pauses, [5000, 3000]);
    assert.equal(await waitForApproval(CHALLENGE.doneUrl, { request: async () => response({ status: 404 }), pause: async () => {} }), undefined);
    await assert.rejects(waitForApproval(CHALLENGE.doneUrl, { request: async () => response({ status: 500 }), pause: async () => {} }), /HTTP 500/);
    await assert.rejects(
        waitForApproval(CHALLENGE.doneUrl, { request: async () => response({ status: 202, retryAfter: '600' }), pause: async () => {} }),
        /not approved/,
    );
});

test('calls that hit the 2FA prompt together share one approval, and the next prompt opens a new one', async () => {
    let release;
    let waits = 0;
    const wait = () => {
        waits += 1;
        return new Promise((resolve) => {
            release = resolve;
        });
    };

    const first = approve(CHALLENGE, { wait });
    const second = approve(CHALLENGE, { wait });
    release('otp');
    assert.equal(await first, 'otp');
    assert.equal(await second, undefined);

    const third = approve(CHALLENGE, { wait });
    release('next');
    assert.equal(await third, 'next');
    assert.equal(waits, 2);
});

test('repeats a call npm stopped for 2FA with the approved password, asks again after an expired link, and gives up when npm keeps asking', async () => {
    const passwords = [];
    const run = async (args, otp) => {
        passwords.push(otp);
        return passwords.length < 3 ? { status: 1, stdout: EOTP_OUTPUT, stderr: '' } : { status: 0, stdout: '', stderr: '' };
    };
    const approvals = [undefined, 'otp'];

    const result = await npmAuthorized(trustListCommand('@crossbind/port-zlib-linux'), { run, approveChallenge: async () => approvals.shift() });

    assert.equal(result.status, 0);
    assert.deepEqual(passwords, [undefined, undefined, 'otp']);
    const failure = { status: 1, stdout: JSON.stringify({ error: { code: 'E409', summary: 'Conflict' } }), stderr: '' };
    assert.equal(await npmAuthorized(['trust'], { run: async () => failure, approveChallenge: async () => 'otp' }), failure);
    await assert.rejects(
        npmAuthorized(['trust'], { run: async () => ({ status: 1, stdout: EOTP_OUTPUT, stderr: '' }), approveChallenge: async () => 'otp' }),
        /still asks for 2FA/,
    );
});

test('a trust-only run checks the names that have a placeholder and leaves out the rest', () => {
    const [linux, linuxmusl, win32] = ['@crossbind/port-zlib-linux', '@crossbind/port-zlib-linuxmusl', '@crossbind/port-zlib-win32'].map(candidate);

    assert.deepEqual(trustTargets([linux, linuxmusl, win32], [win32], { trustOnly: false }), { targets: [linux, linuxmusl, win32], leftOut: [] });
    assert.deepEqual(trustTargets([linux, linuxmusl, win32], [win32], { trustOnly: true }), { targets: [linux, linuxmusl], leftOut: [win32] });
});

test('waits for a new package to show before trusting it, says so once, and gives up with the name', async () => {
    let checks = 0;
    let waits = 0;
    await waitUntilPublished('@crossbind/port-zlib-linux', {
        isPublished: () => ++checks >= 3,
        pause: async () => {},
        attempts: 5,
        onWait: () => waits++,
    });
    assert.equal(checks, 3);
    assert.equal(waits, 1);

    await waitUntilPublished('@crossbind/port-zlib-linux', { isPublished: () => true, onWait: () => waits++ });
    assert.equal(waits, 1);

    await assert.rejects(
        waitUntilPublished('@crossbind/port-zlib-linux', { isPublished: () => false, pause: async () => {}, attempts: 2 }),
        /@crossbind\/port-zlib-linux/,
    );
});
