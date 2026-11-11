import assert from 'node:assert/strict';
import test from 'node:test';
import {
    approve,
    approveRenewal,
    BOOTSTRAP_TAG,
    BOOTSTRAP_VERSION,
    isPlaceholderOnly,
    npmAuthorized,
    npmError,
    otpChallenge,
    placeholderManifest,
    publishCommand,
    releaseWorkflowTrusts,
    revokeCommand,
    selectPackages,
    setTrust,
    settleTrusts,
    sortTrusts,
    trustCommand,
    trustListCommand,
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
    assert.deepEqual(revokeCommand('@crossbind/port-zlib-linux', 'abc'), ['trust', 'revoke', '@crossbind/port-zlib-linux', '--id=abc', '--json']);
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

test('reads npm trust list: every configuration of the release workflow of this repository, with its id', () => {
    const config = (id, repository, file) => `${JSON.stringify({ id, type: 'github', repository, file, environment: 'npm-release' }, null, 2)}\n\n`;
    const ids = (output) => releaseWorkflowTrusts(output).map(({ id }) => id);

    assert.deepEqual(ids(''), []);
    assert.deepEqual(ids(config('a', 'crossbind/crossbind', 'release-crossbind.yml')), ['a']);
    assert.deepEqual(ids(config('a', 'crossbind/crossbind', '.github/workflows/release-crossbind.yml')), ['a']);
    assert.deepEqual(ids(config('a', 'someone/else', 'release-crossbind.yml')), []);
    assert.deepEqual(ids(config('a', 'crossbind/crossbind', 'other.yml') + config('b', 'crossbind/crossbind', 'release-crossbind.yml')), ['b']);
    assert.deepEqual(ids(config('a', 'crossbind/crossbind', 'release-crossbind.yml') + config('b', 'crossbind/crossbind', 'release-crossbind.yml')), [
        'a',
        'b',
    ]);
});

test('a trust that has published nothing is set anew, as npm expires it and keeps listing it; a trust that has published is left alone', () => {
    const [waiting, released, bareWaiting, bareReleased] = ['waiting', 'released', 'bare-waiting', 'bare-released'].map((name) =>
        candidate(`@crossbind/${name}`),
    );
    const trusts = new Map([
        [waiting, [{ id: 'a' }]],
        [released, [{ id: 'b' }]],
        [bareWaiting, []],
        [bareReleased, []],
    ]);
    const isPending = (name) => [waiting.name, bareWaiting.name].includes(name);

    assert.deepEqual(sortTrusts([waiting, released, bareWaiting, bareReleased], trusts, isPending), {
        unvalidated: [waiting],
        inPlace: [released],
        missing: [bareWaiting, bareReleased],
    });
});

test('sets a trust after revoking every configuration listed for it, pausing before each call as npm asks', async () => {
    const name = '@crossbind/port-zlib-linux';
    const record = async (configs) => {
        const calls = [];
        const pauses = [];
        await setTrust(name, configs, { run: async (_, step) => calls.push(step), pause: async (ms) => pauses.push(ms) });
        return { calls, pauses };
    };

    assert.deepEqual(await record([{ id: 'old' }, { id: 'older' }]), {
        calls: [revokeCommand(name, 'old'), revokeCommand(name, 'older'), trustCommand(name)],
        pauses: [2000, 2000, 2000],
    });
    assert.deepEqual(await record([]), { calls: [trustCommand(name)], pauses: [2000] });
});

test('sets no trust when npm refuses to revoke the old one', async () => {
    const calls = [];
    const run = async (_, step) => {
        calls.push(step[1]);
        throw new Error('npm refused');
    };

    await assert.rejects(setTrust('@crossbind/port-zlib-linux', [{ id: 'old' }], { run, pause: async () => {} }), /npm refused/);
    assert.deepEqual(calls, ['revoke']);
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

test('renews only after the maintainer has seen the names and answered yes, and an empty answer is no', async () => {
    const answer = async (line) => {
        const printed = [];
        const isApproved = await approveRenewal(['@crossbind/a', '@crossbind/b'], {
            canAsk: true,
            question: async () => line,
            print: (text) => printed.push(text),
        });
        return { isApproved, printed };
    };

    assert.deepEqual(await answer('y'), { isApproved: true, printed: ['  @crossbind/a', '  @crossbind/b'] });
    assert.equal((await answer('YES ')).isApproved, true);
    assert.equal((await answer('')).isApproved, false);
    assert.equal((await answer('n')).isApproved, false);
    assert.equal((await answer('maybe')).isApproved, false);
});

test('renews nothing where nobody can answer unless --yes says so, and asks nothing when there is nothing to renew', async () => {
    const question = async () => assert.fail('asked');
    const print = () => {};

    await assert.rejects(approveRenewal(['@crossbind/a'], { canAsk: false, question, print }), /no terminal[\s\S]*--yes/);
    assert.equal(await approveRenewal(['@crossbind/a'], { yes: true, canAsk: false, question, print }), true);
    assert.equal(await approveRenewal([], { canAsk: true, question, print }), true);
});

const settle = async ({ apply = true, yes = false, isApproved = true, stillPending = async () => true } = {}) => {
    const [waiting, released, bare] = ['waiting', 'released', 'bare'].map((name) => candidate(`@crossbind/${name}`));
    const trusts = new Map([
        [waiting, [{ id: 'a' }]],
        [released, [{ id: 'b' }]],
        [bare, []],
    ]);
    const written = [];
    const asked = [];
    await settleTrusts([waiting, released, bare], new Set(), (name) => name !== released.name, {
        apply,
        yes,
        read: async () => trusts,
        askApproval: async (names, options) => {
            asked.push({ names, ...options });
            return isApproved;
        },
        write: async (name, configs) => written.push([name, configs.map(({ id }) => id)]),
        stillPending,
    });
    return { written, asked };
};

test('once approved, renews the trust of a name waiting for its first release, sets a missing one and never touches a published one', async () => {
    assert.deepEqual(await settle(), {
        written: [
            ['@crossbind/waiting', ['a']],
            ['@crossbind/bare', []],
        ],
        asked: [{ names: ['@crossbind/waiting'], yes: false }],
    });
});

test('when the maintainer declines, revokes nothing and still sets a missing trust', async () => {
    assert.deepEqual((await settle({ isApproved: false })).written, [['@crossbind/bare', []]]);
});

test('passes --yes on to the approval', async () => {
    assert.deepEqual((await settle({ yes: true })).asked, [{ names: ['@crossbind/waiting'], yes: true }]);
});

test('writes nothing and asks nothing without --apply', async () => {
    assert.deepEqual(await settle({ apply: false }), { written: [], asked: [] });
});

test('keeps the trust of a name that has published since the check, as that trust has just been validated', async () => {
    assert.deepEqual((await settle({ stillPending: async () => false })).written, [['@crossbind/bare', []]]);
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
