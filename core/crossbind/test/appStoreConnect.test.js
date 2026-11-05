import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: { general: { name: 'demo' }, paths: {} } };
vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('../src/actions/run.js', () => ({ EXEC_MAX_BUFFER: 1024 * 1024 }));
// xcodebuild writes its output where its stdio points, and an archive's app with Hermes in it; codesign signs as
// `xcode.signFailure` says; plutil reads a plist as the JSON it is here, and Xcode's settings hold `xcode.teams`.
const xcode = {};
const spawnSync = vi.fn((program, args, options) => {
    if (program === 'xcodebuild') {
        const { output = '** SUCCEEDED **\n', status = 0, signal = null } = xcode.answers.shift() ?? {};
        xcode.runs.push(args);
        fs.writeSync(options.stdio[1], output);
        if (args[0] === 'archive' && status === 0) {
            const app = `${args[args.indexOf('-archivePath') + 1]}/Products/Applications/demo.app`;
            fs.mkdirSync(`${app}/Frameworks/hermesvm.framework`, { recursive: true });
            xcode.plugIns.forEach((name) => fs.mkdirSync(`${app}/PlugIns/${name}.appex`, { recursive: true }));
        }
        return { status, signal };
    }
    if (program === 'codesign') {
        xcode.signed.push(args);
        return xcode.signFailure ?? { status: 0, stderr: '' };
    }
    if (program === 'plutil' && args[0] === '-convert') return { status: 0, stdout: fs.readFileSync(args[4], 'utf8') };
    if (program === 'defaults') return { status: xcode.teams ? 0 : 1, stdout: Buffer.from('<plist/>') };
    if (program === 'plutil' && args[0] === '-extract') return { status: 0, stdout: JSON.stringify(xcode.teams) };
    return { status: 1, stdout: '' };
});
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));

const { xcodebuild, xcodeTeams } = await import('../src/actions/xcodebuild.js');
const { PRIVACY_CATEGORIES } = await import('../src/utils/appOptions.js');
const {
    APP_STORE_CONNECT, addDsyms, archiveIosApp, archivedBinary, archivedPrivacy, archivedTargets, uploadIosArchive,
} = await import('../src/publishers/app-store/appStoreConnect.js');

const KEY = { key: '/keys/AuthKey_ABC123.p8', keyId: 'ABC123', issuer: 'issuer-uuid' };
function failureOf(step) {
    try {
        step();
        return null;
    } catch (error) {
        return error;
    }
}
const facts = { id: 'dev.example.demo', team: 'ABCDE12345' };
let base;
let store;
let project;
let api;

beforeEach(() => {
    // crossbind holds paths with forward slashes, as upath gives them, on Windows too.
    base = upath.toUnix(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-app-store-')));
    store = upath.join(base, 'build', 'app-store');
    project = upath.join(base, 'dist', 'demo-ios');
    fs.mkdirSync(`${project}/demo.xcodeproj`, { recursive: true });
    fs.writeFileSync(`${project}/demo.xcodeproj/project.pbxproj`, '{ "DEVELOPMENT_TEAM" = "ABCDE12345"; }');
    state.config.paths = { build: upath.join(base, 'build') };
    api = {
        workDir: store,
        project: { name: 'demo' },
        apple: { xcodebuild, privacyCategories: PRIVACY_CATEGORIES },
        log: (line) => console.log(line),
        warn: (line) => console.warn(line),
    };
    Object.assign(xcode, { runs: [], answers: [], teams: null, signed: [], signFailure: null, plugIns: [] });
});

afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("an iOS app's archive", () => {
    test('is the app of the Xcode project crossbind wrote, archived unsigned and then signed ad hoc, frameworks first', () => {
        const archive = archiveIosApp(api, project, { facts });
        expect(archive).toBe(`${store}/demo.xcarchive`);
        expect(archivedBinary(api, archive)).toBe(`${store}/demo.xcarchive/Products/Applications/demo.app/demo`);
        expect(xcode.runs[0]).toEqual(['archive', '-project', `${project}/demo.xcodeproj`, '-scheme', 'demo', '-configuration', 'Release',
            '-destination', 'generic/platform=iOS', '-archivePath', archive, 'CODE_SIGNING_ALLOWED=NO']);
        const app = `${archive}/Products/Applications/demo.app`;
        expect(xcode.signed).toEqual([
            ['--force', '--sign', '-', '--timestamp=none', `${app}/Frameworks/hermesvm.framework`],
            ['--force', '--sign', '-', '--timestamp=none', app],
        ]);
        expect(fs.readFileSync(`${store}/archive.log`, 'utf8')).toBe('** SUCCEEDED **\n');
    });

    test('carries the entitlements its project names in its ad hoc signature, for the export to sign with', () => {
        fs.writeFileSync(`${project}/demo.xcodeproj/project.pbxproj`, '{ "CODE_SIGN_ENTITLEMENTS" = "demo.entitlements"; "DEVELOPMENT_TEAM" = "ABCDE12345"; }');
        const archive = archiveIosApp(api, project, { facts });
        expect(xcode.signed.at(-1)).toEqual(['--force', '--sign', '-', '--timestamp=none', '--entitlements', path.resolve(project, 'demo.entitlements'),
            '--generate-entitlement-der', `${archive}/Products/Applications/demo.app`]);
    });

    test("signs each app extension of its PlugIns ad hoc with its target's entitlements, after the frameworks and before the app", () => {
        fs.writeFileSync(`${project}/demo.xcodeproj/project.pbxproj`, '{ "CODE_SIGN_ENTITLEMENTS" = "targets/clock/clock.entitlements"; "CODE_SIGN_ENTITLEMENTS" = "demo.entitlements"; }');
        xcode.plugIns = ['notify', 'clock'];
        const app = `${archiveIosApp(api, project, { facts })}/Products/Applications/demo.app`;
        const signed = (code, entitlements) => ['--force', '--sign', '-', '--timestamp=none', ...(entitlements ? ['--entitlements', path.resolve(project, entitlements), '--generate-entitlement-der'] : []), code];
        expect(xcode.signed).toEqual([
            signed(`${app}/Frameworks/hermesvm.framework`),
            signed(`${app}/PlugIns/clock.appex`, 'targets/clock/clock.entitlements'),
            signed(`${app}/PlugIns/notify.appex`),
            signed(app, 'demo.entitlements'),
        ]);
    });

    test('fails where codesign cannot sign it ad hoc', () => {
        xcode.signFailure = { status: 1, stderr: 'resource fork, Finder information, or similar detritus not allowed\n' };
        expect(() => archiveIosApp(api, project, { facts })).toThrow(`crossbind: codesign could not sign ${store}/demo.xcarchive/Products/Applications/demo.app/Frameworks/hermesvm.framework ad hoc: resource fork, Finder information, or similar detritus not allowed`);
    });

    test('fails for good where no cause the user mends is known', () => {
        xcode.answers.push({ status: 65, output: 'ld: error: undefined symbol: _demo\n** ARCHIVE FAILED **\n' });
        const failure = failureOf(() => archiveIosApp(api, project, { facts }));
        expect(failure.message.split('\n')).toEqual([`crossbind: the archive failed; xcodebuild's log is ${store}/archive.log.`, '  ld: error: undefined symbol: _demo']);
        expect(failure).toMatchObject({ isMendable: false, page: null });
    });

    test('ends, rather than waits to be tried again, once Ctrl-C stopped xcodebuild', () => {
        xcode.answers.push({ status: null, signal: 'SIGINT', output: 'error: interrupted\n' });
        const failure = failureOf(() => archiveIosApp(api, project, { facts }));
        expect(failure.message).toBe('crossbind: the archive stopped on SIGINT.');
        expect(failure.isMendable).toBeUndefined();
    });

    test("takes the dSYMs of the prebuilt frameworks crossbind puts in the app, as Hermes', which they lack", () => {
        const dsym = path.join(base, 'hermes', 'hermesvm.framework.dSYM');
        fs.mkdirSync(`${dsym}/Contents/Resources/DWARF`, { recursive: true });
        fs.writeFileSync(`${dsym}/Contents/Resources/DWARF/hermesvm`, 'dwarf');
        addDsyms(`${store}/demo.xcarchive`, [dsym]);
        expect(fs.readFileSync(`${store}/demo.xcarchive/dSYMs/hermesvm.framework.dSYM/Contents/Resources/DWARF/hermesvm`, 'utf8')).toBe('dwarf');
    });

    test("gives the reasons of the archived app's privacy manifest, by category", () => {
        const archive = `${store}/demo.xcarchive`;
        expect(archivedPrivacy(api, archive)).toEqual({});
        const app = `${archive}/Products/Applications/demo.app`;
        fs.mkdirSync(app, { recursive: true });
        fs.writeFileSync(`${app}/PrivacyInfo.xcprivacy`, JSON.stringify({
            NSPrivacyAccessedAPITypes: [
                { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
                { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
            ],
        }));
        expect(archivedPrivacy(api, archive)).toEqual({ fileTimestamp: ['C617.1'], systemBootTime: ['35F9.1'] });
    });

    test('gives each app extension of its PlugIns with its binary and the reasons of its own privacy manifest', () => {
        const archive = `${store}/demo.xcarchive`;
        const plugIns = `${archive}/Products/Applications/demo.app/PlugIns`;
        expect(archivedTargets(api, archive)).toEqual([]);
        fs.mkdirSync(`${plugIns}/clock.appex`, { recursive: true });
        fs.mkdirSync(`${plugIns}/notify.appex`, { recursive: true });
        fs.writeFileSync(`${plugIns}/clock.appex/PrivacyInfo.xcprivacy`, JSON.stringify({
            NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['1C8F.1'] }],
        }));
        expect(archivedTargets(api, archive)).toEqual([
            { name: 'clock', binary: `${plugIns}/clock.appex/clock`, privacy: { userDefaults: ['1C8F.1'] } },
            { name: 'notify', binary: `${plugIns}/notify.appex/notify`, privacy: {} },
        ]);
    });
});

describe("an iOS app's upload", () => {
    test('exports the archive for App Store Connect and uploads it with its dSYMs', () => {
        const archive = `${store}/demo.xcarchive`;
        fs.mkdirSync(store, { recursive: true });
        uploadIosArchive(api, archive, { team: 'ABCDE12345', key: KEY, isBuildManaged: true, facts });
        expect(xcode.runs[0]).toEqual(['-exportArchive', '-archivePath', archive, '-exportOptionsPlist', `${store}/ExportOptions.plist`,
            '-exportPath', `${store}/export`, '-allowProvisioningUpdates', '-authenticationKeyPath', KEY.key, '-authenticationKeyID', 'ABC123',
            '-authenticationKeyIssuerID', 'issuer-uuid']);
        const options = fs.readFileSync(`${store}/ExportOptions.plist`, 'utf8');
        ['<key>destination</key>\n    <string>upload</string>', '<key>manageAppVersionAndBuildNumber</key>\n    <true/>',
            '<key>method</key>\n    <string>app-store-connect</string>', '<key>signingStyle</key>\n    <string>automatic</string>',
            '<key>teamID</key>\n    <string>ABCDE12345</string>', '<key>uploadSymbols</key>\n    <true/>']
            .forEach((option) => expect(options).toContain(option));
    });

    test("fails with xcodebuild's reasons, and what to do where they leave it unclear", () => {
        fs.mkdirSync(store, { recursive: true });
        xcode.answers.push({
            status: 70,
            output: 'error: exportArchive No Account for Team "ABCDE12345". Add a new account in Accounts settings.\nerror: exportArchive No profiles for \'dev.example.demo\' were found\n** EXPORT FAILED **\n',
        });
        const failure = failureOf(() => uploadIosArchive(api, `${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: true, facts }));
        expect(failure.message.split('\n')).toEqual([
            `crossbind: the upload failed; xcodebuild's log is ${store}/upload.log.`,
            '  error: exportArchive No Account for Team "ABCDE12345". Add a new account in Accounts settings.',
            "  error: exportArchive No profiles for 'dev.example.demo' were found",
            'crossbind: Xcode is signed in to no account of team ABCDE12345, or its sign-in has lapsed: sign in again in Xcode, under Settings › Accounts.',
        ]);
        expect(failure).toMatchObject({ isMendable: true, page: null });
    });

    test('names an id of its own for a bundle id another team holds, which no second try of the same archive gives', () => {
        fs.mkdirSync(store, { recursive: true });
        xcode.answers.push({
            status: 70,
            output: 'error: Failed Registering Bundle Identifier: The app identifier "dev.example.demo" cannot be registered to your development team because it is not available.\n',
        });
        const failure = failureOf(() => uploadIosArchive(api, `${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: true, facts }));

        expect(failure.message).toContain('set app.id in crossbind.config.js to an id of your own');
        expect(failure).toMatchObject({ isMendable: false });
    });

    test("names App Store Connect's warnings, which do not stop the upload", () => {
        fs.mkdirSync(store, { recursive: true });
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        xcode.answers.push({ output: 'Upload succeeded.\nwarning: exportArchive Upload Symbols Failed. The archive did not include a dSYM\n** EXPORT SUCCEEDED **\n' });
        uploadIosArchive(api, `${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: true, facts });
        expect(warned.mock.calls).toEqual([['crossbind: warning: exportArchive Upload Symbols Failed. The archive did not include a dSYM']]);
        warned.mockRestore();
    });

    test('keeps the build number CROSSBIND_APP_BUILD_NUMBER gave', () => {
        fs.mkdirSync(store, { recursive: true });
        uploadIosArchive(api, `${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: false, facts });
        expect(fs.readFileSync(`${store}/ExportOptions.plist`, 'utf8')).toContain('<key>manageAppVersionAndBuildNumber</key>\n    <false/>');
    });

    test('names the page that mends a missing app record, in the words of Xcode 26 and of Xcode 27', () => {
        fs.mkdirSync(store, { recursive: true });
        // Each failed upload is followed by the export that registers the bundle id, which passes.
        xcode.answers.push(
            { status: 70, output: "error: exportArchive: No suitable application records were found. Verify your bundle identifier 'dev.example.demo' is correct.\n" },
            {},
            {
                status: 70,
                output: 'error: exportArchive Error Downloading App Information\n  App record with bundle identifier "dev.example.demo" not found on App Store Connect. Create an app record on App Store Connect, or distribute the app from Xcode, and then try again.\n',
            },
            {},
        );
        for (let run = 0; run < 2; run += 1) {
            expect(() => uploadIosArchive(api, `${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: true, facts }))
                .toThrow(expect.objectContaining({
                    message: expect.stringContaining(`App Store Connect has no app dev.example.demo: create it at ${APP_STORE_CONNECT}, a new iOS app with dev.example.demo as its bundle ID, which this publish registered with Apple.`),
                    isMendable: true,
                    page: APP_STORE_CONNECT,
                }));
        }
    });

    test("registers the bundle id where App Store Connect has no app yet, with an export that uploads nothing, for App Store Connect's form to list it", () => {
        fs.mkdirSync(store, { recursive: true });
        xcode.answers.push({ status: 70, output: 'error: exportArchive Error Downloading App Information\n  App record with bundle identifier "dev.example.demo" not found on App Store Connect.\n' });
        const archive = `${store}/demo.xcarchive`;
        const said = vi.spyOn(console, 'log').mockImplementation(() => {});
        failureOf(() => uploadIosArchive(api, archive, { team: 'ABCDE12345', key: KEY, isBuildManaged: true, facts }));
        expect(said.mock.calls).toEqual([['crossbind: App Store Connect has no app dev.example.demo yet, so this publish registers its bundle id with Apple first.']]);
        said.mockRestore();
        expect(xcode.runs[1]).toEqual(['-exportArchive', '-archivePath', archive, '-exportOptionsPlist', `${store}/RegisterOptions.plist`,
            '-exportPath', `${store}/register`, '-allowProvisioningUpdates', '-authenticationKeyPath', KEY.key, '-authenticationKeyID', 'ABC123',
            '-authenticationKeyIssuerID', 'issuer-uuid']);
        const options = fs.readFileSync(`${store}/RegisterOptions.plist`, 'utf8');
        ['<key>destination</key>\n    <string>export</string>', '<key>manageAppVersionAndBuildNumber</key>\n    <false/>',
            '<key>uploadSymbols</key>\n    <false/>', '<key>teamID</key>\n    <string>ABCDE12345</string>']
            .forEach((option) => expect(options).toContain(option));
        expect(xcode.runs).toHaveLength(2);
    });

    test("names crossbind's own cause first, as a lapsed sign-in, before the upload's, and registers nothing then", () => {
        fs.mkdirSync(store, { recursive: true });
        xcode.answers.push({
            status: 70,
            output: 'error: exportArchive No Account for Team "ABCDE12345".\nerror: exportArchive No suitable application records were found.\n',
        });
        const failure = failureOf(() => uploadIosArchive(api, `${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: true, facts }));
        expect(failure.message).toContain('crossbind: Xcode is signed in to no account of team ABCDE12345');
        expect(failure).toMatchObject({ isMendable: true, page: null });
        expect(xcode.runs).toHaveLength(1);
    });

    test('names why the bundle id could not be registered, where that fails too', () => {
        fs.mkdirSync(store, { recursive: true });
        xcode.answers.push(
            { status: 70, output: 'error: exportArchive App record with bundle identifier "dev.example.demo" not found on App Store Connect.\n' },
            { status: 70, output: 'error: exportArchive No Account for Team "ABCDE12345".\n' },
        );
        const failure = failureOf(() => uploadIosArchive(api, `${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: true, facts }));
        expect(failure.message).toContain(`crossbind: the registration of the bundle id failed; xcodebuild's log is ${store}/register.log.`);
        expect(failure).toMatchObject({ isMendable: true, page: null });
    });
});

describe('the teams Xcode is signed in to', () => {
    test('are the paid ones of every account, each once', () => {
        xcode.teams = {
            'account-1': [{ teamID: 'FREE000000', teamName: 'Ada Lovelace (Personal Team)', isFreeProvisioningTeam: true, teamType: 'Personal Team' }],
            'account-2': [{ teamID: 'ABCDE12345', teamName: 'Ada Ltd', isFreeProvisioningTeam: false, teamType: 'Company' }],
            'account-3': [{ teamID: 'ABCDE12345', teamName: 'Ada Ltd', isFreeProvisioningTeam: false, teamType: 'Company' }],
        };
        expect(xcodeTeams()).toEqual([{ id: 'ABCDE12345', name: 'Ada Ltd' }]);
    });

    test('take in the free Personal Teams too where asked, which sign for their own devices', () => {
        xcode.teams = {
            'account-1': [{ teamID: 'FREE000000', teamName: 'Ada Lovelace (Personal Team)', isFreeProvisioningTeam: true, teamType: 'Personal Team' }],
            'account-2': [{ teamID: 'ABCDE12345', teamName: 'Ada Ltd', isFreeProvisioningTeam: false, teamType: 'Company' }],
        };
        expect(xcodeTeams({ withPersonal: true })).toEqual([
            { id: 'FREE000000', name: 'Ada Lovelace (Personal Team)' },
            { id: 'ABCDE12345', name: 'Ada Ltd' },
        ]);
    });

    test('are none where Xcode has no settings', () => {
        expect(xcodeTeams()).toEqual([]);
    });
});
