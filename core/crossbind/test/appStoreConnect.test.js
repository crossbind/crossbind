import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: { general: { name: 'demo' }, paths: {} } };
vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('../src/actions/run.js', () => ({ EXEC_MAX_BUFFER: 1024 * 1024 }));
// xcodebuild writes its output where its stdio points; plutil reads a plist as the JSON it is here, and Xcode's settings
// hold `xcode.teams`.
const xcode = {};
const spawnSync = vi.fn((program, args, options) => {
    if (program === 'xcodebuild') {
        const { output = '** SUCCEEDED **\n', status = 0, signal = null } = xcode.answers.shift() ?? {};
        xcode.runs.push(args);
        fs.writeSync(options.stdio[1], output);
        return { status, signal };
    }
    if (program === 'plutil' && args[0] === '-convert') return { status: 0, stdout: fs.readFileSync(args[4], 'utf8') };
    if (program === 'defaults') return { status: xcode.teams ? 0 : 1, stdout: Buffer.from('<plist/>') };
    if (program === 'plutil' && args[0] === '-extract') return { status: 0, stdout: JSON.stringify(xcode.teams) };
    return { status: 1, stdout: '' };
});
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));

const {
    APP_STORE_CONNECT, addHermesDsym, archiveIosApp, archivedBinary, archivedPrivacy, uploadIosArchive, xcodeTeams,
} = await import('../src/actions/appStoreConnect.js');

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

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-app-store-'));
    store = path.join(base, 'build', 'app-store');
    state.config.paths = { build: path.join(base, 'build') };
    Object.assign(xcode, { runs: [], answers: [], teams: null });
});

afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("an iOS app's archive", () => {
    test("comes from the Xcode project crossbind wrote, signed by Xcode's account or the key", () => {
        const archive = archiveIosApp('/dist/demo-ios', { key: null, facts });
        expect(archive).toBe(`${store}/demo.xcarchive`);
        expect(archivedBinary(archive)).toBe(`${store}/demo.xcarchive/Products/Applications/demo.app/demo`);
        expect(xcode.runs[0]).toEqual(['archive', '-project', '/dist/demo-ios/demo.xcodeproj', '-scheme', 'demo', '-configuration', 'Release',
            '-destination', 'generic/platform=iOS', '-archivePath', archive, '-allowProvisioningUpdates']);
        expect(fs.readFileSync(`${store}/archive.log`, 'utf8')).toBe('** SUCCEEDED **\n');

        archiveIosApp('/dist/demo-ios', { key: KEY, facts });
        expect(xcode.runs[1].slice(-6)).toEqual(['-authenticationKeyPath', KEY.key, '-authenticationKeyID', 'ABC123', '-authenticationKeyIssuerID', 'issuer-uuid']);
    });

    test("fails with xcodebuild's reasons, and what to do where they leave it unclear", () => {
        xcode.answers.push({
            status: 65,
            output: 'Prepare packages\nerror: No Account for Team "ABCDE12345". Add a new account in Accounts settings.\nerror: No profiles for \'dev.example.demo\' were found\n** ARCHIVE FAILED **\n',
        });
        const failure = failureOf(() => archiveIosApp('/dist/demo-ios', { key: null, facts }));
        expect(failure.message.split('\n')).toEqual([
            `crossbind: the archive failed; xcodebuild's log is ${store}/archive.log.`,
            '  error: No Account for Team "ABCDE12345". Add a new account in Accounts settings.',
            "  error: No profiles for 'dev.example.demo' were found",
            'crossbind: Xcode is signed in to no account of team ABCDE12345, or its sign-in has lapsed: sign in again in Xcode, under Settings › Accounts.',
        ]);
        expect(failure).toMatchObject({ isMendable: true, page: null });
    });

    test('fails for good where no cause the user mends is known', () => {
        xcode.answers.push({ status: 65, output: 'ld: error: undefined symbol: _demo\n** ARCHIVE FAILED **\n' });
        const failure = failureOf(() => archiveIosApp('/dist/demo-ios', { key: null, facts }));
        expect(failure.message.split('\n')).toEqual([`crossbind: the archive failed; xcodebuild's log is ${store}/archive.log.`, '  ld: error: undefined symbol: _demo']);
        expect(failure).toMatchObject({ isMendable: false, page: null });
    });

    test('ends, rather than waits to be tried again, once Ctrl-C stopped xcodebuild', () => {
        xcode.answers.push({ status: null, signal: 'SIGINT', output: 'error: interrupted\n' });
        const failure = failureOf(() => archiveIosApp('/dist/demo-ios', { key: null, facts }));
        expect(failure.message).toBe('crossbind: the archive stopped on SIGINT.');
        expect(failure.isMendable).toBeUndefined();
    });

    test("takes Hermes' dSYM, which its prebuilt framework lacks", () => {
        const dsym = path.join(base, 'hermes', 'hermesvm.framework.dSYM');
        fs.mkdirSync(`${dsym}/Contents/Resources/DWARF`, { recursive: true });
        fs.writeFileSync(`${dsym}/Contents/Resources/DWARF/hermesvm`, 'dwarf');
        addHermesDsym(`${store}/demo.xcarchive`, dsym);
        expect(fs.readFileSync(`${store}/demo.xcarchive/dSYMs/hermesvm.framework.dSYM/Contents/Resources/DWARF/hermesvm`, 'utf8')).toBe('dwarf');
    });

    test("gives the reasons of the archived app's privacy manifest, by category", () => {
        const archive = `${store}/demo.xcarchive`;
        expect(archivedPrivacy(archive)).toEqual({});
        const app = `${archive}/Products/Applications/demo.app`;
        fs.mkdirSync(app, { recursive: true });
        fs.writeFileSync(`${app}/PrivacyInfo.xcprivacy`, JSON.stringify({
            NSPrivacyAccessedAPITypes: [
                { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
                { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
            ],
        }));
        expect(archivedPrivacy(archive)).toEqual({ fileTimestamp: ['C617.1'], systemBootTime: ['35F9.1'] });
    });
});

describe("an iOS app's upload", () => {
    test('exports the archive for App Store Connect and uploads it with its dSYMs', () => {
        const archive = `${store}/demo.xcarchive`;
        fs.mkdirSync(store, { recursive: true });
        uploadIosArchive(archive, { team: 'ABCDE12345', key: KEY, isBuildManaged: true, facts });
        expect(xcode.runs[0]).toEqual(['-exportArchive', '-archivePath', archive, '-exportOptionsPlist', `${store}/ExportOptions.plist`,
            '-exportPath', `${store}/export`, '-allowProvisioningUpdates', '-authenticationKeyPath', KEY.key, '-authenticationKeyID', 'ABC123',
            '-authenticationKeyIssuerID', 'issuer-uuid']);
        const options = fs.readFileSync(`${store}/ExportOptions.plist`, 'utf8');
        ['<key>destination</key>\n    <string>upload</string>', '<key>manageAppVersionAndBuildNumber</key>\n    <true/>',
            '<key>method</key>\n    <string>app-store-connect</string>', '<key>signingStyle</key>\n    <string>automatic</string>',
            '<key>teamID</key>\n    <string>ABCDE12345</string>', '<key>uploadSymbols</key>\n    <true/>']
            .forEach((option) => expect(options).toContain(option));
    });

    test("names App Store Connect's warnings, which do not stop the upload", () => {
        fs.mkdirSync(store, { recursive: true });
        const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
        xcode.answers.push({ output: 'Upload succeeded.\nwarning: exportArchive Upload Symbols Failed. The archive did not include a dSYM\n** EXPORT SUCCEEDED **\n' });
        uploadIosArchive(`${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: true, facts });
        expect(warned.mock.calls).toEqual([['crossbind: warning: exportArchive Upload Symbols Failed. The archive did not include a dSYM']]);
        warned.mockRestore();
    });

    test('keeps the build number CROSSBIND_APP_BUILD_NUMBER gave', () => {
        fs.mkdirSync(store, { recursive: true });
        uploadIosArchive(`${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: false, facts });
        expect(fs.readFileSync(`${store}/ExportOptions.plist`, 'utf8')).toContain('<key>manageAppVersionAndBuildNumber</key>\n    <false/>');
    });

    test('names the page that mends a missing app record', () => {
        fs.mkdirSync(store, { recursive: true });
        xcode.answers.push({ status: 70, output: "error: exportArchive: No suitable application records were found. Verify your bundle identifier 'dev.example.demo' is correct.\n" });
        expect(() => uploadIosArchive(`${store}/demo.xcarchive`, { team: 'ABCDE12345', key: null, isBuildManaged: true, facts }))
            .toThrow(expect.objectContaining({
                message: expect.stringContaining(`App Store Connect has no app dev.example.demo: create it at ${APP_STORE_CONNECT}, a new iOS app with dev.example.demo as its bundle ID.`),
                isMendable: true,
                page: APP_STORE_CONNECT,
            }));
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

    test('are none where Xcode has no settings', () => {
        expect(xcodeTeams()).toEqual([]);
    });
});
