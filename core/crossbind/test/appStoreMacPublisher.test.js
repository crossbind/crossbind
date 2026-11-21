import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import { pngOf } from './listingImages.js';

// ditto, which copies the app into its archive, here as fs copies it.
const spawnSync = vi.fn();
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));
// App Store Connect, by the routes the upload calls, and the release's hand-over, which appStoreRelease's own tests cover.
let connect;
vi.mock('../../store-kit/app-store/appStoreApi.js', async (importOriginal) => ({ ...await importOriginal(), appStoreCaller: () => connect.call }));
const released = [];
const sentPages = [];
vi.mock('../../store-kit/app-store/appStoreRelease.js', async (importOriginal) => ({
    ...await importOriginal(),
    releaseVersion: async (call, options) => {
        released.push(options);
        return { build: '7', listed: ['en-US'], settled: [] };
    },
    sendListing: async (call, options) => {
        sentPages.push(options);
        return { listed: ['en-US'], settled: ['copyright'] };
    },
    appStoreState: async (call, appId) => [`iOS 1.2.3 of ${appId}: being prepared for submission`],
}));

const { default: appStore } = await import('../../../extensions/app-store/crossbind.extension.js');
const { publisher } = appStore();

const TEAM = 'ABCDE12345';
const KEY = { key: '/keys/AuthKey_ABC123.p8', keyId: 'ABC123', issuer: 'issuer-uuid' };
// Hermes' macOS dSYM, which api.apple.dsyms gives a macOS app.
const hermesDsym = () => `${project}/hermes/macosx/hermesvm.framework.dSYM`;

let project;
const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

// App Store Connect as the upload sees an app with no version in review: on macOS or not.
function appStoreConnect({ isOnMac = true } = {}) {
    const calls = [];
    const call = async (method, route) => {
        calls.push(`${method} ${route.split('?')[0]}`);
        if (route.startsWith('/apps?')) return { data: [{ id: 'A1', attributes: { bundleId: 'com.example.demo' } }] };
        if (route.startsWith('/apps/A1/appStoreVersions?')) return { data: isOnMac && route.includes('MAC_OS') ? [{ id: 'V1', attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION' } }] : [] };
        if (route.startsWith('/apps/A1/reviewSubmissions?')) return { data: [] };
        if (route.startsWith('/builds?')) return { data: [{ id: 'B1' }] };
        throw new Error(`no route ${method} ${route}`);
    };
    connect = { call, calls };
}

function apiOf({
    options = {}, key = KEY, team = TEAM, category = 'public.app-category.utilities', encryption = false, macos, buildNumber = null, xcodebuild = () => '',
} = {}) {
    const logs = [];
    const builds = [];
    return {
        logs,
        builds,
        api: {
            name: 'app-store',
            platform: 'macos',
            isGuided: false,
            options: { rollout: null, ...options },
            project: { root: project, name: 'demo' },
            workDir: upath.join(project, '.crossbind', 'build', 'app-store'),
            config: { app: { id: 'com.example.demo', icon: 'icon.png', ...(macos ? { macos } : {}) } },
            app: {
                id: 'com.example.demo', team, appleVersion: '1.2.3', buildNumber, encryption, category: category && { macos: category, linux: 'Utility' },
            },
            apple: {
                key: () => key,
                dsyms: async () => [hermesDsym()],
                xcodebuild: (what, args, xcodebuildOptions) => {
                    builds.push({ what, args, options: xcodebuildOptions });
                    return xcodebuild(what, args, xcodebuildOptions);
                },
            },
            log: (line) => logs.push(line),
            warn: (line) => logs.push(line),
            ask: async () => '',
            openUrl: () => {},
        },
    };
}

const write = (file, bytes) => {
    fs.mkdirSync(upath.dirname(upath.join(project, file)), { recursive: true });
    fs.writeFileSync(upath.join(project, file), bytes);
};

beforeEach(() => {
    project = upath.toUnix(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-mac-store-')));
    Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
    spawnSync.mockReset();
    spawnSync.mockImplementation((command, [from, to]) => {
        if (command === 'ditto') fs.cpSync(from, to, { recursive: true });
        return { status: 0, stdout: '', stderr: '' };
    });
    released.length = 0;
    sentPages.length = 0;
    appStoreConnect();
    write('dist/Demo.app/Contents/Info.plist', '<plist/>');
    write('hermes/macosx/hermesvm.framework.dSYM/Contents/Resources/DWARF/hermesvm', 'dwarf');
});

afterEach(() => {
    Object.defineProperty(process, 'platform', hostPlatform);
    fs.rmSync(project, { recursive: true, force: true });
});

describe("App Store Connect's publisher of a macOS app", () => {
    test("builds the app sandboxed, without its updater or installers, for macOS 13 or the app's later minimum", () => {
        const store = { updater: null, installers: [] };
        expect(publisher.build(apiOf().api)).toEqual({ app: { ...store, macos: { sandbox: true, minimumVersion: '13.0' } } });
        expect(publisher.build(apiOf({ macos: { minimumVersion: '14.2' } }).api).app.macos.minimumVersion).toBe('14.2');
        expect(publisher.build(apiOf({ macos: { minimumVersion: '12.0' } }).api).app.macos.minimumVersion).toBe('13.0');
        expect(publisher.build({ platform: 'ios' })).toBeNull();
    });

    test('names what the app lacks before anything reaches App Store Connect, and warns of the answer on encryption it lacks', async () => {
        const { missing } = await publisher.check(apiOf({
            key: null, team: null, category: null, encryption: null,
        }).api);
        expect(missing).toEqual([
            expect.stringContaining('App Store Connect takes uploads from an Apple Developer Program team'),
            'crossbind: the Mac App Store takes no app without its category: set app.category in crossbind.config.js.',
        ]);

        const { api, logs } = apiOf({ key: null, encryption: null });
        expect(await publisher.check(api)).toEqual({ session: { key: null, dsyms: [hermesDsym()], facts: { id: 'com.example.demo', team: TEAM } } });
        expect(logs[0]).toContain('app.encryption is not set, so App Store Connect asks whether this build uses encryption');
        expect(connect.calls).toEqual([]);
    });

    test("asks for the macOS platform on the app's record where a key reaches App Store Connect", async () => {
        appStoreConnect({ isOnMac: false });
        expect((await publisher.check(apiOf().api)).missing).toEqual([
            "crossbind: App Store Connect's app com.example.demo is not on macOS yet: add the platform there, with the + beside its platform in the sidebar, which makes it a universal purchase, then upload again, or upload the iOS app alone with -p ios.",
        ]);
    });

    test("leaves the build its number, which Xcode gives without one, and signs it ad hoc whatever Developer ID is named", () => {
        expect(publisher.buildNumber(apiOf().api)).toBeNull();
        expect(publisher.buildNumber(apiOf({ buildNumber: 42 }).api)).toBe(42);
        expect(publisher.buildEnv(apiOf().api)).toEqual({ CROSSBIND_APPLE_SIGNING_IDENTITY: undefined });
        expect(publisher.buildEnv({ platform: 'ios' })).toEqual({});
    });

    test('puts the app in an archive Xcode exports to App Store Connect, which signs it and its package in the cloud', async () => {
        const { api, logs, builds } = apiOf();
        const { session } = await publisher.check(api);

        const answer = await publisher.upload(api, session, { apps: [{ app: `${project}/dist/Demo.app`, arch: 'arm64', installers: [] }] });

        const archive = `${api.workDir}/Demo.xcarchive`;
        expect(fs.existsSync(`${archive}/Products/Applications/Demo.app/Contents/Info.plist`)).toBe(true);
        const info = fs.readFileSync(`${archive}/Info.plist`, 'utf8');
        for (const value of ['Applications/Demo.app', 'arm64', 'com.example.demo', '1.2.3', TEAM, '-', 'Demo']) expect(info).toContain(`<string>${value}</string>`);
        expect(info).toContain('<integer>2</integer>');
        expect(info).toMatch(/<date>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/date>/);
        const dsymutil = spawnSync.mock.calls.find(([command]) => command === 'dsymutil');
        expect(dsymutil[1].map((arg) => upath.toUnix(arg))).toEqual([`${archive}/Products/Applications/Demo.app/Contents/MacOS/Demo`, '-o', `${archive}/dSYMs/Demo.app.dSYM`]);
        expect(fs.readFileSync(`${archive}/dSYMs/hermesvm.framework.dSYM/Contents/Resources/DWARF/hermesvm`, 'utf8')).toBe('dwarf');

        expect(builds.map(({ what }) => what)).toEqual(['the upload']);
        const args = builds[0].args.map((arg) => upath.toUnix(arg));
        expect(args.slice(0, 3)).toEqual(['-exportArchive', '-archivePath', archive]);
        expect(args).toEqual(expect.arrayContaining(['-allowProvisioningUpdates', '-authenticationKeyID', 'ABC123', '-authenticationKeyIssuerID', 'issuer-uuid']));
        const options = fs.readFileSync(`${api.workDir}/ExportOptions.plist`, 'utf8');
        for (const pair of [['method', '<string>app-store-connect</string>'], ['destination', '<string>upload</string>'], ['manageAppVersionAndBuildNumber', '<true/>'], ['teamID', `<string>${TEAM}</string>`]]) {
            expect(options).toContain(`<key>${pair[0]}</key>\n    ${pair[1]}`);
        }
        expect(answer).toEqual({ published: { appId: 'com.example.demo', version: '1.2.3', build: null } });
        expect(logs.at(-1)).toContain('com.example.demo 1.2.3 for macOS, numbered by Xcode after the builds App Store Connect has of it, is on App Store Connect.');

        await publisher.upload(api, session, { apps: [{ app: `${project}/dist/Demo.app`, arch: 'x64', installers: [] }] });
        expect(fs.readFileSync(`${archive}/Info.plist`, 'utf8')).toContain('<string>x86_64</string>');
        await expect(publisher.upload(api, session, { apps: [] })).rejects.toThrow('the build made no macOS app');
    });

    test('stops before the upload where dsymutil makes no dSYM of the app', async () => {
        spawnSync.mockImplementation((command, [from, to]) => {
            if (command === 'ditto') fs.cpSync(from, to, { recursive: true });
            return command === 'dsymutil' ? { status: 1, stdout: '', stderr: 'error: no such file' } : { status: 0, stdout: '', stderr: '' };
        });
        const { api, builds } = apiOf();
        const { session } = await publisher.check(api);

        await expect(publisher.upload(api, session, { apps: [{ app: `${project}/dist/Demo.app`, arch: 'arm64', installers: [] }] }))
            .rejects.toThrow('dsymutil could not write the dSYM of');
        expect(builds).toEqual([]);
    });

    test('registers the bundle id where App Store Connect has no app on macOS, and names the platform to add', async () => {
        const xcodebuild = (what, args, { causes }) => {
            if (what === 'the upload') throw Object.assign(new Error('No suitable application records were found'), { reason: causes[0] });
            return '';
        };
        const { api, builds } = apiOf({ xcodebuild });
        const { session } = await publisher.check(api);

        await expect(publisher.upload(api, session, { apps: [{ app: `${project}/dist/Demo.app`, arch: 'arm64', installers: [] }] })).rejects.toThrow('No suitable application records');

        expect(builds.map(({ what }) => what)).toEqual(['the upload', 'the registration of the bundle id']);
        expect(builds[0].options.causes[0].hint({ id: 'com.example.demo' })).toContain('App Store Connect has no app com.example.demo on macOS: add the platform to its record');
    });

    test("hands the macOS version to App Review on a release, with the listing's Mac screenshots alone and no build", async () => {
        write('store/app-store/en-US/name.txt', 'Demo');
        write('store/app-store/en-US/screenshots/APP_DESKTOP/01.png', pngOf(2560, 1600));
        write('store/app-store/en-US/screenshots/APP_IPHONE_67/01.png', pngOf(1320, 2868));
        const { api, logs } = apiOf();

        expect(await publisher.release(api)).toEqual({});

        expect(released).toHaveLength(1);
        expect(released[0]).toMatchObject({
            appId: 'A1', versionString: '1.2.3', isPhased: false, usesEncryption: false, platform: 'MAC_OS',
        });
        expect(Object.keys(released[0].listings[0].screenshots)).toEqual(['APP_DESKTOP']);
        expect(spawnSync).not.toHaveBeenCalled();
        expect(logs.at(-1)).toBe('crossbind: com.example.demo 1.2.3 (build 7) for macOS went to App Review; Apple mails as the review goes.');
    });

    test("names a record not on macOS on a release, before anything goes", async () => {
        appStoreConnect({ isOnMac: false });
        expect(await publisher.release(apiOf().api)).toEqual({
            missing: [expect.stringContaining('then release again, or release the iOS app alone with -p ios.')],
        });
        expect(released).toEqual([]);
    });

    test("tells crossbind app store of the macOS app beside the iOS one: its upload, its category and the Mac screenshots Apple alone takes", () => {
        const { uploads, problems, steps } = publisher.guide(apiOf({ category: null }).api);
        expect(uploads[1]).toBe('then the macOS app, sandboxed, in an archive Xcode exports to App Store Connect, which signs it and its installer package in the cloud, and whose TestFlight hands it to Mac testers once Apple has processed it; -p macos sends it alone');
        expect(problems).toEqual(['crossbind: app.category is not set, and the Mac App Store takes no app without its category.']);
        const texts = steps.map(({ text }) => text);
        expect(texts[0]).toContain('An app on iOS alone takes macOS later with the + beside its platform in the sidebar');
        expect(texts).toContain("The macOS version's screenshots, 16:10 ones of 1280 × 800 to 2880 × 1800, which a locale's screenshots/APP_DESKTOP would send.");
        expect(texts.at(-1)).toContain('Apple signs the uploads of an Admin key in the cloud');
    });
});

describe("App Store Connect's page of an app, sent alone", () => {
    test('goes into the version of its number with the API key, with no build, and says what changed', async () => {
        write('store/app-store/en-US/name.txt', 'Demo');
        write('store/app-store/en-US/screenshots/APP_DESKTOP/01.png', pngOf(2880, 1800));
        write('store/app-store/en-US/screenshots/APP_IPHONE_67/01.png', pngOf(1320, 2868));
        write('store/app-store/copyright.txt', '2026 Example Ltd.');
        const { api, logs, builds } = apiOf();

        expect(await publisher.send(api)).toEqual({});

        expect(sentPages).toHaveLength(1);
        expect(sentPages[0]).toMatchObject({
            appId: 'A1', versionString: '1.2.3', platform: 'MAC_OS', settings: { copyright: '2026 Example Ltd.' },
        });
        expect(Object.keys(sentPages[0].listings[0].screenshots)).toEqual(['APP_DESKTOP']);
        expect(builds).toEqual([]);
        expect(logs.map(upath.toUnix)).toEqual(expect.arrayContaining([
            "crossbind: App Store Connect's macOS listing changed in en-US, as store/app-store has it.",
            "crossbind: App Store Connect's copyright changed, as store/app-store has them.",
        ]));
    });

    test('names the API key it lacks, and a record not on macOS, before anything goes', async () => {
        write('store/app-store/en-US/name.txt', 'Demo');
        expect(await publisher.send(apiOf({ key: null }).api)).toEqual({
            missing: [expect.stringContaining("crossbind app store --send sends the page through App Store Connect's API, which takes an API key")],
        });
        appStoreConnect({ isOnMac: false });
        expect(await publisher.send(apiOf().api)).toEqual({
            missing: ["crossbind: App Store Connect's app com.example.demo is not on macOS yet: add the platform there, with the + beside its platform in the sidebar, which makes it a universal purchase, then send again, or send the iOS app's page alone with -p ios."],
        });
        expect(sentPages).toEqual([]);
    });

    test('sends nothing of a project with no page, asking for no key', async () => {
        const { api, logs } = apiOf({ key: null });
        expect(await publisher.send(api)).toEqual({});
        expect(logs.map(upath.toUnix)).toEqual(['crossbind: store/app-store holds no page of the app, so nothing went to App Store Connect for macOS.']);
    });

    test('tells what App Store Connect has with the API key, and how to see it without one', async () => {
        expect(await publisher.state(apiOf().api)).toEqual(['iOS 1.2.3 of A1: being prepared for submission']);
        expect(await publisher.state(apiOf({ key: null }).api)).toEqual([expect.stringContaining('to see what App Store Connect has')]);
    });
});
