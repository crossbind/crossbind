import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: { general: { name: 'demo' }, app: {}, paths: {}, system: {} }, targets: [] };
vi.mock('../src/state/index.js', () => ({ default: state }));
// Play has seen `highest` at most, and releases what it is given, or answers `result`; the keychain keeps the Google
// sign-in `kept`.
const play = {};
vi.mock('../src/actions/googlePlay.js', () => ({
    PLAY: { key: 'CROSSBIND_GOOGLE_PLAY_KEY', serviceAccount: 'CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT' },
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
vi.mock('../src/actions/playSetup.js', () => ({
    signInToPlay: async (question) => {
        setup.questions.push(question);
        return setup.signIns.shift() ?? null;
    },
}));
const opened = [];
vi.mock('../src/utils/openUrl.js', () => ({ default: (url) => opened.push(url) }));
vi.mock('../src/utils/systemConfig.js', () => ({ default: () => ({}) }));

const { publishAndroid } = await import('../src/actions/publishAndroid.js');

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
    fs.writeFileSync(path.join(state.config.paths.build, 'app-outputs.json'), JSON.stringify({ android: project }));
    return 0;
}
const KEY = { CROSSBIND_ANDROID_KEYSTORE: '/keys/upload.p12', CROSSBIND_ANDROID_KEY_ALIAS: 'upload', CROSSBIND_ANDROID_KEYSTORE_PASSWORD: 'kept' };

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-publish-'));
    Object.assign(state.config, { app: { id: 'dev.example.demo' }, package: { version: '1.2.3' }, paths: { build: path.join(base, '.crossbind', 'build') } });
    Object.assign(play, { credentials: { account: 'play@demo.iam.gserviceaccount.com' }, kept: null, highest: 1002005, answers: [], result: null, uploads: [] });
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
        await publishAndroid({ track: 'internal', status: 'completed', viteArgs: ['--mode', 'production'] }, { runVite });

        expect(vite.args).toEqual(['build', '--mode', 'production']);
        expect(vite.env).toMatchObject({ ...KEY, CROSSBIND_APP_PLATFORM: 'android', CROSSBIND_APP_BUILD_NUMBER: '1002006' });
        expect(play.uploads).toEqual([{
            appId: 'dev.example.demo',
            credentials: play.credentials,
            aab: path.join(base, 'dist', 'demo-android.aab'),
            symbols: path.join(base, 'dist', 'demo-android-symbols.zip'),
            track: 'internal',
            status: 'completed',
        }]);
        const said = printed.join('\n');
        expect(said).toContain('Google Play has seen versionCode 1002005 at most, so this build is 1002006.');
        expect(said).toContain("dev.example.demo 1.2.3 (versionCode 1002006) is out on Google Play's internal track.");
    });

    test("takes the version's own code when Play has seen none as high, and CROSSBIND_APP_BUILD_NUMBER over both", async () => {
        play.highest = 0;
        await publishAndroid({ track: 'beta', status: 'completed', viteArgs: [] }, { runVite });
        expect(vite.env.CROSSBIND_APP_BUILD_NUMBER).toBe('1002003');
        expect(printed.join('\n')).toContain('Google Play has no build of dev.example.demo yet, so this build is 1002003.');

        vi.stubEnv('CROSSBIND_APP_BUILD_NUMBER', '77');
        await publishAndroid({ track: 'beta', status: 'completed', viteArgs: [] }, { runVite });
        expect(vite.env.CROSSBIND_APP_BUILD_NUMBER).toBe('77');
    });

    test('says a release Play took as a draft goes out once Play Console rolls it out', async () => {
        play.result = { versionCode: 1002006, status: 'draft' };
        await publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite });
        const said = printed.join('\n');
        expect(said).toContain("dev.example.demo 1.2.3 (versionCode 1002006) is a draft on Google Play's internal track.");
        expect(said).toContain('roll it out once in Play Console');
    });

    test('stops before the build without an app.id, an upload key or Play credentials', async () => {
        state.config.app = {};
        await expect(publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite }))
            .rejects.toThrow('Google Play knows an app by its package name, app.id, which crossbind.config.js does not set');
        state.config.app = { id: 'dev.example.demo' };
        signing.isSigned = false;
        await expect(publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite }))
            .rejects.toThrow('Google Play takes bundles signed with your upload key: crossbind app upload-key makes one');
        signing.isSigned = true;
        play.credentials = null;
        await expect(publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite }))
            .rejects.toThrow('set CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT to its e-mail, with gcloud signed in, or CROSSBIND_GOOGLE_PLAY_KEY to its JSON key');
        expect(vite.runs).toBe(0);
    });

    test('uploads with the Google sign-in this machine keeps, with no terminal to ask at', async () => {
        play.credentials = null;
        play.kept = { refreshToken: 'kept' };
        await publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite });
        expect(play.uploads[0].credentials).toEqual({ refreshToken: 'kept' });
        expect(setup.questions).toEqual([]);
    });

    test('uploads nothing when the build fails', async () => {
        vite.exitCode = 2;
        await expect(publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite }))
            .rejects.toMatchObject({ exitCode: 2, message: 'crossbind: the build ended with exit code 2, so nothing went to Google Play.' });
        expect(play.uploads).toEqual([]);
    });
});

describe('publishing an Android app with something missing', () => {
    test('names every missing piece at once without a terminal, as in CI', async () => {
        state.config.app = {};
        signing.isSigned = false;
        play.credentials = null;
        const failure = await publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite }).catch((error) => error);
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

        await publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite });

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

        await publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite });
        expect(setup.questions).toEqual(['Sign in with another Google account? [Y/n] ']);
        expect(play.uploads[0].credentials).toEqual({ refreshToken: 'second' });
        expect(opened).toEqual([]);

        play.answers = [refused];
        await expect(publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite })).rejects.toBe(refused);
        expect(vite.runs).toBe(1);
    });

    test('stops when the user will not have the package name written or the key made', async () => {
        terminal.isThere = true;
        state.config.app = {};
        state.config.paths.project = base;
        terminal.lines = ['dev.example.guided'];
        terminal.yes = [false];
        await expect(publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite }))
            .rejects.toThrow("crossbind: set app.id: 'dev.example.guided' in crossbind.config.js to publish");
        state.config.app = { id: 'dev.example.demo' };
        signing.isSigned = false;
        terminal.yes = [false];
        await expect(publishAndroid({ track: 'internal', status: 'completed', viteArgs: [] }, { runVite }))
            .rejects.toThrow('Google Play takes bundles signed with your upload key');
        expect(vite.runs).toBe(0);
    });
});
