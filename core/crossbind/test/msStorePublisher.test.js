import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import microsoftStore from '../../../extensions/microsoft-store/crossbind.extension.js';
import { pngOf, writeUnder } from './listingImages.js';

const { publisher } = microsoftStore();
const IDENTITY = { name: '12345Example.Demo', publisher: 'CN=1A2B3C4D', publisherDisplayName: 'Example' };
const SAS = 'https://storage.example.test/ingestion/abc?sv=2014-02-14&sig=x';
const PUBLISHED = { id: '1', resourceLocation: 'applications/9N1/submissions/1' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let project;
let made;
let put;
// Partner Center as an upload sees one app: the app given, or none, the statuses of a committed submission in turn, and
// the status of the one an upload left.
function partnerCenter(app, statuses = ['PreProcessing'], pendingStatus = 'PendingCommit') {
    vi.stubGlobal('fetch', async (url, init = {}) => {
        const address = String(url);
        made.push(`${init.method ?? 'GET'} ${address.replace('https://manage.devcenter.microsoft.com/v1.0/my/', '')}`);
        if (init.method === 'PUT' && address.includes('/submissions/')) put = JSON.parse(init.body);
        if ((init.method ?? 'GET') === 'GET' && address.endsWith('/submissions/S2')) {
            return json(200, {
                id: 'S2', status: pendingStatus, fileUploadUrl: SAS, applicationPackages: [{ fileName: 'demo-win32-x64.msix', fileStatus: 'Uploaded' }], listings: {}, packageDeliveryOptions: {},
            });
        }
        if (address.startsWith('https://login.microsoftonline.com/')) return json(200, { access_token: 'store-token', expires_in: 3600 });
        if (address.includes('applications?$top=')) return json(200, { value: app ? [app] : [], totalCount: app ? 1 : 0 });
        if (init.method === 'POST' && address.endsWith('/submissions')) {
            return json(200, {
                id: 'S2', fileUploadUrl: SAS, applicationPackages: [], listings: {}, packageDeliveryOptions: {},
            });
        }
        if (address.endsWith('/status')) return json(200, { status: statuses.shift() });
        if (address.startsWith('https://storage.example.test/')) return new Response(null, { status: 201 });
        return json(200, {});
    });
}
const appOf = (fields = {}) => ({
    id: '9N1', primaryName: 'Demo', packageIdentityName: IDENTITY.name, publisherName: IDENTITY.publisher, lastPublishedApplicationSubmission: PUBLISHED, ...fields,
});

// The api an upload gives the publisher: its options, the project, the app's config and the terminal's answers.
function apiOf({
    options = {}, msix = IDENTITY, version = '1.2.3', isGuided = false, answers = [],
} = {}) {
    const logs = [];
    const kept = { settings: {}, secrets: {} };
    return {
        logs,
        kept,
        api: {
            name: 'microsoft-store',
            platform: 'windows',
            isGuided,
            options: { rollout: null, ...options },
            project: { root: project, name: 'demo' },
            workDir: upath.join(project, '.crossbind', 'build', 'microsoft-store'),
            config: { app: { windows: msix === null ? undefined : { msix } } },
            app: { name: 'Demo', version },
            settings: { get: (key) => kept.settings[key], set: (values) => Object.assign(kept.settings, values) },
            secrets: { get: (key) => kept.secrets[key] ?? null, set: (key, value) => Boolean(Object.assign(kept.secrets, { [key]: value })) },
            log: (line) => logs.push(line),
            warn: (line) => logs.push(line),
            ask: async () => answers.shift() ?? '',
            askYesNo: async () => true,
            askHidden: async () => answers.shift() ?? '',
            openUrl: () => {},
        },
    };
}
const credentials = () => {
    vi.stubEnv('CROSSBIND_MICROSOFT_STORE_TENANT_ID', 'T1');
    vi.stubEnv('CROSSBIND_MICROSOFT_STORE_CLIENT_ID', 'C1');
    vi.stubEnv('CROSSBIND_MICROSOFT_STORE_CLIENT_SECRET', 'S3cret');
};

beforeEach(() => {
    project = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-ms-publisher-')));
    made = [];
    put = null;
    vi.stubEnv('CROSSBIND_MICROSOFT_STORE_TENANT_ID', '');
    vi.stubEnv('CROSSBIND_MICROSOFT_STORE_CLIENT_ID', '');
    vi.stubEnv('CROSSBIND_MICROSOFT_STORE_CLIENT_SECRET', '');
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync(project, { recursive: true, force: true });
});

describe('the Microsoft Store publisher', () => {
    test('builds the app with its MSIX packages alone, and no updater, as the Store updates the apps it installs', () => {
        expect(publisher.build()).toEqual({ app: { updater: null, installers: ['msix'] } });
        expect(publisher.platform).toBe('windows');
    });

    test('names every missing piece at once without a terminal: the identity, the version and the credentials, and not the page', async () => {
        writeUnder(project, 'store/microsoft-store/en-US/images/tile.png', pngOf(512, 512));
        const { missing } = await publisher.check(apiOf({ msix: null, version: '1.2.3-beta.1' }).api);
        expect(missing.map(upath.toUnix)).toEqual([
            expect.stringContaining('crossbind: the Microsoft Store takes the package of the app Partner Center reserved, whose identity app.windows.msix gives'),
            'crossbind: the Microsoft Store takes 1.2.3-beta.1 as no version of a package, which is three numbers, as 1.2.3, with no prerelease, which it cannot tell from its release.',
            expect.stringContaining('CROSSBIND_MICROSOFT_STORE_TENANT_ID, CROSSBIND_MICROSOFT_STORE_CLIENT_ID and CROSSBIND_MICROSOFT_STORE_CLIENT_SECRET'),
        ]);
    });

    test('asks a terminal for the credentials once, keeping the ids in the settings and the key in the keychain', async () => {
        partnerCenter(appOf());
        const { api, kept } = apiOf({ isGuided: true, answers: ['T1', 'C1', 'S3cret'] });
        const { session } = await publisher.check(api);
        expect(session.app.id).toBe('9N1');
        expect(kept).toEqual({ settings: { TENANT_ID: 'T1', CLIENT_ID: 'C1' }, secrets: { 'client-secret': 'S3cret' } });
    });

    test("finds the app Partner Center reserved by its package's identity, which takes a submission", async () => {
        credentials();
        partnerCenter(appOf());
        const { api, logs } = apiOf();
        const { session } = await publisher.check(api);
        expect(Object.keys(session)).toEqual(['call', 'app']);
        expect(session.app.id).toBe('9N1');
        expect(logs).toContain('crossbind: publishing Demo 1.2.3 to the Microsoft Store; building the app first.');
    });

    test('stops before the build at an app Partner Center lacks, one with no first submission, another publisher, or a submission in progress', async () => {
        credentials();
        partnerCenter(null);
        await expect(publisher.check(apiOf().api)).rejects.toThrow('crossbind: Partner Center has no app whose package identity is 12345Example.Demo, as app.windows.msix names it');
        partnerCenter(appOf({ lastPublishedApplicationSubmission: null }));
        await expect(publisher.check(apiOf().api)).rejects.toThrow("crossbind: Partner Center's API makes no app's first submission, which takes the age ratings questionnaire");
        partnerCenter(appOf({ publisherName: 'CN=OTHER' }));
        await expect(publisher.check(apiOf().api)).rejects.toThrow("app.windows.msix names the publisher CN=1A2B3C4D, and Partner Center's app Demo has CN=OTHER");
        partnerCenter(appOf({ pendingApplicationSubmission: { id: 'S1' } }));
        await expect(publisher.check(apiOf().api)).rejects.toThrow('crossbind: Partner Center has submission S1 of Demo in progress, and takes one at a time: submit or delete it there, then upload again.');
    });

    test('deletes a submission in progress where the terminal says so', async () => {
        credentials();
        partnerCenter(appOf({ pendingApplicationSubmission: { id: 'S1' } }));
        await publisher.check(apiOf({ isGuided: true, answers: ['y'] }).api);
        expect(made).toContain('DELETE applications/9N1/submissions/S1');
    });

    test("uploads the build's packages in a submission it leaves for the release, without the page", async () => {
        credentials();
        partnerCenter(appOf());
        writeUnder(project, 'store/microsoft-store/en-US/description.txt', 'The demo app.');
        const { api, logs } = apiOf();
        const { session } = await publisher.check(api);
        const x64 = writeUnder(project, 'dist/demo-win32-x64.msix', 'x64');
        const arm64 = writeUnder(project, 'dist/demo-win32-arm64.msix', 'arm64');
        const apps = [
            { app: 'x64', arch: 'x64', installers: [{ name: 'msix', files: [x64] }, { name: 'probe', files: ['note.txt'] }] },
            { app: 'arm64', arch: 'arm64', installers: [{ name: 'msix', files: [arm64] }] },
        ];

        expect(await publisher.upload(api, session, { apps })).toEqual({
            published: {
                appId: '9N1', version: '1.2.3', submission: 'S2', status: 'PendingCommit',
            },
        });
        // Partner Center's calls, which the record keeps without its address, beside the sign-in's and the blob's.
        expect(made.filter((request) => !/^\w+ https:\/\//.test(request))).toEqual([
            'GET applications?$top=100&$skip=0',
            'POST applications/9N1/submissions',
            'PUT applications/9N1/submissions/S2',
        ]);
        expect(put.listings).toEqual({});
        expect(logs.map(upath.toUnix)).toContain('crossbind: Partner Center has Demo 1.2.3 as submission S2, not submitted yet: crossbind app release microsoft-store submits it for certification, with the page in store/microsoft-store.');
        await expect(publisher.upload(api, session, { apps: [{ app: 'x64', arch: 'x64', installers: [] }] })).rejects.toThrow('crossbind: the build made no MSIX package, so nothing went to the Microsoft Store.');
    });

    test("tells crossbind app store the first submission's steps, each field from its file", () => {
        writeUnder(project, 'store/microsoft-store/en-US/listing.json', JSON.stringify({ title: 'Demo' }));
        writeUnder(project, 'store/microsoft-store/store.json', JSON.stringify({ category: 'UtilitiesAndTools' }));
        const {
            uploads, sends, releases, problems, where, steps,
        } = publisher.guide(apiOf({ msix: null }).api);
        expect(where).toBe('Partner Center');
        expect(problems).toEqual([]);
        expect(uploads).toEqual(["the app's MSIX packages, x64 and arm64, in place of the last submission's, in a submission left for the release"]);
        expect(releases).toEqual([
            'the submission an upload left, for certification, after which Partner Center signs the packages and puts them out to the share of users --rollout gives at first',
            'with them, the page --send sends',
        ]);
        expect(sends.map(upath.toUnix)).toEqual([
            'store/microsoft-store/en-US: title',
            'category: UtilitiesAndTools',
        ]);
        expect(steps.map(({ text }) => text.split(':')[0])).toEqual([
            'Apps and games › New product › MSIX or PWA app',
            'Product management › Product identity',
            'First submission › Packages',
            'First submission › Store listings › en-US, each field from its file',
            "First submission › Properties, whose last three Partner Center's API takes no more, so a later change of them is made there too",
            'First submission › Age ratings',
            'First submission › Pricing and availability',
            'First submission › Submission options › Notes for certification',
            'For later versions, which uploads and releases send',
        ]);
        expect(steps[3].details.map(upath.toUnix)).toEqual([
            'Product name ← store/microsoft-store/en-US/listing.json.title',
            'Description: none yet, which store/microsoft-store/en-US/description.txt would hold and Partner Center takes no listing without',
            'Screenshots, Desktop: none yet, which store/microsoft-store/en-US/images/screenshots would hold and Partner Center takes no listing without',
        ]);
        expect(steps[4].details.map(upath.toUnix)).toEqual([
            'Category: UtilitiesAndTools',
            'Privacy policy URL: (store/microsoft-store/store.json.privacyUrl would name it)',
            'Website: (store/microsoft-store/store.json.websiteUrl would name it)',
            'Support contact info: (store/microsoft-store/store.json.supportContact would name it)',
        ]);
    });
});

describe('a release on the Microsoft Store', () => {
    test('submits what an upload left for certification, with the page and the share --rollout gives, with no build', async () => {
        credentials();
        partnerCenter(appOf({ pendingApplicationSubmission: { id: 'S2' } }));
        writeUnder(project, 'store/microsoft-store/en-US/description.txt', 'The demo app.');
        const { api, logs } = apiOf({ options: { rollout: 10 } });

        expect(await publisher.release(api)).toEqual({});

        expect(made.filter((request) => !/^\w+ https:\/\//.test(request))).toEqual([
            'GET applications?$top=100&$skip=0',
            'GET applications/9N1/submissions/S2',
            'PUT applications/9N1/submissions/S2',
            'POST applications/9N1/submissions/S2/commit',
            'GET applications/9N1/submissions/S2/status',
        ]);
        expect(put.applicationPackages).toEqual([{ fileName: 'demo-win32-x64.msix', fileStatus: 'Uploaded' }]);
        expect(put.listings['en-us'].baseListing.description).toBe('The demo app.');
        expect(put.packageDeliveryOptions.packageRollout).toEqual({ isPackageRollout: true, packageRolloutPercentage: 10 });
        expect(logs.at(-1)).toBe("crossbind: Demo's submission S2 went to the Microsoft Store, PreProcessing, to reach 10% of the app's users at first, which Partner Center raises. Certification takes up to three business days, and Partner Center mails as it goes.");
    });

    test("names the submission it lacks: none an upload left, one Partner Center took already, or the app's first", async () => {
        credentials();
        partnerCenter(appOf());
        await expect(publisher.release(apiOf().api)).rejects
            .toThrow("crossbind: Partner Center has no submission of Demo in progress to release: crossbind app upload microsoft-store leaves one, with the build's packages.");
        partnerCenter(appOf({ pendingApplicationSubmission: { id: 'S2' } }), [], 'Certification');
        await expect(publisher.release(apiOf().api)).rejects
            .toThrow('crossbind: Partner Center has submission S2 as Certification already, which goes on as Partner Center mails: crossbind app upload microsoft-store leaves the next one to release.');
        partnerCenter(appOf({ lastPublishedApplicationSubmission: null, pendingApplicationSubmission: { id: 'S1' } }));
        await expect(publisher.release(apiOf().api)).rejects.toThrow("crossbind: Partner Center's API makes no app's first submission");
        expect(made.filter((request) => request.endsWith('/commit'))).toEqual([]);
    });

    test("names every missing piece at once without a terminal, the page's first", async () => {
        writeUnder(project, 'store/microsoft-store/en-US/images/tile.png', pngOf(512, 512));
        const { missing } = await publisher.release(apiOf({ msix: null }).api);
        expect(missing.map(upath.toUnix)).toEqual([
            'crossbind: store/microsoft-store/en-US/images/tile.png is 512 × 512, and the Microsoft Store takes a 1:1 app tile icon of 300 × 300.',
            expect.stringContaining('copy { name, publisher, publisherDisplayName }'),
            expect.stringContaining("Partner Center's submission API takes an Entra ID application"),
        ]);
    });
});

describe("the Microsoft Store's page, sent alone", () => {
    test('goes in a submission of the packages Partner Center has, committed for certification, with no build', async () => {
        credentials();
        partnerCenter(appOf());
        writeUnder(project, 'store/microsoft-store/en-US/description.txt', 'The demo app.');
        const { api, logs } = apiOf();

        expect(await publisher.send(api)).toEqual({});

        expect(made).toEqual(expect.arrayContaining(['POST applications/9N1/submissions', 'PUT applications/9N1/submissions/S2', 'POST applications/9N1/submissions/S2/commit']));
        expect(made.some((request) => request.includes('storage.example.test'))).toBe(false);
        expect(upath.toUnix(logs.at(-1))).toBe('crossbind: the page in store/microsoft-store went to the Microsoft Store as submission S2, PreProcessing. Certification takes up to three business days, and Partner Center mails as it goes.');
    });

    test('stops where an upload left a submission not submitted yet, naming the release, and deletes nothing', async () => {
        credentials();
        partnerCenter(appOf({ pendingApplicationSubmission: { id: 'S2' } }), ['PendingCommit']);
        writeUnder(project, 'store/microsoft-store/en-US/description.txt', 'The demo app.');
        await expect(publisher.send(apiOf({ isGuided: true, answers: ['y'] }).api)).rejects
            .toThrow("crossbind: Partner Center has submission S2 of Demo not submitted yet, as an upload leaves the build's packages, and takes one submission at a time: crossbind app release microsoft-store sends the page with them, or deleting the submission in Partner Center lets the page go alone.");
        expect(made.filter((request) => /^(DELETE|POST|PUT) applications/.test(request))).toEqual([]);

        partnerCenter(appOf({ pendingApplicationSubmission: { id: 'S1' } }), ['Certification']);
        await expect(publisher.send(apiOf().api)).rejects.toThrow('crossbind: Partner Center has submission S1 of Demo in progress, and takes one at a time');
    });

    test('names every missing piece at once without a terminal, and sends nothing of a project with no page', async () => {
        writeUnder(project, 'store/microsoft-store/en-US/description.txt', 'The demo app.');
        expect(await publisher.send(apiOf({ msix: null }).api)).toEqual({
            missing: [expect.stringContaining('copy { name, publisher, publisherDisplayName }'), expect.stringContaining("Partner Center's submission API takes an Entra ID application")],
        });
        fs.rmSync(upath.join(project, 'store'), { recursive: true, force: true });
        const { api, logs } = apiOf();
        expect(await publisher.send(api)).toEqual({});
        expect(logs.map(upath.toUnix)).toEqual(['crossbind: store/microsoft-store holds no page of the app, so nothing went to the Microsoft Store.']);
    });

    test('tells the submissions Partner Center has, and how to see them without credentials', async () => {
        credentials();
        partnerCenter(appOf({ pendingApplicationSubmission: { id: 'S2' } }), ['Certification']);
        expect(await publisher.state(apiOf().api)).toEqual(['submission S2: in certification', 'submission 1: out']);
        vi.unstubAllEnvs();
        expect(await publisher.state(apiOf().api)).toEqual([expect.stringContaining('to see what the Microsoft Store has')]);
    });
});
