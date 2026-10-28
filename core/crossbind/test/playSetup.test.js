import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// gcloud as it answers: what it is signed in to, whether the account is there, and a command that fails.
const calls = [];
const gcloud = {};
const spawnSync = vi.fn((program, args) => {
    calls.push(args);
    if (args[0] === 'config') return { status: 0, stdout: `${gcloud[args[2]]}\n` };
    if (args[2] === 'describe') return { status: gcloud.hasAccount ? 0 : 1 };
    return { status: gcloud.failing && args.join(' ').startsWith(gcloud.failing) ? 1 : 0 };
});
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));
const saved = {};
vi.mock('../src/utils/systemConfig.js', () => ({ updateSystemConfig: (values) => Object.assign(saved, values) }));
const answers = {};
vi.mock('../src/utils/ask.js', () => ({ askLine: async () => answers.lines.shift(), askYesNo: async () => answers.yes.shift() }));

const { setUpPlayAccount } = await import('../src/actions/playSetup.js');

const ACCOUNT = 'crossbind-play@crossbind.iam.gserviceaccount.com';

beforeEach(() => {
    calls.length = 0;
    Object.keys(saved).forEach((key) => delete saved[key]);
    Object.assign(gcloud, { account: 'me@example.com', project: 'crossbind', hasAccount: false, failing: null });
    Object.assign(answers, { lines: [], yes: [] });
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe("the service account Google Play takes uploads from", () => {
    test("is made in gcloud's project, whose tokens the user's gcloud login gets, so no key of it exists", async () => {
        answers.yes = [true];
        expect(await setUpPlayAccount()).toEqual({ account: ACCOUNT });
        expect(calls.filter(([command]) => command !== 'config')).toEqual([
            ['services', 'enable', 'androidpublisher.googleapis.com', 'iamcredentials.googleapis.com', '--project', 'crossbind'],
            ['iam', 'service-accounts', 'describe', ACCOUNT, '--project', 'crossbind'],
            ['iam', 'service-accounts', 'create', 'crossbind-play', '--display-name', 'crossbind app publish', '--project', 'crossbind'],
            ['iam', 'service-accounts', 'add-iam-policy-binding', ACCOUNT, '--member', 'user:me@example.com', '--role', 'roles/iam.serviceAccountTokenCreator', '--project', 'crossbind'],
        ]);
        expect(saved).toEqual({ GOOGLE_PLAY_SERVICE_ACCOUNT: ACCOUNT });
    });

    test('is the one made before, if there is one, and a failing gcloud step stops it', async () => {
        Object.assign(gcloud, { hasAccount: true, account: 'ci@other.iam.gserviceaccount.com' });
        answers.yes = [true];
        await setUpPlayAccount();
        expect(calls.some(([, , command]) => command === 'create')).toBe(false);
        expect(calls.at(-1)).toContain('serviceAccount:ci@other.iam.gserviceaccount.com');
        gcloud.failing = 'services enable';
        answers.yes = [true];
        await expect(setUpPlayAccount()).rejects.toThrow("crossbind: gcloud services enable failed; app.md's Publishing says how to set the service account up by hand");
        expect(saved).toEqual({ GOOGLE_PLAY_SERVICE_ACCOUNT: ACCOUNT });
    });

    test("is a JSON key the user names, where gcloud is not or the user says no", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-play-setup-'));
        const key = path.join(dir, 'play.json');
        fs.writeFileSync(key, JSON.stringify({ client_email: 'key@demo.iam.gserviceaccount.com', private_key: 'pem', token_uri: 'https://oauth2.example.test/token' }));
        gcloud.account = '';
        answers.lines = [key];
        expect(await setUpPlayAccount()).toMatchObject({ account: 'key@demo.iam.gserviceaccount.com', file: key });
        expect(saved).toEqual({ GOOGLE_PLAY_KEY: key });
        gcloud.account = 'me@example.com';
        answers.yes = [false];
        answers.lines = [path.join(dir, 'none.json')];
        await expect(setUpPlayAccount()).rejects.toThrow('which is no file');
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
