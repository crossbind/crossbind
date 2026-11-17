import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: { general: { name: 'demo' }, app: {}, paths: {}, system: {} }, targets: [] };
vi.mock('../src/utils/appExtensions.js', async (importOriginal) => (await import('./ownTools.js')).default(importOriginal));
vi.mock('../src/state/index.js', () => ({ default: state }));
// The test's config stands for crossbind.config.js's export, which an extension's api shows.
vi.mock('../src/state/loadConfig.js', async (importOriginal) => ({ ...await importOriginal(), exportOf: (config) => config }));
// Play has seen `highest` at most, and releases what it is given, or answers `result`; the keychain keeps the Google
// sign-in `kept`.
const play = {};
vi.mock('../../../extensions/google-play/src/googlePlay.js', () => ({
    PLAY: { key: 'CROSSBIND_GOOGLE_PLAY_KEY', serviceAccount: 'CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT', token: 'CROSSBIND_GOOGLE_PLAY_TOKEN' },
    playCredentials: () => play.credentials,
    keptSignIn: async () => play.kept,
    highestVersionCode: async () => {
        const answer = play.answers.length > 0 ? play.answers.shift() : play.highest;
        if (answer instanceof Error) throw answer;
        return answer;
    },
    uploadBundle: async (appId, credentials, options) => {
        play.uploads.push({ appId, credentials, ...options });
        return play.result ?? { versionCode: Number(vite.env.CROSSBIND_APP_BUILD_NUMBER), status: options.status };
    },
    sendListing: async (appId, credentials, options) => {
        play.sends.push({ appId, credentials, ...options });
        return play.sent ?? { listed: [], isDetailed: false, isDeclared: false };
    },
    playTracks: async () => play.tracks,
}));
const signing = {};
vi.mock('../src/actions/uploadKey.js', () => ({
    releaseSigningEnv: async () => signing,
    makeUploadKey: async () => {
        signing.made += 1;
        signing.isSigned = true;
    },
}));
// The user at the terminal, if there is one, typing these lines and answering these yeses and nos.
const terminal = {};
vi.mock('../src/utils/ask.js', () => ({
    hasTerminal: () => terminal.isThere,
    askLine: async () => terminal.lines.shift() ?? '',
    askYesNo: async () => terminal.yes.shift() ?? true,
}));
// The Google sign-ins the user makes when asked, one per question, none once they run out.
const setup = {};
vi.mock('../../../extensions/google-play/src/playSetup.js', () => ({
    signInToPlay: async (api, question) => {
        setup.questions.push(question);
        return setup.signIns.shift() ?? null;
    },
}));
const opened = [];
vi.mock('../src/utils/openUrl.js', () => ({ default: (url) => opened.push(url) }));
vi.mock('../src/utils/systemConfig.js', () => ({ default: () => ({}) }));

const { playRelease, rolloutPercent } = await import('../../../extensions/google-play/crossbind.extension.js');
const { default: publish } = await import('../src/actions/publish.js');
const { default: storeGuide } = await import('../src/actions/storeGuide.js');

let base;
let printed;
// Vite builds the app as the plugin does: its Gradle project, the bundle beside it, and where it went.
const vite = {};
async function runVite(args, env) {
    Object.assign(vite, { args, env, runs: vite.runs + 1 });
    if (vite.exitCode) return vite.exitCode;
    const project = path.join(base, 'dist', 'demo-android');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(`${project}.aab`, 'bundle');
    fs.writeFileSync(`${project}-symbols.zip`, 'symbols');
    fs.mkdirSync(state.config.paths.build, { recursive: true });
    fs.writeFileSync(path.join(state.config.paths.build, 'app-outputs.json'), JSON.stringify({
        android: { project, apk: null, bundle: `${project}.aab`, symbols: `${project}-symbols.zip` },
    }));
    return 0;
}
// `crossbind app publish google-play` with these options.
const publishAndroid = (args) => publish(['google-play', ...args], { runVite });
const KEY = { CROSSBIND_ANDROID_KEYSTORE: '/keys/upload.p12', CROSSBIND_ANDROID_KEY_ALIAS: 'upload', CROSSBIND_ANDROID_KEYSTORE_PASSWORD: 'kept' };

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-publish-'));
    Object.assign(state.config, { app: { id: 'dev.example.demo' }, extensions: [], package: { version: '1.2.3' }, paths: { project: base, build: path.join(base, '.crossbind', 'build') } });
    Object.assign(play, {
        credentials: { account: 'play@demo.iam.gserviceaccount.com' }, kept: null, highest: 1002005, answers: [], result: null, uploads: [], sends: [], sent: null, tracks: [],
    });
    Object.assign(signing, { env: KEY, isSigned: true, made: 0 });
    Object.assign(terminal, { isThere: false, lines: [], yes: [] });
    Object.assign(setup, { questions: [], signIns: [] });
    opened.length = 0;
    Object.assign(vite, { args: null, env: null, runs: 0, exitCode: 0 });
    printed = [];
    vi.spyOn(console, 'log').mockImplementation((line) => printed.push(line));
    vi.stubEnv('CROSSBIND_APP_BUILD_NUMBER', '');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(base, { recursive: true, force: true });
});

describe('publishing an Android app', () => {
    test('builds the next versionCode Play takes, signed, and uploads its bundle to the track', async () => {
        await publishAndroid(['--track', 'internal', '--mode', 'production']);

        expect(vite.args).toEqual(['build', '--mode', 'production']);
        expect(vite.env).toMatchObject({ ...KEY, CROSSBIND_APP_PLATFORM: 'android', CROSSBIND_APP_BUILD_NUMBER: '1002006' });
        expect(play.uploads).toEqual([{
            appId: 'dev.example.demo',
            credentials: play.credentials,
            aab: path.join(base, 'dist', 'demo-android.aab'),
            symbols: path.join(base, 'dist', 'demo-android-symbols.zip'),
            track: 'internal',
            status: 'completed',
            userFraction: null,
            notes: [],
        }]);
        const said = printed.join('\n');
        expect(said).toContain("crossbind: publishing dev.example.demo 1.2.3 to Google Play's internal track.");
        expect(said).toContain('Google Play has seen versionCode 1002005 at most, so this build is 1002006.');
        expect(said).toContain('crossbind: uploading the bundle and its native debug symbols to Google Play.');
        expect(said).toContain("dev.example.demo 1.2.3 (versionCode 1002006) is out on Google Play's internal track.");
    });

    test("takes the version's own code when Play has seen none as high, and CROSSBIND_APP_BUILD_NUMBER over both", async () => {
        play.highest = 0;
        await publishAndroid(['--track', 'beta']);
        expect(vite.env.CROSSBIND_APP_BUILD_NUMBER).toBe('1002003');
        expect(printed.join('\n')).toContain('Google Play has no build of dev.example.demo yet, so this build is 1002003.');

        vi.stubEnv('CROSSBIND_APP_BUILD_NUMBER', '77');
        await publishAndroid(['--track', 'beta']);
        expect(vite.env.CROSSBIND_APP_BUILD_NUMBER).toBe('77');
    });

    test('says a release Play took as a draft goes out once Play Console rolls it out', async () => {
        play.result = { versionCode: 1002006, status: 'draft', listed: [] };
        await publishAndroid(['--track', 'internal']);
        const said = printed.join('\n');
        expect(said).toContain("dev.example.demo 1.2.3 (versionCode 1002006) is a draft on Google Play's internal track.");
        expect(said).toContain('roll it out once in Play Console');
    });

    test('stops before the build without an app.id, an upload key or Play credentials', async () => {
        state.config.app = {};
        await expect(publishAndroid(['--track', 'internal']))
            .rejects.toThrow('Google Play knows an app by its package name, app.id, which crossbind.config.js does not set');
        state.config.app = { id: 'dev.example.demo' };
        signing.isSigned = false;
        await expect(publishAndroid(['--track', 'internal']))
            .rejects.toThrow('Google Play takes bundles signed with your upload key: crossbind app key upload makes one');
        signing.isSigned = true;
        play.credentials = null;
        await expect(publishAndroid(['--track', 'internal']))
            .rejects.toThrow('set CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT to its e-mail, with gcloud signed in, CROSSBIND_GOOGLE_PLAY_KEY to its JSON key, or CROSSBIND_GOOGLE_PLAY_TOKEN to an access token of it');
        expect(vite.runs).toBe(0);
    });

    test('uploads with the Google sign-in this machine keeps, with no terminal to ask at', async () => {
        play.credentials = null;
        play.kept = { refreshToken: 'kept' };
        await publishAndroid(['--track', 'internal']);
        expect(play.uploads[0].credentials).toEqual({ refreshToken: 'kept' });
        expect(setup.questions).toEqual([]);
    });

    test('uploads nothing when the build fails', async () => {
        vite.exitCode = 2;
        await expect(publishAndroid(['--track', 'internal']))
            .rejects.toMatchObject({ exitCode: 2, message: 'crossbind: the build ended with exit code 2, so nothing went to Google Play.' });
        expect(play.uploads).toEqual([]);
    });
});

describe('a release on Google Play', () => {
    const listing = 'store/google-play/en-US';

    test('rolls out to the percent --rollout gives, and to everyone at 100%, but never as a draft', () => {
        expect(['10', '12.5%', '0.01', '100'].map(rolloutPercent)).toEqual([10, 12.5, 0.01, 100]);
        ['0', '101', 'ten', '-5', '10%%', '12.345', ''].forEach((value) => expect(() => rolloutPercent(value))
            .toThrow(`--rollout takes the percent of the track's users a release reaches at first, above 0 and at most 100 with two decimals at most, as 10 or 12.5%, not ${value}.`));
        expect(playRelease(undefined, undefined)).toEqual({ status: 'completed', rollout: null });
        expect(playRelease(true, undefined)).toEqual({ status: 'draft', rollout: null });
        expect(playRelease(undefined, 10)).toEqual({ status: 'inProgress', rollout: 10 });
        expect(playRelease(undefined, 100)).toEqual({ status: 'completed', rollout: null });
        expect(() => playRelease(true, 10)).toThrow('crossbind: --draft and --rollout do not go together');
    });

    test("goes up at the share of users a staged rollout reaches, and leaves Play's listing to crossbind app store --send", async () => {
        fs.mkdirSync(path.join(base, listing), { recursive: true });
        fs.writeFileSync(path.join(base, listing, 'title.txt'), 'Demo\n');
        play.result = { versionCode: 1002006, status: 'inProgress' };

        await publishAndroid(['--track', 'production', '--rollout', '10']);

        expect(play.uploads[0]).toMatchObject({ track: 'production', status: 'inProgress', userFraction: 0.1, notes: [] });
        expect(play.sends).toEqual([]);
        const said = printed.join('\n');
        expect(said).not.toContain('listing');
        expect(said).toContain("dev.example.demo 1.2.3 (versionCode 1002006) is out to 10% of the users of Google Play's production track: Play Console raises the share");
    });

    test("gives Play a staged rollout's share as a fraction with four decimals at most", async () => {
        await publishAndroid(['--track', 'production', '--rollout', '33.3']);
        expect(play.uploads[0].userFraction).toBe(0.333);
    });

    test("says a staged rollout Play made a draft of, as an app's first release, reaches all of the track's users", async () => {
        play.result = { versionCode: 1002006, status: 'draft', listed: [] };
        await publishAndroid(['--track', 'production', '--rollout', '10']);
        const said = printed.join('\n');
        expect(said).toContain("dev.example.demo 1.2.3 (versionCode 1002006) is a draft on Google Play's production track.");
        expect(said).toContain("crossbind: Play stages updates alone, so that first release reaches all of the track's users, not 10% of them.");
    });

    test("sends the release notes of the listing's folder with the bundle, and nothing of the listing itself", async () => {
        fs.mkdirSync(upath.join(base, listing, 'changelogs'), { recursive: true });
        fs.writeFileSync(path.join(base, listing, 'changelogs', 'default.txt'), 'Fixes.');
        fs.writeFileSync(upath.join(base, listing, 'title.txt'), 'A title longer than Google Play takes');
        await publishAndroid(['--track', 'internal']);
        expect(play.uploads[0].notes).toEqual([{ language: 'en-US', notes: { default: 'Fixes.' } }]);
        expect(printed.join('\n')).not.toContain('listing');
    });

    test('stops at release notes Play would refuse, before anything is asked or built', async () => {
        terminal.isThere = true;
        fs.mkdirSync(upath.join(base, listing, 'changelogs'), { recursive: true });
        fs.writeFileSync(upath.join(base, listing, 'changelogs', 'default.txt'), 'x'.repeat(501));
        const failure = await publishAndroid(['--track', 'internal']).then(() => null, (error) => error);
        expect(upath.toUnix(failure.message)).toContain('crossbind: store/google-play/en-US/changelogs/default.txt has 501 characters, and Google Play takes 500 at most.');
        expect(vite.runs).toBe(0);
        expect(setup.questions).toEqual([]);
    });
});

describe("Google Play's page, sent alone", () => {
    const listing = 'store/google-play/en-US';
    const write = (file, text) => {
        fs.mkdirSync(upath.dirname(upath.join(base, file)), { recursive: true });
        fs.writeFileSync(upath.join(base, file), text);
    };

    test('goes with no build: the listing, the contact details and the Data safety declaration, saying what changed', async () => {
        write(`${listing}/title.txt`, 'Demo\n');
        write('store/google-play/contact_email.txt', 'support@example.com\n');
        write('store/google-play/data_safety.csv', 'Question ID,Response ID\n');
        play.sent = { listed: ['en-US'], isDetailed: true, isDeclared: true };

        await storeGuide('google-play', { send: true });

        expect(play.sends).toEqual([{
            appId: 'dev.example.demo',
            credentials: play.credentials,
            listings: [{ language: 'en-US', texts: { title: 'Demo' }, notes: {}, images: {} }],
            details: { contactEmail: 'support@example.com' },
            dataSafety: 'Question ID,Response ID',
        }]);
        expect(vite.runs).toBe(0);
        expect(play.uploads).toEqual([]);
        const said = printed.join('\n');
        expect(upath.toUnix(said)).toContain("crossbind: Google Play's listing changed in en-US, as store/google-play has it.");
        expect(said).toContain("crossbind: Google Play's contact details changed");
        expect(said).toContain('crossbind: Google Play has the Data safety declaration');

        play.sent = null;
        await storeGuide('google-play', { send: true });
        expect(upath.toUnix(printed.join('\n'))).toContain("crossbind: Google Play's listing is the one store/google-play has already.");
    });

    test('sends nothing of a project with no page, asking for nothing', async () => {
        terminal.isThere = true;
        play.credentials = null;
        await storeGuide('google-play', { send: true });
        expect(play.sends).toEqual([]);
        expect(setup.questions).toEqual([]);
        expect(upath.toUnix(printed.join('\n'))).toContain('crossbind: store/google-play holds no page of the app, so nothing went to Google Play.');
    });

    test('names every missing piece at once without a terminal, and asks for the sign-in on one', async () => {
        write(`${listing}/title.txt`, 'Demo\n');
        state.config.app = {};
        play.credentials = null;
        const sent = storeGuide('google-play', { send: true });
        await expect(sent).rejects.toThrow('Google Play knows an app by its package name, app.id');
        await expect(sent).rejects.toThrow('set CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT to its e-mail');
        expect(play.sends).toEqual([]);

        state.config.app = { id: 'dev.example.demo' };
        terminal.isThere = true;
        setup.signIns = [{ refreshToken: 'new' }];
        await storeGuide('google-play', { send: true });
        expect(setup.questions).toHaveLength(1);
        expect(play.sends[0].credentials).toEqual({ refreshToken: 'new' });
    });

    test('says what each track of Google Play has, asking for nothing, and how to see it with no credentials', async () => {
        play.tracks = [
            { track: 'internal', releases: [{ versionCodes: ['1002006'], name: '1.2.3', status: 'draft' }] },
            { track: 'production', releases: [{ versionCodes: ['1002005'], status: 'inProgress', userFraction: 0.1 }] },
            { track: 'beta' },
        ];
        terminal.isThere = true;
        await storeGuide('google-play');
        const said = printed.join('\n');
        expect(said).toContain(['Google Play has now:', '  internal: versionCode 1002006 (1.2.3), a draft', '  production: versionCode 1002005, rolling out to 10% of its users'].join('\n'));
        expect(said).not.toContain('beta');
        expect(setup.questions).toEqual([]);

        printed.length = 0;
        play.credentials = null;
        await storeGuide('google-play');
        expect(printed.join('\n')).toContain('Google Play has now:\n  Sign in to Google on a terminal');
    });
});

describe('publishing an Android app with something missing', () => {
    test('names every missing piece at once without a terminal, as in CI', async () => {
        state.config.app = {};
        signing.isSigned = false;
        play.credentials = null;
        const failure = await publishAndroid(['--track', 'internal']).catch((error) => error);
        expect(failure.message.split('\n').map((line) => line.slice(0, 40))).toEqual([
            'crossbind: Google Play knows an app by i',
            'crossbind: Google Play takes bundles sig',
            'crossbind: Google Play takes uploads fro',
        ]);
        expect(vite.runs).toBe(0);
    });

    test('asks for it on a terminal and sets it up: the package name, the upload key, the Google sign-in, the app in Play Console', async () => {
        terminal.isThere = true;
        state.config.app = {};
        state.config.paths.project = base;
        fs.writeFileSync(path.join(base, 'crossbind.config.js'), "export default {\n    general: { name: 'demo' },\n};\n");
        signing.isSigned = false;
        play.credentials = null;
        setup.signIns = [{ refreshToken: 'signed-in' }];
        play.answers = [Object.assign(new Error('crossbind: Play Console has no app dev.example.guided: create it there'), { status: 404 }), 7];
        terminal.lines = ['not a package', 'dev.example.guided', ''];

        await publishAndroid(['--track', 'internal']);

        expect(fs.readFileSync(path.join(base, 'crossbind.config.js'), 'utf8')).toContain("app: {\n        id: 'dev.example.guided',\n    },");
        expect(signing.made).toBe(1);
        expect(setup.questions).toEqual([expect.stringContaining('Sign in now, in your browser? [Y/n]')]);
        expect(opened).toEqual(['https://play.google.com/console']);
        expect(play.uploads[0]).toMatchObject({ appId: 'dev.example.guided', credentials: { refreshToken: 'signed-in' } });
        expect(vite.env.CROSSBIND_APP_BUILD_NUMBER).toBe('1002003');
        const said = printed.join('\n');
        expect(said).toContain('That is no package name');
        expect(said).toContain('Play Console has no app dev.example.guided');
    });

    test('offers another Google account when the one signed in has no release rights, and stops on a no', async () => {
        terminal.isThere = true;
        play.credentials = null;
        play.kept = { refreshToken: 'first' };
        const refused = Object.assign(new Error('crossbind: the Google account you signed in with has no release rights for dev.example.demo'), { status: 403 });
        play.answers = [refused, 7];
        setup.signIns = [{ refreshToken: 'second' }];

        await publishAndroid(['--track', 'internal']);
        expect(setup.questions).toEqual(['Sign in with another Google account? [Y/n] ']);
        expect(play.uploads[0].credentials).toEqual({ refreshToken: 'second' });
        expect(opened).toEqual([]);

        play.answers = [refused];
        await expect(publishAndroid(['--track', 'internal'])).rejects.toBe(refused);
        expect(vite.runs).toBe(1);
    });

    test('stops when the user will not have the package name written or the key made', async () => {
        terminal.isThere = true;
        state.config.app = {};
        state.config.paths.project = base;
        terminal.lines = ['dev.example.guided'];
        terminal.yes = [false];
        await expect(publishAndroid(['--track', 'internal']))
            .rejects.toThrow("crossbind: set app.id: 'dev.example.guided' in crossbind.config.js.");
        state.config.app = { id: 'dev.example.demo' };
        signing.isSigned = false;
        terminal.yes = [false];
        await expect(publishAndroid(['--track', 'internal']))
            .rejects.toThrow('Google Play takes bundles signed with your upload key');
        expect(vite.runs).toBe(0);
    });
});
