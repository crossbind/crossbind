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
const VERSION = '2.0.0-beta.80';
const DEVICE_CODE = 'D'.repeat(43);
const DEVICE = {
    device_code: DEVICE_CODE, user_code: 'NPCC-CNQN', verification_uri: `${URL_}/device`, expires_in: 600, interval: 5,
};
const SIGNED_IN = { access_token: TOKEN, token_type: 'Bearer', account: { id: '1099511627777', name: 'octocat' } };
const QUESTION = 'crossbind: once you approve, the page shows a number: type it here (one try): ';
// An answer of the device sign-in's token route, as RFC 8628 words a refusal.
const refusal = (error, words = `the words of ${error}`) => [400, { error, error_description: words }];
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
    // What a person at a terminal answers to each question, in turn, and the questions asked.
    const typing = (...answers) => {
        const questions = [];
        return { questions, ask: async (question) => { questions.push(question); return answers.shift(); } };
    };
    const at = (fetcher, more = {}) => ({
        url: URL_, version: VERSION, file, fetcher, sleep: async () => {}, print: () => {}, isTerminal: () => true, ...typing('47'), ...more,
    });

    test('shows the code and the cloud\'s own page, asks for the number once the code is approved, and keeps the token for this address only', async () => {
        save({ 'https://staging.example.dev': { token: 'cbt_other', login: 'someone' } });
        const { fetcher, calls } = server([[200, DEVICE], refusal('authorization_pending'), refusal('matching_required'), [200, SIGNED_IN]]);
        const person = typing('47');
        const waits = [];
        const printed = [];

        const result = await login(at(fetcher, { ...person, sleep: async (ms) => { waits.push(ms); }, print: (line) => printed.push(line) }));

        expect(result).toEqual({ login: 'octocat' });
        expect(printed).toEqual([`crossbind: open ${URL_}/device and enter the code NPCC-CNQN to sign in with GitHub or Apple.`]);
        expect(person.questions).toEqual([QUESTION]);
        // The number goes at once, as its person typed it: no wait after the question.
        expect(waits).toEqual([5000, 5000]);
        expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`POST ${URL_}/v1/device/authorize`, ...Array(3).fill(`POST ${URL_}/v1/device/token`)]);
        expect(calls.map((call) => call.body)).toEqual([
            { client: 'cli', version: VERSION }, { device_code: DEVICE_CODE }, { device_code: DEVICE_CODE }, { device_code: DEVICE_CODE, match: 47 },
        ]);
        expect(saved()).toEqual({
            'https://staging.example.dev': { token: 'cbt_other', login: 'someone' }, [URL_]: { token: TOKEN, login: 'octocat' },
        });
        if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });

    test('asks again for a number that is not two digits, so that a slip spends no try, and sends the number once', async () => {
        const { fetcher, calls } = server([[200, DEVICE], refusal('matching_required'), [200, SIGNED_IN]]);
        const person = typing('4', 'forty-seven', '07', ' 47 ');

        await login(at(fetcher, person));

        expect(person.questions).toEqual([QUESTION, ...Array(3).fill('crossbind: type the two digits the page shows: ')]);
        expect(calls.slice(1).map((call) => call.body)).toEqual([{ device_code: DEVICE_CODE }, { device_code: DEVICE_CODE, match: 47 }]);
    });

    test('stops with the words the cloud gives, a wrong number included, and keeps nothing', async () => {
        const wrong = server([[200, DEVICE], refusal('matching_required'), refusal('access_denied', 'The number did not match, and the code no longer works; start again.')]);
        const busy = server([[429, { error: 'slow_down', error_description: 'Too many sign-ins are starting right now; try again in a minute.' }]]);
        const unset = server([[503, { error: 'temporarily_unavailable', error_description: 'Signing in is not set up.' }]]);

        await expect(login(at(wrong.fetcher))).rejects.toThrow('crossbind: The number did not match, and the code no longer works; start again.');
        await expect(login(at(busy.fetcher))).rejects.toThrow('crossbind: Too many sign-ins are starting right now; try again in a minute.');
        await expect(login(at(unset.fetcher))).rejects.toThrow('crossbind: Signing in is not set up.');
        expect(fs.existsSync(file)).toBe(false);
    });

    test('refuses a sign-in page off the cloud\'s own origin, and a token not shaped like one, and keeps nothing', async () => {
        const pages = ['https://api.crossbind.dev.evil.example/device', 'https://github.com/login/device', 'http://api.crossbind.dev/device', 'not a page'];
        for (const page of pages) {
            await expect(login(at(server([[200, { ...DEVICE, verification_uri: page }]]).fetcher))).rejects.toThrow(`crossbind: crossbind cloud sent a sign-in page that is not its own, at ${URL_}.`);
        }
        const malformed = server([[200, DEVICE], refusal('matching_required'), [200, { ...SIGNED_IN, access_token: 'cbt_short' }]]);

        await expect(login(at(malformed.fetcher))).rejects.toThrow(/token/);
        expect(fs.existsSync(file)).toBe(false);
    });

    test('never polls faster than every 5 seconds, and waits five seconds more each time it is told to slow down', async () => {
        const { fetcher } = server([[200, { ...DEVICE, interval: 0 }], refusal('slow_down'), refusal('authorization_pending'), refusal('slow_down'), refusal('matching_required'), [200, SIGNED_IN]]);
        const waits = [];

        await login(at(fetcher, { sleep: async (ms) => { waits.push(ms); } }));

        expect(waits).toEqual([5000, 10000, 10000, 15000]);
    });

    test('sends the number once: a cloud that asks for it again gets no second number and no second question', async () => {
        const { fetcher, calls } = server([[200, DEVICE], refusal('matching_required'), refusal('matching_required', 'Asked again.')]);
        const person = typing('47', '48');

        await expect(login(at(fetcher, person))).rejects.toThrow('crossbind: Asked again.');
        expect(person.questions).toEqual([QUESTION]);
        expect(calls.filter((call) => call.body?.match !== undefined)).toHaveLength(1);
    });

    test('stops before it asks the cloud for anything when no terminal is there to type the number', async () => {
        const { fetcher, calls } = server([]);

        await expect(login(at(fetcher, { isTerminal: () => false }))).rejects.toThrow('crossbind: crossbind login asks for a number: run it in a terminal.');
        expect(calls).toEqual([]);
    });

    test('revokes the token it replaces once the new one is kept', async () => {
        const previous = `cbt_${'b'.repeat(43)}`;
        save({ [URL_]: { token: previous, login: 'octocat' } });
        const { fetcher, calls } = server([[200, DEVICE], refusal('matching_required'), [200, SIGNED_IN], [204]]);

        await login(at(fetcher));

        expect(calls[3]).toMatchObject({ method: 'DELETE', url: `${URL_}/v1/token`, headers: { authorization: `Bearer ${previous}` } });
        expect(saved()[URL_].token).toBe(TOKEN);
    });

    test('prints no control characters from the cloud\'s answers', async () => {
        const { fetcher } = server([[200, { ...DEVICE, user_code: 'NPCC\u001b[2J-CNQN' }], refusal('matching_required'), [200, { ...SIGNED_IN, account: { id: '1', name: 'octo\u0007cat' } }]]);
        const printed = [];

        const result = await login(at(fetcher, { print: (line) => printed.push(line) }));

        expect(printed.join('\n')).toContain('NPCC[2J-CNQN');
        expect(printed.join(' ')).not.toMatch(/\p{Cc}/u);
        expect(result.login).toBe('octocat');
    });

    test('gives up once the code has expired, even if the cloud keeps saying not yet', async () => {
        const { fetcher } = server([[200, { ...DEVICE, expires_in: 12 }], ...Array(5).fill(refusal('authorization_pending'))]);
        let clock = 0;

        const attempt = login(at(fetcher, { now: () => clock, sleep: async (ms) => { clock += ms; } }));

        await expect(attempt).rejects.toThrow('crossbind: the code expired before it was approved; run crossbind login again.');
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
        const { fetcher } = server([[200, DEVICE], refusal('matching_required'), [200, SIGNED_IN]]);

        await login({
            url: URL_, version: VERSION, file, fetcher, sleep: async () => {}, print: () => {}, isTerminal: () => true, ask: async () => '47',
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

    test('tells a new account the day cloud builds open to it, worded without a locale, and an answer out of its form as before', () => {
        const fresh = {
            login: 'Apple account …7777',
            builds: {
                month: '2026-11', limitSeconds: 0, usedSeconds: 0, byImage: {}, opensOn: '2026-12-20',
            },
            playground: { limit: 20, remaining: 20 },
        };

        expect(usageLines(fresh)).toEqual([
            'Signed in as Apple account …7777.',
            'Cloud builds open to this account on 20 December 2026, or as soon as a GitHub account is linked.',
            'Playground: 20 of 20 compiles left today.',
        ]);
        expect(usageLines({ ...fresh, builds: { ...fresh.builds, opensOn: '2026-13-20' } })[1]).toBe('Cloud builds in 2026-11: 0s of 0s used, 0s left.');
    });
});
