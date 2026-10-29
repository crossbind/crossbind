import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: {}, targets: [] };
vi.mock('../src/state/index.js', () => ({ default: state }));
// xcodebuild's archive and upload, which go as `store` says, and the teams Xcode is signed in to, one list per look.
const store = {};
vi.mock('../src/actions/appStoreConnect.js', () => ({
    archiveIosApp: (project, options) => {
        store.archives.push({ project, ...options });
        const failure = store.archiveFailures.shift();
        if (failure) throw failure;
        return '/build/app-store/demo.xcarchive';
    },
    archivedBinary: (archive) => `${archive}/Products/Applications/demo.app/demo`,
    archivedPrivacy: () => ({}),
    addHermesDsym: (archive, dsym) => store.dsyms.push([archive, dsym]),
    uploadIosArchive: (archive, options) => {
        store.uploads.push({ archive, ...options });
        const failure = store.uploadFailures.shift();
        if (failure) throw failure;
    },
    xcodeTeams: () => (store.teams.length > 1 ? store.teams.shift() : store.teams[0]),
}));
vi.mock('../src/utils/hermes.js', async (importOriginal) => ({ ...await importOriginal(), resolveHermesDsym: async () => '/hermes/hermesvm.framework.dSYM' }));
// What the archived app calls without a reason, one answer per archive.
const scan = {};
vi.mock('../src/utils/requiredReasonApis.js', () => ({
    unreasonedImports: (binary) => {
        scan.binaries.push(binary);
        return scan.answers.shift() ?? [];
    },
}));
// The user at the terminal, if there is one, typing these lines and answering these yeses and nos.
const terminal = {};
vi.mock('../src/utils/ask.js', () => ({
    hasTerminal: () => terminal.isThere,
    askLine: async () => terminal.lines.shift() ?? '',
    askYesNo: async () => terminal.yes.shift() ?? true,
}));
const saved = {};
vi.mock('../src/utils/systemConfig.js', () => ({ default: () => ({ ...saved }), updateSystemConfig: (values) => Object.assign(saved, values) }));
const opened = [];
vi.mock('../src/utils/openUrl.js', () => ({ default: (url) => opened.push(url) }));

const { publishIos } = await import('../src/actions/publishIos.js');

const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const TEAM = { id: 'ABCDE12345', name: 'Ada Ltd' };
let base;
let printed;
let warned;
// Vite builds the app as the plugin does: its Xcode project, and where it went.
const vite = {};
async function runVite(args, env) {
    Object.assign(vite, { args, env, runs: vite.runs + 1 });
    if (vite.exitCode) return vite.exitCode;
    fs.mkdirSync(state.config.paths.build, { recursive: true });
    fs.writeFileSync(path.join(state.config.paths.build, 'app-outputs.json'), JSON.stringify({ ios: path.join(base, 'dist', 'demo-ios') }));
    return 0;
}
const publish = () => publishIos({ viteArgs: ['--mode', 'production'] }, { runVite });
const xcodebuildFailure = (message, { isMendable = true, page = null } = {}) => Object.assign(new Error(message), { isMendable, page });

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-publish-ios-'));
    Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
    state.config = {
        general: { name: 'demo' },
        app: { id: 'dev.example.demo', icon: 'icon.png', encryption: false },
        package: { version: '1.2.3' },
        paths: { project: base, build: path.join(base, '.crossbind', 'build') },
        system: { XCODE_DEVELOPMENT_TEAM: TEAM.id },
    };
    Object.assign(store, { archives: [], archiveFailures: [], dsyms: [], uploads: [], uploadFailures: [], teams: [[TEAM]] });
    Object.assign(scan, { binaries: [], answers: [] });
    Object.assign(terminal, { isThere: false, lines: [], yes: [] });
    Object.keys(saved).forEach((key) => delete saved[key]);
    opened.length = 0;
    Object.assign(vite, { args: null, env: null, runs: 0, exitCode: 0 });
    printed = [];
    warned = [];
    vi.spyOn(console, 'log').mockImplementation((line) => printed.push(line));
    vi.spyOn(console, 'warn').mockImplementation((line) => warned.push(line));
    ['CROSSBIND_APP_BUILD_NUMBER', 'CROSSBIND_APPLE_API_KEY', 'CROSSBIND_APPLE_API_KEY_ID', 'CROSSBIND_APPLE_API_ISSUER'].forEach((name) => vi.stubEnv(name, ''));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', hostPlatform);
    fs.rmSync(base, { recursive: true, force: true });
});

describe('publishing an iOS app', () => {
    test("builds the app, archives it, adds Hermes' dSYM and uploads it with Xcode's account, which numbers the build", async () => {
        await publish();

        expect(vite.args).toEqual(['build', '--mode', 'production']);
        expect(vite.env.CROSSBIND_APP_PLATFORM).toBe('ios');
        const facts = { id: 'dev.example.demo', team: TEAM.id };
        expect(store.archives).toEqual([{ project: path.join(base, 'dist', 'demo-ios'), facts }]);
        expect(scan.binaries).toEqual(['/build/app-store/demo.xcarchive/Products/Applications/demo.app/demo']);
        expect(store.dsyms).toEqual([['/build/app-store/demo.xcarchive', '/hermes/hermesvm.framework.dSYM']]);
        expect(store.uploads).toEqual([{ archive: '/build/app-store/demo.xcarchive', team: TEAM.id, key: null, isBuildManaged: true, facts }]);
        const said = printed.join('\n');
        expect(said).toContain(`crossbind: publishing dev.example.demo 1.2.3 to App Store Connect for team ${TEAM.id}; building the app first.`);
        expect(said).toContain('crossbind: archiving the app, which takes a few minutes.');
        expect(said).toContain(`crossbind: uploading the app to App Store Connect for team ${TEAM.id} with Xcode's account, which signs it.`);
        expect(said).toContain('dev.example.demo 1.2.3, numbered by Xcode after the builds App Store Connect has of it, is on App Store Connect.');
        expect(warned).toEqual([]);
    });

    test('uploads with the API key the environment names, and keeps the build number CROSSBIND_APP_BUILD_NUMBER gave', async () => {
        const key = path.join(base, 'AuthKey_ABC123.p8');
        fs.writeFileSync(key, 'key');
        vi.stubEnv('CROSSBIND_APPLE_API_KEY', key);
        vi.stubEnv('CROSSBIND_APPLE_API_KEY_ID', 'ABC123');
        vi.stubEnv('CROSSBIND_APPLE_API_ISSUER', 'issuer-uuid');
        vi.stubEnv('CROSSBIND_APP_BUILD_NUMBER', '42');

        await publish();

        expect(store.uploads[0]).toMatchObject({ key: { key, keyId: 'ABC123', issuer: 'issuer-uuid' }, isBuildManaged: false });
        expect(printed.join('\n')).toContain('with the API key ABC123, which signs it.');
        expect(printed.join('\n')).toContain('the API key ABC123');
        expect(printed.join('\n')).toContain('dev.example.demo 1.2.3 (build 42) is on App Store Connect.');
    });

    test('builds on macOS alone', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' });
        await expect(publish()).rejects.toThrow('iOS apps build and go to App Store Connect on macOS, with Xcode.');
    });

    test('uploads nothing when the build fails', async () => {
        vite.exitCode = 2;
        await expect(publish()).rejects.toMatchObject({ exitCode: 2, message: 'crossbind: the build ended with exit code 2, so nothing went to App Store Connect.' });
        expect(store.archives).toEqual([]);
    });
});

describe('publishing an iOS app without a terminal, as in CI', () => {
    test('names every missing piece at once, before the build', async () => {
        state.config.app = {};
        state.config.system = { XCODE_DEVELOPMENT_TEAM: '' };
        const failure = await publish().catch((error) => error);
        expect(failure.message.split('\n').map((line) => line.slice(0, 50))).toEqual([
            'crossbind: App Store Connect knows an app by its b',
            'crossbind: App Store Connect takes uploads from an',
            'crossbind: App Store Connect takes no iOS app with',
        ]);
        expect(vite.runs).toBe(0);
    });

    test('warns that App Store Connect asks about encryption for every build without app.encryption, and goes on', async () => {
        delete state.config.app.encryption;
        await publish();
        expect(warned.join('\n')).toContain('app.encryption is not set, so App Store Connect asks whether this build uses encryption');
        expect(store.uploads).toHaveLength(1);
    });

    test('stops before the upload on required reason API the archived app calls without a reason', async () => {
        scan.answers.push([{ category: 'fileTimestamp', symbols: ['_fstat', '_stat'] }]);
        await expect(publish()).rejects.toThrow("this app calls fileTimestamp (_fstat, _stat) with no reason in its privacy manifest. Give app.privacy Apple's reasons");
        expect(store.uploads).toEqual([]);
    });

    test("stops on xcodebuild's failure", async () => {
        store.uploadFailures.push(xcodebuildFailure("crossbind: the upload failed; xcodebuild's log is /build/app-store/upload.log."));
        await expect(publish()).rejects.toThrow('crossbind: the upload failed');
        expect(store.uploads).toHaveLength(1);
    });
});

describe('publishing an iOS app on a terminal', () => {
    beforeEach(() => {
        terminal.isThere = true;
        fs.writeFileSync(path.join(base, 'crossbind.config.js'), "export default {\n    general: { name: 'demo' },\n};\n");
        fs.writeFileSync(path.join(base, 'icon.png'), PNG.sync.write(new PNG({ width: 4, height: 4 })));
    });

    test('asks for what is missing: the bundle id, the team Xcode is signed in to, the icon and the encryption', async () => {
        state.config.app = {};
        state.config.system = { XCODE_DEVELOPMENT_TEAM: '' };
        store.teams = [[], [TEAM]];
        terminal.lines = ['dev.example.guided', '', 'missing.png', 'icon.png', 'y'];

        await publish();

        const config = fs.readFileSync(path.join(base, 'crossbind.config.js'), 'utf8');
        ["id: 'dev.example.guided'", "icon: 'icon.png'", 'encryption: false'].forEach((option) => expect(config).toContain(option));
        expect(saved).toEqual({ XCODE_DEVELOPMENT_TEAM: TEAM.id });
        expect(store.archives[0].facts).toEqual({ id: 'dev.example.guided', team: TEAM.id });
        const said = printed.join('\n');
        expect(said).toContain('Xcode is signed in to no such team');
        expect(said).toContain(`app.icon names ${path.join(base, 'missing.png')}, which does not exist.`);
    });

    test("asks for Apple's reasons for what the archived app calls, writes them into app.privacy and builds again", async () => {
        scan.answers.push([{ category: 'fileTimestamp', symbols: ['_fstat'] }], []);
        terminal.lines = ['4', '2'];

        await publish();

        expect(fs.readFileSync(path.join(base, 'crossbind.config.js'), 'utf8')).toContain("privacy: { fileTimestamp: ['C617.1'] }");
        expect(vite.runs).toBe(2);
        expect(store.archives).toHaveLength(2);
        expect(store.uploads).toHaveLength(1);
        const said = printed.join('\n');
        expect(said).toContain('The app calls fileTimestamp API (_fstat).');
        expect(said).toContain("  2) C617.1 for the timestamps, size or other metadata of files in the app's container");
        expect(said).not.toContain('0A2A.1');
        expect(said).toContain('Name one or more of 1 to 3');
    });

    test('takes a team id typed where Xcode is signed in to none, and the one picked of several', async () => {
        state.config.system = { XCODE_DEVELOPMENT_TEAM: '' };
        store.teams = [[]];
        terminal.lines = ['ABC', 'fghij67890'];
        await publish();
        expect(saved).toEqual({ XCODE_DEVELOPMENT_TEAM: 'FGHIJ67890' });
        expect(printed.join('\n')).toContain('That is no team id, which is ten letters and digits.');

        state.config.system = { XCODE_DEVELOPMENT_TEAM: '' };
        store.teams = [[TEAM, { id: 'FGHIJ67890', name: 'Ada Lovelace' }]];
        terminal.lines = ['3', '1'];
        await publish();
        expect(saved).toEqual({ XCODE_DEVELOPMENT_TEAM: TEAM.id });
    });

    test('takes a yes or no alone for the encryption, a legal statement', async () => {
        delete state.config.app.encryption;
        terminal.lines = ['', 'n'];
        await publish();
        expect(fs.readFileSync(path.join(base, 'crossbind.config.js'), 'utf8')).toContain('encryption: true');
        expect(printed.join('\n')).toContain('Answer y or n.');
    });

    test('names the whole app.privacy to set where the config has one already', async () => {
        state.config.app.privacy = { systemBootTime: ['35F9.1'] };
        scan.answers.push([{ category: 'fileTimestamp', symbols: ['_fstat'] }]);
        terminal.lines = ['2'];
        await expect(publish()).rejects.toThrow("crossbind: set app.privacy: { systemBootTime: ['35F9.1'], fileTimestamp: ['C617.1'] } in crossbind.config.js in place of the app.privacy there");
        expect(store.uploads).toEqual([]);
    });

    test('opens the page that mends a failed upload, and uploads again once Enter is pressed', async () => {
        store.uploadFailures.push(xcodebuildFailure('crossbind: App Store Connect has no app dev.example.demo', { page: 'https://appstoreconnect.apple.com/apps' }));
        await publish();
        expect(opened).toEqual(['https://appstoreconnect.apple.com/apps']);
        expect(store.uploads).toHaveLength(2);
        expect(store.archives).toHaveLength(1);
        const said = printed.join('\n');
        expect(said).toContain('App Store Connect has no app dev.example.demo');
        expect(said).toContain('crossbind: trying again, which can take a few minutes.');
    });

    test('stops at a failure no cause the user mends explains', async () => {
        store.archiveFailures.push(xcodebuildFailure("crossbind: the archive failed; xcodebuild's log is /build/app-store/archive.log.", { isMendable: false }));
        await expect(publish()).rejects.toThrow('crossbind: the archive failed');
        expect(store.archives).toHaveLength(1);
        expect(store.uploads).toEqual([]);
    });
});
