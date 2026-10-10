import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    deleteAccount, login, logout, fetchUsage, usageLines,
} from '../src/actions/cloudCommands.js';
import { DEFAULT_CLOUD_URL, cloudUrl, cloudCredentials } from '../src/utils/cloudAccount.js';

const URL_ = 'https://api.crossbind.dev';
const TOKEN = `cbt_${'a'.repeat(43)}`;
const DEVICE = {
    deviceCode: 'the-device-code', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5,
};
const USAGE = {
    login: 'octocat',
    builds: { month: '2026-10', limitSeconds: 3600, usedSeconds: 754.25, byImage: { web: 694.25, android: 60 } },
    playground: { limit: 100, remaining: 97 },
};

// Answers each request with the next of `answers` ([status, body]), and records what was asked.
function server(answers) {
    const calls = [];
    const fetcher = async (url, init = {}) => {
        calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body && JSON.parse(init.body) });
        const [status, body] = answers.shift();
        return new Response(body === undefined ? null : JSON.stringify(body), { status });
    };
    return { fetcher, calls };
}

let dir;
let file;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cloud-'));
    file = path.join(dir, '.crossbind', 'credentials.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const saved = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const save = (entries) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(entries));
};

describe('cloudUrl', () => {
    test('is crossbind cloud unless the config or the environment names another', () => {
        expect(cloudUrl({}, {})).toBe(DEFAULT_CLOUD_URL);
        expect(cloudUrl({ CLOUD_URL: 'https://staging.example.dev/' }, {})).toBe('https://staging.example.dev');
        expect(cloudUrl({ CLOUD_URL: 'https://staging.example.dev' }, { CROSSBIND_CLOUD_URL: 'http://localhost:8686' })).toBe('http://localhost:8686');
    });

    test('refuses plain http to another machine, since the token travels with every call', () => {
        expect(() => cloudUrl({ CLOUD_URL: 'http://cloud.example.dev' }, {})).toThrow(/https/);
        expect(() => cloudUrl({}, { CROSSBIND_CLOUD_URL: 'not a url' })).toThrow(/CROSSBIND_CLOUD_URL/);
    });

    test('is an origin alone: no user name, path or query rides along', () => {
        expect(cloudUrl({ CLOUD_URL: 'https://API.Example.dev:443' }, {})).toBe('https://api.example.dev');
        ['https://user:pass@cloud.example.dev', 'https://cloud.example.dev/api', 'https://cloud.example.dev?x=1', 'https://cloud.example.dev/#x'].forEach((url) => {
            expect(() => cloudUrl({ CLOUD_URL: url }, {})).toThrow(/origin/);
        });
    });
});

describe('crossbind login', () => {
    test('shows the GitHub code, waits for its approval at the pace asked and keeps the token for this address only', async () => {
        save({ 'https://staging.example.dev': { token: 'cbt_other', login: 'someone' } });
        const { fetcher, calls } = server([[200, DEVICE], [202, { pending: true }], [202, { pending: true, interval: 10 }], [200, { token: TOKEN, login: 'octocat' }]]);
        const waits = [];
        const printed = [];

        const result = await login({
            url: URL_, file, fetcher, sleep: async (ms) => { waits.push(ms); }, print: (line) => printed.push(line),
        });

        expect(result).toEqual({ login: 'octocat' });
        expect(printed.join('\n')).toContain('https://github.com/login/device');
        expect(printed.join('\n')).toContain('WDJB-MJHT');
        expect(waits).toEqual([5000, 5000, 10000]);
        expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
            `POST ${URL_}/v1/login/device`, ...Array(3).fill(`POST ${URL_}/v1/login/token`),
        ]);
        expect(calls[1].body).toEqual({ deviceCode: 'the-device-code' });
        expect(saved()).toEqual({
            'https://staging.example.dev': { token: 'cbt_other', login: 'someone' }, [URL_]: { token: TOKEN, login: 'octocat' },
        });
        if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });

    test('stops with the reason the cloud gives and keeps nothing', async () => {
        const tooNew = server([[200, DEVICE], [403, { error: 'This GitHub account is too new.' }]]);
        const unavailable = server([[503, { error: 'Signing in with GitHub is not set up.' }]]);
        const options = { url: URL_, file, sleep: async () => {}, print: () => {} };

        await expect(login({ ...options, fetcher: tooNew.fetcher })).rejects.toThrow('This GitHub account is too new.');
        await expect(login({ ...options, fetcher: unavailable.fetcher })).rejects.toThrow('Signing in with GitHub is not set up.');
        expect(fs.existsSync(file)).toBe(false);
    });

    test('refuses a sign-in page off github.com and a token not shaped like one, and keeps nothing', async () => {
        const options = { url: URL_, file, sleep: async () => {}, print: () => {} };
        const elsewhere = server([[200, { ...DEVICE, verificationUri: 'https://github.com.evil.example/login/device' }]]);
        const malformed = server([[200, DEVICE], [200, { token: 'cbt_short', login: 'octocat' }]]);

        await expect(login({ ...options, fetcher: elsewhere.fetcher })).rejects.toThrow(/github\.com/);
        await expect(login({ ...options, fetcher: malformed.fetcher })).rejects.toThrow(/token/);
        expect(fs.existsSync(file)).toBe(false);
    });

    test('never polls faster than every 5 seconds, whatever interval it is told', async () => {
        const { fetcher } = server([[200, { ...DEVICE, interval: 0 }], [202, { pending: true, interval: -1 }], [202, { pending: true, interval: 'soon' }], [200, { token: TOKEN, login: 'octocat' }]]);
        const waits = [];

        await login({
            url: URL_, file, fetcher, sleep: async (ms) => { waits.push(ms); }, print: () => {},
        });

        expect(waits).toEqual([5000, 5000, 5000]);
    });

    test('revokes the token it replaces once the new one is kept', async () => {
        const previous = `cbt_${'b'.repeat(43)}`;
        save({ [URL_]: { token: previous, login: 'octocat' } });
        const { fetcher, calls } = server([[200, DEVICE], [200, { token: TOKEN, login: 'octocat' }], [204]]);

        await login({
            url: URL_, file, fetcher, sleep: async () => {}, print: () => {},
        });

        expect(calls[2]).toMatchObject({ method: 'DELETE', url: `${URL_}/v1/token`, headers: { authorization: `Bearer ${previous}` } });
        expect(saved()[URL_].token).toBe(TOKEN);
    });

    test('prints no control characters from the cloud\'s answers', async () => {
        const { fetcher } = server([[200, { ...DEVICE, userCode: 'WDJB\u001b[2J-MJHT' }], [200, { token: TOKEN, login: 'octo\u0007cat' }]]);
        const printed = [];

        const result = await login({
            url: URL_, file, fetcher, sleep: async () => {}, print: (line) => printed.push(line),
        });

        expect(printed.join('\n')).toContain('WDJB[2J-MJHT');
        expect(printed.join(' ')).not.toMatch(/\p{Cc}/u);
        expect(result.login).toBe('octocat');
    });

    test('gives up once the code has expired, even if the cloud keeps saying not yet', async () => {
        const { fetcher } = server([[200, { ...DEVICE, expiresIn: 12 }], ...Array(5).fill([202, { pending: true }])]);
        let clock = 0;

        const attempt = login({
            url: URL_, file, fetcher, now: () => clock, sleep: async (ms) => { clock += ms; }, print: () => {},
        });

        await expect(attempt).rejects.toThrow(/expired/);
    });
});

describe('crossbind logout', () => {
    test('revokes this machine\'s token, or every token of the account, and forgets it here', async () => {
        save({ [URL_]: { token: TOKEN, login: 'octocat' } });
        const one = server([[204]]);

        expect(await logout({ url: URL_, file, fetcher: one.fetcher })).toEqual({ login: 'octocat', revoked: true });
        expect(one.calls[0]).toMatchObject({ method: 'DELETE', url: `${URL_}/v1/token`, headers: { authorization: `Bearer ${TOKEN}` } });
        expect(saved()).toEqual({});

        save({ [URL_]: { token: TOKEN, login: 'octocat' } });
        const all = server([[204]]);
        await logout({ url: URL_, all: true, file, fetcher: all.fetcher });
        expect(all.calls[0].url).toBe(`${URL_}/v1/tokens`);
    });

    test('forgets the token here even when the cloud cannot revoke it, and says so', async () => {
        save({ [URL_]: { token: TOKEN, login: 'octocat' } });
        const fetcher = async () => { throw new TypeError('fetch failed'); };

        expect(await logout({ url: URL_, file, fetcher })).toEqual({ login: 'octocat', revoked: false, reason: expect.stringContaining('fetch failed') });
        expect(cloudCredentials(URL_, file)).toBeNull();
    });

    test('has nothing to do without a sign-in', async () => {
        expect(await logout({ url: URL_, file, fetcher: server([]).fetcher })).toBeNull();
    });
});

describe('crossbind account delete', () => {
    test('deletes the account the machine is signed in to, then forgets the sign-in', async () => {
        save({ [URL_]: { token: TOKEN, login: 'octocat' } });
        const { fetcher, calls } = server([[204]]);

        expect(await deleteAccount({ url: URL_, file, fetcher })).toEqual({ login: 'octocat' });
        expect(calls[0]).toMatchObject({ method: 'DELETE', url: `${URL_}/v1/account`, headers: { authorization: `Bearer ${TOKEN}` } });
        expect(saved()).toEqual({});
    });

    test('keeps the sign-in and says why when the cloud deletes nothing', async () => {
        await expect(deleteAccount({ url: URL_, file, fetcher: server([]).fetcher })).rejects.toThrow(/crossbind login/);
        save({ [URL_]: { token: TOKEN, login: 'octocat' } });
        await expect(deleteAccount({ url: URL_, file, fetcher: server([[401, { error: 'Sign in with crossbind login.' }]]).fetcher })).rejects.toThrow(/crossbind login/);
        expect(saved()).toEqual({ [URL_]: { token: TOKEN, login: 'octocat' } });
    });
});

describe('crossbind usage', () => {
    test('asks the cloud with this machine\'s token', async () => {
        save({ [URL_]: { token: TOKEN, login: 'octocat' } });
        const { fetcher, calls } = server([[200, USAGE]]);

        expect(await fetchUsage({ url: URL_, file, fetcher })).toEqual(USAGE);
        expect(calls[0]).toMatchObject({ method: 'GET', url: `${URL_}/v1/usage`, headers: { authorization: `Bearer ${TOKEN}` } });
    });

    test('reads an answer that is not an object as no answer', async () => {
        save({ [URL_]: { token: TOKEN, login: 'octocat' } });

        await expect(fetchUsage({ url: URL_, file, fetcher: server([[500, null]]).fetcher })).rejects.toThrow('crossbind cloud answered 500.');
    });

    test('writes the sign-in as a new file, never through a link at its place', async () => {
        if (process.platform === 'win32') return;
        const elsewhere = path.join(dir, 'elsewhere.json');
        fs.writeFileSync(elsewhere, '{}');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.symlinkSync(elsewhere, file);
        const { fetcher } = server([[200, DEVICE], [200, { token: TOKEN, login: 'octocat' }]]);

        await login({
            url: URL_, file, fetcher, sleep: async () => {}, print: () => {},
        });

        expect(fs.readFileSync(elsewhere, 'utf8')).toBe('{}');
        expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.readdirSync(path.dirname(file))).toEqual(['credentials.json']);
    });

    test('asks for a sign-in when there is none or the cloud no longer accepts it', async () => {
        await expect(fetchUsage({ url: URL_, file, fetcher: server([]).fetcher })).rejects.toThrow(/crossbind login/);
        save({ [URL_]: { token: TOKEN, login: 'octocat' } });
        await expect(fetchUsage({ url: URL_, file, fetcher: server([[401, { error: 'Sign in with crossbind login.' }]]).fetcher })).rejects.toThrow(/crossbind login/);
    });

    test('reads as minutes used and left this month, by image, and compiles left today', () => {
        expect(usageLines(USAGE)).toEqual([
            'Signed in as octocat.',
            'Cloud builds in 2026-10: 12m 34s of 60m used, 47m 26s left.',
            '  web       11m 34s',
            '  android   1m',
            'Playground: 97 of 100 compiles left today.',
        ]);
        expect(usageLines({ ...USAGE, builds: { ...USAGE.builds, usedSeconds: 3700, byImage: { web: 3700 } } })[1])
            .toBe('Cloud builds in 2026-10: 61m 40s of 60m used, 0s left.');
    });
});
