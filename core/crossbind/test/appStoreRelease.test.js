import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../src/state/index.js', () => ({ default: { config: {} } }));
// The uploads of screenshots' bytes where App Store Connect reserved them.
const parts = [];
vi.mock('../../store-kit/app-store/appStoreApi.js', () => ({
    uploadParts: async (operations, bytes, file) => {
        parts.push({ operations, bytes: String(bytes), file });
    },
}));

const {
    appStoreApp, appStoreState, assertReviewable, releaseVersion, sendListing,
} = await import('../../store-kit/app-store/appStoreRelease.js');

const EDITABLE = 'PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,REJECTED,METADATA_REJECTED,INVALID_BINARY';
const BUILDS = 'GET /builds?filter[app]=A1&filter[preReleaseVersion.version]=1.2.3&filter[preReleaseVersion.platform]=IOS&sort=-uploadedDate&limit=1';
// A build of 1.2.3, whose upload answered that it uses no encryption unless usesNonExemptEncryption says otherwise.
const build = (id, processingState, version = '42', usesNonExemptEncryption = false) => ({ id, attributes: { version, processingState, usesNonExemptEncryption } });
const READY = 'GET /apps/A1/reviewSubmissions?filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&include=items';
const PREPARED = 'crossbind: App Store Connect prepares a review submission of the app with items in it already, as one a release stopped in leaves: submit or remove them there, then release again.';
// The submission App Store Connect prepares, with an item in the state given.
const prepared = (state) => ({
    data: [{ id: 'S7', attributes: { state: 'READY_FOR_REVIEW' }, relationships: { items: { data: [{ type: 'reviewSubmissionItems', id: 'X1' }] } } }],
    included: [{ type: 'reviewSubmissionItems', id: 'X1', attributes: { state } }],
});

let calls;
let answers;
let builds;
let printed;
// App Store Connect as a release sees one app: its answers by method and route, else those of an app with no version of
// 1.2.3 and none prepared, its newest build B2 processed, and nothing in review. What it is given it keeps.
const DEFAULTS = {
    'GET /apps?filter[bundleId]=dev.example.demo': { data: [{ id: 'A0', attributes: { bundleId: 'dev.example.demo.widget' } }, { id: 'A1', attributes: { bundleId: 'dev.example.demo' } }] },
    'GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3': { data: [] },
    [`GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[appVersionState]=${EDITABLE}`]: { data: [] },
    'GET /apps/A1/reviewSubmissions?filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES': { data: [] },
    [BUILDS]: () => ({ data: [builds.length > 1 ? builds.shift() : builds[0]] }),
    'GET /appStoreVersions/V1/appStoreVersionLocalizations?limit=200': { data: [{ id: 'L1', attributes: { locale: 'en-US', description: 'The demo app.', whatsNew: null } }] },
    'GET /apps/A1/appInfos': { data: [{ id: 'I0', attributes: { state: 'READY_FOR_DISTRIBUTION' } }, { id: 'I1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }] },
    'GET /appInfos/I1/appInfoLocalizations?limit=200': { data: [{ id: 'N1', attributes: { locale: 'en-US', name: 'Demo', subtitle: null } }] },
    'GET /appStoreVersions/V1/appStoreVersionPhasedRelease': { data: null },
    'GET /apps/A1/reviewSubmissions?filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&include=items': { data: [] },
    'POST /appStoreVersions': ({ data }) => ({ data: { id: 'V1', ...data } }),
    'POST /reviewSubmissions': ({ data }) => ({ data: { id: 'S1', ...data } }),
    'GET /appStoreVersions/V1': { data: { id: 'V1', attributes: { appVersionState: 'READY_FOR_REVIEW' } } },
};

async function call(method, route, body) {
    const key = `${method} ${decodeURIComponent(route)}`;
    calls.push({ key, body });
    const answer = answers[key] ?? DEFAULTS[key] ?? (method === 'GET' ? null : { data: body?.data ?? null });
    if (answer === null) throw Object.assign(new Error(`unanswered ${key}`), { status: 500 });
    return typeof answer === 'function' ? answer(body) : answer;
}

const keys = () => calls.map(({ key }) => key);
const bodyOf = (key) => calls.find((made) => made.key === key).body;
// Runs a step to its end as time passes for its waits.
async function settled(promise) {
    let result;
    promise.then((value) => { result = { value }; }, (error) => { result = { error }; });
    while (!result) await vi.advanceTimersByTimeAsync(15_000);
    if (result.error) throw result.error;
    return result.value;
}
const release = (options = {}) => settled(releaseVersion(call, {
    appId: 'A1', versionString: '1.2.3', listings: [], isPhased: false, ...options,
}));

beforeEach(() => {
    vi.useFakeTimers();
    parts.length = 0;
    calls = [];
    answers = {};
    builds = [build('B2', 'VALID')];
    printed = [];
    vi.spyOn(console, 'log').mockImplementation((line) => printed.push(line));
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('an app on App Store Connect', () => {
    test('is known by the id of its bundle id, and names where to make it when there is none', async () => {
        expect(await appStoreApp(call, 'dev.example.demo')).toBe('A1');
        answers['GET /apps?filter[bundleId]=dev.example.demo'] = { data: [] };
        await expect(appStoreApp(call, 'dev.example.demo')).rejects
            .toThrow('crossbind: App Store Connect has no app dev.example.demo: create it at https://appstoreconnect.apple.com/apps, a new iOS app with dev.example.demo as its bundle ID.');
    });

    test('takes a version to review unless it has the version out or in review, or App Review has another of its submissions', async () => {
        await assertReviewable(call, 'A1', '1.2.3');
        answers['GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3'] = { data: [{ id: 'V0', attributes: { versionString: '1.2.3', appVersionState: 'READY_FOR_DISTRIBUTION' } }] };
        await expect(assertReviewable(call, 'A1', '1.2.3')).rejects
            .toThrow('crossbind: App Store Connect has 1.2.3 as READY_FOR_DISTRIBUTION already, which takes no other build or listing: raise the version in package.json');
        delete answers['GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3'];
        const submissions = 'GET /apps/A1/reviewSubmissions?filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES';
        answers[submissions] = { data: [{ id: 'S0', attributes: { state: 'WAITING_FOR_REVIEW' } }] };
        await expect(assertReviewable(call, 'A1', '1.2.3')).rejects
            .toThrow("crossbind: App Review has the app's submission as WAITING_FOR_REVIEW, and takes one at a time: let it finish, or cancel it in App Store Connect.");
        answers[submissions] = { data: [{ id: 'S0', attributes: { state: 'UNRESOLVED_ISSUES' } }] };
        await expect(assertReviewable(call, 'A1', '1.2.3')).rejects
            .toThrow("crossbind: App Review answered the app's last submission with issues: resolve them in App Store Connect, which takes a new build there, or cancel that submission and release again.");
    });

    test('stops where a release stopped in a submission App Store Connect prepares, which it names to mend', async () => {
        answers[READY] = prepared('READY_FOR_REVIEW');
        await expect(assertReviewable(call, 'A1', '1.2.3')).rejects.toThrow(PREPARED);
        delete answers[READY];
        answers['GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3'] = { data: [{ id: 'V1', attributes: { versionString: '1.2.3', appVersionState: 'READY_FOR_REVIEW' } }] };
        await expect(assertReviewable(call, 'A1', '1.2.3')).rejects.toThrow(PREPARED);
    });
});

describe("a version's page on App Store Connect, sent alone", () => {
    test('makes the version and puts the listing and settings in, with no build and nothing for App Review', async () => {
        const listings = [
            { locale: 'en-US', info: { name: 'Demo', subtitle: 'A demo' }, version: { description: 'The demo app.', whatsNew: 'Fixes.' }, screenshots: {} },
            { locale: 'tr', info: {}, version: { whatsNew: 'Düzeltmeler.' }, screenshots: {} },
        ];

        expect(await settled(sendListing(call, {
            appId: 'A1', versionString: '1.2.3', listings, settings: { copyright: '2026 Example Ltd.' },
        }))).toEqual({ listed: ['en-US', 'tr'], settled: ['copyright'] });

        expect(keys().filter((key) => !key.startsWith('GET'))).toEqual([
            'POST /appStoreVersions',
            'PATCH /appStoreVersionLocalizations/L1',
            'PATCH /appInfoLocalizations/N1',
            'POST /appStoreVersionLocalizations',
            'PATCH /appStoreVersions/V1',
        ]);
        expect(keys().some((key) => /builds|reviewSubmission|PhasedRelease/.test(key))).toBe(false);
        expect(printed).toEqual([]);
    });
});

describe('what App Store Connect has of an app', () => {
    const versions = (platform) => `GET /apps/A1/appStoreVersions?filter[platform]=${platform}&limit=3`;
    const newest = (platform) => `GET /builds?filter[app]=A1&filter[preReleaseVersion.platform]=${platform}&sort=-uploadedDate&limit=1&include=preReleaseVersion`;

    test("is each platform's versions and newest build, as App Store Connect words their states, and nothing of a platform the app is not on", async () => {
        answers[versions('IOS')] = {
            data: [
                { id: 'V2', attributes: { versionString: '1.2.3', appVersionState: 'PREPARE_FOR_SUBMISSION' } },
                { id: 'V1', attributes: { versionString: '1.2.2', appVersionState: 'READY_FOR_DISTRIBUTION' } },
            ],
        };
        answers[newest('IOS')] = {
            data: [{ id: 'B2', attributes: { version: '42', processingState: 'PROCESSING' }, relationships: { preReleaseVersion: { data: { type: 'preReleaseVersions', id: 'P1' } } } }],
            included: [{ type: 'preReleaseVersions', id: 'P1', attributes: { version: '1.2.3' } }],
        };
        answers[versions('MAC_OS')] = { data: [] };
        answers[newest('MAC_OS')] = { data: [] };

        expect(await appStoreState(call, 'A1')).toEqual([
            'iOS 1.2.3: being prepared for submission',
            'iOS 1.2.2: out',
            'iOS newest build: 1.2.3 (42), processing',
        ]);
    });
});

describe("a version's submission to App Review", () => {
    test('makes the version, puts the listing in, picks the newest build TestFlight has processed and submits it', async () => {
        const listings = [
            { locale: 'en-US', info: { name: 'Demo', subtitle: 'A demo' }, version: { description: 'The demo app.', whatsNew: 'Fixes.' }, screenshots: {} },
            { locale: 'tr', info: {}, version: { whatsNew: 'Düzeltmeler.' }, screenshots: {} },
        ];

        expect(await release({ listings, isPhased: true })).toEqual({ build: '42', listed: ['en-US', 'tr'], settled: [] });

        expect(keys().filter((key) => !key.startsWith('GET'))).toEqual([
            'POST /appStoreVersions',
            'PATCH /appStoreVersionLocalizations/L1',
            'PATCH /appInfoLocalizations/N1',
            'POST /appStoreVersionLocalizations',
            'POST /appStoreVersionPhasedReleases',
            'PATCH /appStoreVersions/V1/relationships/build',
            'POST /reviewSubmissions',
            'POST /reviewSubmissionItems',
            'PATCH /reviewSubmissions/S1',
        ]);
        expect(bodyOf('POST /appStoreVersions').data).toEqual({ type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: '1.2.3' }, relationships: { app: { data: { type: 'apps', id: 'A1' } } } });
        expect(bodyOf('PATCH /appStoreVersionLocalizations/L1').data).toEqual({ type: 'appStoreVersionLocalizations', id: 'L1', attributes: { whatsNew: 'Fixes.' } });
        expect(bodyOf('PATCH /appInfoLocalizations/N1').data.attributes).toEqual({ subtitle: 'A demo' });
        expect(bodyOf('POST /appStoreVersionLocalizations').data).toEqual({
            type: 'appStoreVersionLocalizations', attributes: { locale: 'tr', whatsNew: 'Düzeltmeler.' }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: 'V1' } } },
        });
        expect(bodyOf('PATCH /appStoreVersions/V1/relationships/build')).toEqual({ data: { type: 'builds', id: 'B2' } });
        expect(bodyOf('POST /appStoreVersionPhasedReleases').data.attributes).toEqual({ phasedReleaseState: 'INACTIVE' });
        expect(bodyOf('POST /reviewSubmissionItems').data.relationships).toEqual({
            reviewSubmission: { data: { type: 'reviewSubmissions', id: 'S1' } }, appStoreVersion: { data: { type: 'appStoreVersions', id: 'V1' } },
        });
        expect(bodyOf('PATCH /reviewSubmissions/S1').data).toEqual({ type: 'reviewSubmissions', id: 'S1', attributes: { submitted: true } });
        expect(keys().filter((key) => key === BUILDS)).toHaveLength(1);
        expect(printed).toEqual([]);
    });

    test("takes a macOS version on its own platform, in every query and in what it makes", async () => {
        const mac = (key) => key.replaceAll('IOS', 'MAC_OS');
        Object.entries(DEFAULTS).filter(([key]) => key.includes('IOS')).forEach(([key, answer]) => { answers[mac(key)] = answer; });

        expect(await release({ platform: 'MAC_OS' })).toEqual({ build: '42', listed: [], settled: [] });

        expect(keys().filter((key) => key.includes('IOS'))).toEqual([]);
        expect(keys()).toContain(mac(BUILDS));
        expect(bodyOf('POST /appStoreVersions').data.attributes).toEqual({ platform: 'MAC_OS', versionString: '1.2.3' });
        expect(bodyOf('POST /reviewSubmissions').data.attributes).toEqual({ platform: 'MAC_OS' });
    });

    test('takes the version of the number App Store Connect prepares, or renames the one it prepares under another', async () => {
        answers['GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3'] = { data: [{ id: 'V1', attributes: { versionString: '1.2.3', appVersionState: 'REJECTED' } }] };
        await release();
        expect(keys()).not.toContain('POST /appStoreVersions');
        expect(keys()).toContain('PATCH /appStoreVersions/V1/relationships/build');

        calls = [];
        builds = [build('B2', 'VALID')];
        delete answers['GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3'];
        answers[`GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[appVersionState]=${EDITABLE}`] = { data: [{ id: 'V1', attributes: { versionString: '1.2.2', appVersionState: 'PREPARE_FOR_SUBMISSION' } }] };
        await release();
        expect(bodyOf('PATCH /appStoreVersions/V1').data).toEqual({ type: 'appStoreVersions', id: 'V1', attributes: { versionString: '1.2.3' } });
        expect(printed).toContain('crossbind: App Store Connect prepares 1.2.2, which becomes 1.2.3.');
    });

    test('leaves what App Store Connect has as it is: the same texts, a phased release it has, and phases unless asked for', async () => {
        const listings = [{ locale: 'en-US', info: { name: 'Demo' }, version: { description: 'The demo app.' }, screenshots: {} }];
        answers['GET /appStoreVersions/V1/appStoreVersionPhasedRelease'] = { data: { id: 'P1', attributes: { phasedReleaseState: 'INACTIVE' } } };
        expect((await release({ listings, isPhased: true })).listed).toEqual([]);
        expect(keys().filter((key) => /Localizations|PhasedReleases/.test(key) && !key.startsWith('GET'))).toEqual([]);

        calls = [];
        builds = [build('B2', 'VALID')];
        await release();
        expect(keys().filter((key) => key.includes('PhasedRelease'))).toEqual([]);
    });

    test("makes a locale's information of its name alone, before it changes anything", async () => {
        const listings = [{ locale: 'tr', info: { subtitle: 'Bir deneme' }, version: {}, screenshots: {} }];
        await expect(release({ listings })).rejects
            .toThrow(`crossbind: App Store Connect has no tr information of the app yet, which it makes of its name: add name.txt to ${path.join('store', 'app-store', 'tr')}.`);
        expect(keys().filter((key) => !key.startsWith('GET'))).toEqual(['POST /appStoreVersions']);
    });

    test('stops before it changes anything where the newest build is not processed, or failed, or there is none', async () => {
        builds = [build('B2', 'PROCESSING')];
        await expect(release()).rejects
            .toThrow('crossbind: App Store Connect is still processing build 42 of 1.2.3, usually for 5 to 30 minutes: release it once Apple mails that it has.');
        builds = [build('B2', 'INVALID')];
        await expect(release()).rejects
            .toThrow('crossbind: App Store Connect could not process build 42 of 1.2.3, which it marked INVALID; Apple mails why. crossbind app upload app-store puts another on TestFlight.');
        answers[BUILDS] = { data: [] };
        await expect(release()).rejects
            .toThrow('crossbind: App Store Connect has no iOS build of 1.2.3: crossbind app upload app-store puts one on TestFlight, and once Apple has processed it, crossbind app release app-store hands it to App Review.');
        expect(keys().filter((key) => !key.startsWith('GET'))).toEqual([]);
    });

    test("answers whether a build uses encryption as the app does where its upload gave no answer, and stops where the app gives none", async () => {
        builds = [build('B2', 'VALID', '42', null)];
        await release({ usesEncryption: false });
        expect(bodyOf('PATCH /builds/B2').data).toEqual({ type: 'builds', id: 'B2', attributes: { usesNonExemptEncryption: false } });

        calls = [];
        await expect(release()).rejects
            .toThrow('crossbind: App Review takes no build without its answer to whether it uses encryption, which build 42 of 1.2.3 went up without: set app.encryption in crossbind.config.js, which answers it, or answer it for the build in App Store Connect.');
        expect(keys().filter((key) => !key.startsWith('GET'))).toEqual([]);

        builds = [build('B2', 'VALID', '42', true)];
        await release({ usesEncryption: false });
        expect(keys()).not.toContain('PATCH /builds/B2');
    });

    test('goes in the submission App Store Connect prepares, whose removed items do not count, unless that has items in it', async () => {
        answers[READY] = prepared('REMOVED');
        await release();
        expect(keys()).not.toContain('POST /reviewSubmissions');
        expect(keys()).toContain('PATCH /reviewSubmissions/S7');

        calls = [];
        builds = [build('B2', 'VALID')];
        answers[READY] = prepared('READY_FOR_REVIEW');
        await expect(release()).rejects.toThrow(PREPARED);
        expect(keys()).not.toContain('POST /reviewSubmissionItems');
    });

    test('waits for the version to be ready for review before it submits, a while at most', async () => {
        let looks = 0;
        answers['GET /appStoreVersions/V1'] = () => ({ data: { id: 'V1', attributes: { appVersionState: (looks += 1) < 3 ? 'PREPARE_FOR_SUBMISSION' : 'READY_FOR_REVIEW' } } });
        await release();
        expect(keys().filter((key) => key === 'GET /appStoreVersions/V1')).toHaveLength(3);

        calls = [];
        builds = [build('B2', 'VALID')];
        answers['GET /appStoreVersions/V1'] = { data: { id: 'V1', attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION' } } };
        await release();
        expect(keys().filter((key) => key === 'GET /appStoreVersions/V1')).toHaveLength(10);
        expect(keys().at(-1)).toBe('PATCH /reviewSubmissions/S1');
    });

    test('clears a text the listing leaves empty, and gives a new localization none of its empty texts', async () => {
        const listings = [
            { locale: 'en-US', info: {}, version: { description: 'The demo app.', marketingUrl: '' }, screenshots: {} },
            { locale: 'tr', info: {}, version: { whatsNew: 'Düzeltmeler.', promotionalText: '' }, screenshots: {} },
        ];
        answers['GET /appStoreVersions/V1/appStoreVersionLocalizations?limit=200'] = { data: [{ id: 'L1', attributes: { locale: 'en-US', description: 'The demo app.', marketingUrl: 'https://example.com' } }] };
        await release({ listings });
        expect(bodyOf('PATCH /appStoreVersionLocalizations/L1').data.attributes).toEqual({ marketingUrl: null });
        expect(bodyOf('POST /appStoreVersionLocalizations').data.attributes).toEqual({ locale: 'tr', whatsNew: 'Düzeltmeler.' });
    });
});

describe("a version's screenshots on App Store Connect", () => {
    const SETS = 'GET /appStoreVersionLocalizations/L1/appScreenshotSets?include=appScreenshots&limit[appScreenshots]=50';
    const md5 = (text) => createHash('md5').update(text).digest('hex');
    // The set App Store Connect shows of the 6.7-inch iPhone, with a screenshot of each text, processed unless `state` says.
    const shown = (texts, state = 'COMPLETE', checksumOf = md5) => ({
        data: [{ id: 'SET1', attributes: { screenshotDisplayType: 'APP_IPHONE_67' }, relationships: { appScreenshots: { data: texts.map((_, index) => ({ type: 'appScreenshots', id: `OLD${index + 1}` })) } } }],
        included: texts.map((shot, index) => ({ type: 'appScreenshots', id: `OLD${index + 1}`, attributes: { sourceFileChecksum: checksumOf(shot), assetDeliveryState: { state } } })),
    });
    const processed = (setId, ids, state = 'COMPLETE') => {
        answers[`GET /appScreenshotSets/${setId}/appScreenshots?limit=200`] = { data: ids.map((id) => ({ id, attributes: { assetDeliveryState: { state } } })) };
    };
    let dir;
    const file = (name, text) => {
        fs.writeFileSync(path.join(dir, name), text);
        return path.join(dir, name);
    };
    const listed = (screenshots, locale = 'en-US') => [{
        locale, info: {}, version: {}, screenshots,
    }];

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-app-store-shots-'));
        let reserved = 0;
        answers['POST /appScreenshots'] = ({ data }) => {
            reserved += 1;
            const uploadOperations = [{ method: 'PUT', url: `https://upload.example.test/${reserved}`, offset: 0, length: data.attributes.fileSize }];
            return { data: { id: `SS${reserved}`, type: 'appScreenshots', attributes: { ...data.attributes, uploadOperations } } };
        };
        processed('SET1', ['SS1', 'SS2']);
        processed('SET2', ['SS1']);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('leave a display type as it is where App Store Connect shows the same in the same order', async () => {
        answers[SETS] = shown(['first', 'second'], 'COMPLETE', (shot) => md5(shot).toUpperCase());
        expect((await release({ listings: listed({ APP_IPHONE_67: [file('1.png', 'first'), file('2.png', 'second')] }) })).listed).toEqual([]);
        expect(keys().filter((key) => key.includes('Screenshot') && !key.startsWith('GET'))).toEqual([]);
        expect(keys().filter((key) => key.includes('/appScreenshotSets/'))).toEqual([]);
    });

    test('go up anew where App Store Connect shows the same files unprocessed, or refused, as a stopped upload leaves them', async () => {
        answers[SETS] = shown(['first'], 'FAILED');
        processed('SET1', ['SS1']);
        expect((await release({ listings: listed({ APP_IPHONE_67: [file('1.png', 'first')] }) })).listed).toEqual(['en-US']);
        expect(keys()).toContain('DELETE /appScreenshots/OLD1');

        calls = [];
        builds = [build('B2', 'VALID')];
        answers[SETS] = shown(['first'], 'UPLOAD_COMPLETE');
        processed('SET1', ['SS2']);
        answers['DELETE /appScreenshots/OLD1'] = () => {
            throw Object.assign(new Error('crossbind: App Store Connect answered DELETE /appScreenshots/OLD1 with 404.'), { status: 404 });
        };
        await release({ listings: listed({ APP_IPHONE_67: [file('1.png', 'first')] }) });
        expect(keys()).toContain('PATCH /appScreenshotSets/SET1/relationships/appScreenshots');
    });

    test('go up anew where they differ: reserved, uploaded, committed with their checksum, processed, then put in order', async () => {
        answers[SETS] = shown(['first', 'second']);
        const files = [file('1.png', 'second'), file('2.png', 'first')];

        expect((await release({ listings: listed({ APP_IPHONE_67: files }) })).listed).toEqual(['en-US']);

        expect(keys().filter((key) => key.includes('Screenshot') && !key.startsWith('GET'))).toEqual([
            'DELETE /appScreenshots/OLD1',
            'DELETE /appScreenshots/OLD2',
            'POST /appScreenshots',
            'PATCH /appScreenshots/SS1',
            'POST /appScreenshots',
            'PATCH /appScreenshots/SS2',
            'PATCH /appScreenshotSets/SET1/relationships/appScreenshots',
        ]);
        expect(calls.filter(({ key }) => key === 'POST /appScreenshots').map(({ body }) => body.data)).toEqual([
            { type: 'appScreenshots', attributes: { fileName: '1.png', fileSize: 6 }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: 'SET1' } } } },
            { type: 'appScreenshots', attributes: { fileName: '2.png', fileSize: 5 }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: 'SET1' } } } },
        ]);
        expect(parts).toEqual([
            { operations: [{ method: 'PUT', url: 'https://upload.example.test/1', offset: 0, length: 6 }], bytes: 'second', file: files[0] },
            { operations: [{ method: 'PUT', url: 'https://upload.example.test/2', offset: 0, length: 5 }], bytes: 'first', file: files[1] },
        ]);
        expect(bodyOf('PATCH /appScreenshots/SS1').data.attributes).toEqual({ uploaded: true, sourceFileChecksum: md5('second') });
        expect(bodyOf('PATCH /appScreenshotSets/SET1/relationships/appScreenshots')).toEqual({ data: [{ type: 'appScreenshots', id: 'SS1' }, { type: 'appScreenshots', id: 'SS2' }] });
        expect(keys().indexOf('PATCH /appScreenshotSets/SET1/relationships/appScreenshots')).toBeLessThan(keys().indexOf('PATCH /appStoreVersions/V1/relationships/build'));
    });

    test("make the set of a display type App Store Connect lacks, in a new localization for a locale of screenshots alone", async () => {
        answers['POST /appStoreVersionLocalizations'] = ({ data }) => ({ data: { id: 'L2', ...data } });
        answers['GET /appStoreVersionLocalizations/L2/appScreenshotSets?include=appScreenshots&limit[appScreenshots]=50'] = { data: [] };
        answers['POST /appScreenshotSets'] = ({ data }) => ({ data: { id: 'SET2', ...data } });

        await release({ listings: listed({ APP_IPAD_PRO_3GEN_129: [file('ipad.png', 'ipad')] }, 'tr') });

        expect(bodyOf('POST /appStoreVersionLocalizations').data.attributes).toEqual({ locale: 'tr' });
        expect(bodyOf('POST /appScreenshotSets').data).toEqual({
            type: 'appScreenshotSets', attributes: { screenshotDisplayType: 'APP_IPAD_PRO_3GEN_129' }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: 'L2' } } },
        });
        expect(bodyOf('POST /appScreenshots').data.relationships.appScreenshotSet).toEqual({ data: { type: 'appScreenshotSets', id: 'SET2' } });
    });

    test('name a screenshot App Store Connect refuses, before the version takes the build', async () => {
        answers[SETS] = { data: [] };
        answers['POST /appScreenshotSets'] = ({ data }) => ({ data: { id: 'SET1', ...data } });
        answers['GET /appScreenshotSets/SET1/appScreenshots?limit=200'] = {
            data: [{ id: 'SS1', attributes: { assetDeliveryState: { state: 'FAILED', errors: [{ code: 'IMAGE_INCORRECT_DIMENSIONS', description: 'The dimensions of one or more screenshots are wrong.' }] } } }],
        };
        const shot = file('1.png', 'first');
        await expect(release({ listings: listed({ APP_IPHONE_67: [shot] }) })).rejects
            .toThrow(`crossbind: App Store Connect refused ${shot}: The dimensions of one or more screenshots are wrong.`);
        expect(keys()).not.toContain('PATCH /appStoreVersions/V1/relationships/build');

        processed('SET1', ['SS2'], 'FAILED');
        await expect(release({ listings: listed({ APP_IPHONE_67: [shot] }) })).rejects.toThrow(`crossbind: App Store Connect refused ${shot}.`);
    });

    test('name the file whose reservation App Store Connect refuses', async () => {
        answers[SETS] = { data: [] };
        answers['POST /appScreenshotSets'] = ({ data }) => ({ data: { id: 'SET1', ...data } });
        answers['POST /appScreenshots'] = () => {
            throw Object.assign(new Error('crossbind: App Store Connect answered POST /appScreenshots with 409: The file is empty.'), { status: 409 });
        };
        const shot = file('1.png', 'first');
        await expect(release({ listings: listed({ APP_IPHONE_67: [shot] }) })).rejects.toMatchObject({
            status: 409, message: `crossbind: App Store Connect answered POST /appScreenshots with 409: The file is empty.\ncrossbind: it answered so for ${shot}.`,
        });
    });

    test('stop where App Store Connect has not processed them within 10 minutes, naming what to do', async () => {
        answers[SETS] = { data: [] };
        answers['POST /appScreenshotSets'] = ({ data }) => ({ data: { id: 'SET1', ...data } });
        processed('SET1', ['SS1'], 'UPLOAD_COMPLETE');
        await expect(release({ listings: listed({ APP_IPHONE_67: [file('1.png', 'first')] }) })).rejects
            .toThrow('crossbind: App Store Connect has not processed the screenshots in 10 minutes, so the version went to no review: once it has, release again.');
        expect(keys().filter((key) => key === 'GET /appScreenshotSets/SET1/appScreenshots?limit=200')).toHaveLength(121);
    });

    test('stop a page sent alone where App Store Connect has not processed them within 10 minutes, saying where they show once it has', async () => {
        answers[SETS] = { data: [] };
        answers['POST /appScreenshotSets'] = ({ data }) => ({ data: { id: 'SET1', ...data } });
        processed('SET1', ['SS1'], 'UPLOAD_COMPLETE');
        await expect(settled(sendListing(call, { appId: 'A1', versionString: '1.2.3', listings: listed({ APP_IPHONE_67: [file('1.png', 'first')] }) }))).rejects
            .toThrow("crossbind: App Store Connect has not processed the screenshots in 10 minutes: once it has, they show in 1.2.3's listing there.");
    });
});

describe("the iOS version's creative assets", () => {
    const header = 'PRODUCT_PAGE_HEADER_ASSET';
    const search = 'APP_STORE_SEARCH_RESULTS_ASSET';
    const slots = `GET /appStoreVersionLocalizations/L1/placements?filter[placementGroup]=DEFAULT_PROFILE&filter[placementType]=${header},${search}&include=image,video`;
    const lookup = 'GET /appAssetLibraries/LIB/images?filter[category]=CREATIVE_ASSETS&filter';
    const existing = '6e4f57c4-447c-464f-9525-ca3856ea8afc';
    const approved = (id, attributes = {}) => ({ id, attributes: {
        state: 'APPROVED', specId: 'universal', imageAsset: { width: 5244, height: 2950 }, fileName: 'map.png', ...attributes,
    } });
    const placed = (placementType, id) => ({
        id: placementType, attributes: { placementType, placementGroup: 'DEFAULT_PROFILE' }, relationships: { image: { data: { type: 'appAssetLibraryImages', id } } },
    });
    let current;
    let dir;
    const listings = (creativeAssets) => [{ locale: 'en-US', info: {}, version: {}, screenshots: {}, creativeAssets }];
    const send = (creativeAssets) => settled(sendListing(call, { appId: 'A1', versionString: '1.2.3', listings: listings(creativeAssets) }));

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-creative-'));
        current = [];
        answers['GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3'] = { data: [{ id: 'V1', attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION', versionString: '1.2.3' } }] };
        answers['GET /apps/A1/assetLibrary'] = { data: { id: 'LIB' } };
        answers[`${lookup}[id]=${existing}`] = { data: [approved(existing)] };
        answers[slots] = () => ({ data: [...current] });
        answers['POST /appAssetLibraryPlacements'] = ({ data }) => {
            expect(data.relationships.appStoreVersionLocalization.data.id).toBe('L1');
            const slot = placed(data.attributes.placementType, data.relationships.image.data.id);
            current.push(slot);
            return { data: slot };
        };
        for (const type of [header, search]) {
            answers[`DELETE /appAssetLibraryPlacements/${type}`] = () => {
                current = current.filter((slot) => slot.id !== type);
                return {};
            };
        }
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('uploads shared bytes once, resumes processing, and leaves an identical draft alone on the next send', async () => {
        const file = path.join(dir, 'universal.png');
        fs.writeFileSync(file, 'shared image bytes');
        const referenceName = `crossbind-${createHash('sha256').update('shared image bytes').digest('hex').slice(0, 40)}`;
        answers[`${lookup}[referenceName]=${referenceName}`] = { data: [] };
        answers['POST /appAssetLibraryImages'] = ({ data }) => {
            expect(data.attributes).toEqual({ fileName: 'universal.png', fileSize: 18, category: 'CREATIVE_ASSETS', referenceName });
            expect(data.relationships.assetLibrary.data.id).toBe('LIB');
            return { data: { id: 'NEW', attributes: { state: 'AWAITING_UPLOAD', uploadOperations: ['part'] } } };
        };
        const ready = approved('NEW', { referenceName });
        let reads = 0;
        answers['GET /appAssetLibraryImages/NEW'] = () => ({ data: reads++ ? ready : { id: 'NEW', attributes: { state: 'UPLOAD_COMPLETE' } } });
        expect((await send({ universal: { file } })).listed).toEqual(['en-US']);
        expect(parts).toEqual([{ operations: ['part'], bytes: 'shared image bytes', file }]);
        expect(bodyOf('PATCH /appAssetLibraryImages/NEW').data.attributes).toEqual({ uploaded: true });
        expect(current).toEqual([placed(header, 'NEW'), placed(search, 'NEW')]);

        answers[`${lookup}[referenceName]=${referenceName}`] = { data: [ready] };
        calls = [];
        expect((await send({ universal: { file } })).listed).toEqual([]);
        expect(keys().every((key) => key.startsWith('GET'))).toBe(true);
    });

    test('reuses library IDs, overrides only search, and includes the placements in the normal release', async () => {
        current = [placed(header, existing), placed(search, existing)];
        const id = '81542bc4-29de-4319-89f6-4859b954b5b3';
        answers[`${lookup}[id]=${id}`] = { data: [approved(id, { imageAsset: { width: 1920, height: 1280 }, fileName: 'search.jpg' })] };
        const assets = { universal: { file: 'universal.id', id: existing }, 'search-results': { file: 'search-results.id', id } };
        expect((await release({ listings: listings(assets) })).listed).toEqual(['en-US']);
        expect(current).toEqual([placed(header, existing), placed(search, id)]);
        expect(parts).toEqual([]);
        expect(keys()).not.toContain(`DELETE /appAssetLibraryPlacements/${header}`);
        expect(keys().indexOf('POST /appAssetLibraryPlacements')).toBeLessThan(keys().indexOf('POST /reviewSubmissions'));
    });

    test('rejects missing, failed, or incompatible library artwork before removing any placement', async () => {
        current = [placed(header, 'original')];
        for (const [data, message] of [
            [[], 'missing'], [[approved(existing, { state: 'FAILED', stateDetails: 'Invalid payload' })], 'Invalid payload'],
            [[approved(existing, { imageAsset: { width: 1920, height: 1280 } })], 'does not fit header'],
        ]) {
            answers[`${lookup}[id]=${existing}`] = { data };
            await expect(send({ header: { file: 'header.id', id: existing } })).rejects.toThrow(message);
        }
        expect(keys().every((key) => key.startsWith('GET'))).toBe(true);
    });

    test('restores the previous image if Apple refuses to create its replacement', async () => {
        current = [placed(search, 'other'), placed(header, 'original')];
        const create = answers['POST /appAssetLibraryPlacements'];
        answers['POST /appAssetLibraryPlacements'] = (body) => {
            if (body.data.relationships.image.data.id === existing) throw new Error('placement refused');
            return create(body);
        };
        await expect(send({ header: { file: 'header.id', id: existing } })).rejects.toThrow('placement refused');
        expect(current).toEqual([placed(search, 'other'), placed(header, 'original')]);
    });
});

describe("a version's settings on App Store Connect", () => {
    test('clears an existing sign-in requirement and skips an identical review flag', async () => {
        const key = 'GET /appStoreVersions/V1/appStoreReviewDetail';
        const settings = { review: { demoAccountRequired: false } };
        answers[key] = { data: { id: 'R1', attributes: { demoAccountRequired: true } } };
        await release({ settings });
        expect(bodyOf('PATCH /appStoreReviewDetails/R1').data.attributes).toEqual({ demoAccountRequired: false });
        calls = [];
        answers[key].data.attributes.demoAccountRequired = false;
        await release({ settings });
        expect(keys()).not.toContain('PATCH /appStoreReviewDetails/R1');
    });

    const SETTINGS = {
        copyright: '2026 Example Ltd.',
        categories: { primaryCategory: 'UTILITIES', secondaryCategory: 'PRODUCTIVITY' },
        ageRating: { violenceCartoonOrFantasy: 'NONE', gambling: false },
        review: { contactEmail: 'review@example.com', notes: 'No sign-in.' },
    };
    const notFound = () => {
        throw Object.assign(new Error('not found'), { status: 404 });
    };

    test("change the copyright, categories, age rating and App Review's contact where App Store Connect's differ", async () => {
        answers['GET /appInfos/I1?include=primaryCategory,secondaryCategory'] = {
            data: { id: 'I1', relationships: { primaryCategory: { data: { type: 'appCategories', id: 'PRODUCTIVITY' } }, secondaryCategory: { data: null } } },
        };
        answers['GET /appInfos/I1/ageRatingDeclaration'] = { data: { id: 'R1', attributes: { violenceCartoonOrFantasy: 'NONE', gambling: true } } };
        answers['GET /appStoreVersions/V1/appStoreReviewDetail'] = notFound;

        expect((await release({ settings: SETTINGS })).settled).toEqual(['copyright', 'categories', 'age rating', 'App Review information']);

        expect(bodyOf('PATCH /appStoreVersions/V1')).toEqual({ data: { type: 'appStoreVersions', id: 'V1', attributes: { copyright: '2026 Example Ltd.' } } });
        expect(bodyOf('PATCH /appInfos/I1')).toEqual({
            data: {
                type: 'appInfos',
                id: 'I1',
                relationships: {
                    primaryCategory: { data: { type: 'appCategories', id: 'UTILITIES' } },
                    secondaryCategory: { data: { type: 'appCategories', id: 'PRODUCTIVITY' } },
                },
            },
        });
        expect(bodyOf('PATCH /ageRatingDeclarations/R1')).toEqual({ data: { type: 'ageRatingDeclarations', id: 'R1', attributes: { gambling: false } } });
        expect(bodyOf('POST /appStoreReviewDetails')).toEqual({
            data: {
                type: 'appStoreReviewDetails', attributes: SETTINGS.review, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: 'V1' } } },
            },
        });
        const order = keys();
        expect(order.indexOf('POST /appStoreReviewDetails')).toBeLessThan(order.indexOf('POST /reviewSubmissions'));
    });

    test('leave what App Store Connect has as the settings give it, and change the contact it has where it differs', async () => {
        answers['GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3'] = {
            data: [{ id: 'V1', attributes: { versionString: '1.2.3', appVersionState: 'PREPARE_FOR_SUBMISSION', copyright: '2026 Example Ltd.' } }],
        };
        answers['GET /appInfos/I1?include=primaryCategory,secondaryCategory'] = {
            data: { id: 'I1', relationships: { primaryCategory: { data: { id: 'UTILITIES' } }, secondaryCategory: { data: { id: 'PRODUCTIVITY' } } } },
        };
        answers['GET /appInfos/I1/ageRatingDeclaration'] = { data: { id: 'R1', attributes: { violenceCartoonOrFantasy: 'NONE', gambling: false } } };
        answers['GET /appStoreVersions/V1/appStoreReviewDetail'] = { data: { id: 'D1', attributes: { contactEmail: 'review@example.com', notes: 'Old notes.' } } };

        expect((await release({ settings: SETTINGS })).settled).toEqual(['App Review information']);
        expect(keys().filter((key) => /^(PATCH|POST) \/(appStoreVersions\/V1$|appInfos|ageRatingDeclarations|appStoreReviewDetails)/.test(key))).toEqual(['PATCH /appStoreReviewDetails/D1']);
        expect(bodyOf('PATCH /appStoreReviewDetails/D1')).toEqual({ data: { type: 'appStoreReviewDetails', id: 'D1', attributes: { notes: 'No sign-in.' } } });
    });

    test('stop where App Store Connect takes the categories and age rating in none of its versions now, naming the files to remove', async () => {
        answers['GET /apps/A1/appInfos'] = { data: [{ id: 'I0', attributes: { state: 'READY_FOR_DISTRIBUTION' } }] };
        await expect(release({ settings: { categories: { primaryCategory: 'UTILITIES' }, review: {} } })).rejects
            .toThrow("crossbind: App Store Connect takes the app's categories and age rating in none of its versions now: remove primary_category.txt, secondary_category.txt and age_rating.json from");
    });
});
