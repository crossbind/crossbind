import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../src/state/index.js', () => ({ default: { config: {} } }));
// The uploads of screenshots' bytes where App Store Connect reserved them.
const parts = [];
vi.mock('../src/publishers/app-store/appStoreApi.js', () => ({
    uploadParts: async (operations, bytes, file) => {
        parts.push({ operations, bytes: String(bytes), file });
    },
}));

const {
    appStoreApp, assertReviewable, newestBuild, submitRelease,
} = await import('../src/publishers/app-store/appStoreRelease.js');

const EDITABLE = 'PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,REJECTED,METADATA_REJECTED,INVALID_BINARY';
const BUILDS = 'GET /builds?filter[app]=A1&filter[preReleaseVersion.version]=1.2.3&filter[preReleaseVersion.platform]=IOS&sort=-uploadedDate&limit=1';
const build = (id, processingState, version = '42') => ({ id, attributes: { version, processingState } });
const READY = 'GET /apps/A1/reviewSubmissions?filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&include=items';
const PREPARED = 'crossbind: App Store Connect prepares a review submission of the app with items in it already, as one a publish stopped in leaves: submit or remove them there, then publish again.';
// The submission App Store Connect prepares, with an item in the state given.
const prepared = (state) => ({
    data: [{ id: 'S7', attributes: { state: 'READY_FOR_REVIEW' }, relationships: { items: { data: [{ type: 'reviewSubmissionItems', id: 'X1' }] } } }],
    included: [{ type: 'reviewSubmissionItems', id: 'X1', attributes: { state } }],
});

let calls;
let answers;
let builds;
let printed;
// App Store Connect as a publish sees one app: its answers by method and route, else those of an app with no version of
// 1.2.3 and none prepared, the upload's build B2 processed after B1, and nothing in review. What it is given it keeps.
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
const release = (options = {}) => settled(submitRelease(call, {
    appId: 'A1', versionString: '1.2.3', before: 'B1', listings: [], isPhased: false, ...options,
}));

beforeEach(() => {
    vi.useFakeTimers();
    parts.length = 0;
    calls = [];
    answers = {};
    builds = [build('B1', 'VALID', '41'), build('B2', 'PROCESSING'), build('B2', 'VALID')];
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
            .toThrow('crossbind: App Store Connect has 1.2.3 as READY_FOR_DISTRIBUTION already, which takes no other build: raise the version in package.json');
        delete answers['GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3'];
        const submissions = 'GET /apps/A1/reviewSubmissions?filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES';
        answers[submissions] = { data: [{ id: 'S0', attributes: { state: 'WAITING_FOR_REVIEW' } }] };
        await expect(assertReviewable(call, 'A1', '1.2.3')).rejects
            .toThrow("crossbind: App Review has the app's submission as WAITING_FOR_REVIEW, and takes one at a time: let it finish, or cancel it in App Store Connect.");
        answers[submissions] = { data: [{ id: 'S0', attributes: { state: 'UNRESOLVED_ISSUES' } }] };
        await expect(assertReviewable(call, 'A1', '1.2.3')).rejects
            .toThrow("crossbind: App Review answered the app's last submission with issues, which App Store Connect resolves: publish without --submit, pick the new build there and resubmit");
    });

    test('stops before the build where a publish stopped in a submission App Store Connect prepares, which it names to mend', async () => {
        answers[READY] = prepared('READY_FOR_REVIEW');
        await expect(assertReviewable(call, 'A1', '1.2.3')).rejects.toThrow(PREPARED);
        delete answers[READY];
        answers['GET /apps/A1/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.2.3'] = { data: [{ id: 'V1', attributes: { versionString: '1.2.3', appVersionState: 'READY_FOR_REVIEW' } }] };
        await expect(assertReviewable(call, 'A1', '1.2.3')).rejects.toThrow(PREPARED);
    });

    test("has a newest build of a version, or none, which tells the upload's from it", async () => {
        expect(await newestBuild(call, 'A1', '1.2.3')).toBe('B1');
        answers[BUILDS] = { data: [] };
        expect(await newestBuild(call, 'A1', '1.2.3')).toBeNull();
    });
});

describe("a version's submission to App Review", () => {
    test('makes the version, puts the listing in, waits for the build to be processed, picks it and submits it', async () => {
        const listings = [
            { locale: 'en-US', info: { name: 'Demo', subtitle: 'A demo' }, version: { description: 'The demo app.', whatsNew: 'Fixes.' }, screenshots: {} },
            { locale: 'tr', info: {}, version: { whatsNew: 'Düzeltmeler.' }, screenshots: {} },
        ];

        expect(await release({ listings, isPhased: true })).toEqual({ build: '42', listed: ['en-US', 'tr'] });

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
        expect(keys().filter((key) => key === BUILDS)).toHaveLength(3);
        expect(printed).toEqual(['crossbind: waiting for App Store Connect to process the build, usually 5 to 30 minutes.']);
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

    test('stops where the build fails processing, or is not processed within an hour, saying how long it waited', async () => {
        builds = [build('B2', 'INVALID')];
        await expect(release()).rejects.toThrow('crossbind: App Store Connect could not process build 42 of 1.2.3, which it marked INVALID; Apple mails why.');

        builds = [build('B1', 'VALID', '41')];
        await expect(release()).rejects
            .toThrow('crossbind: App Store Connect has not processed the build in 60 minutes, so it went to no review: once it has, pick it for 1.2.3 in App Store Connect and submit it there.');
        expect(printed).toContain('crossbind: App Store Connect is still processing the build, 5 minutes on.');
        expect(printed).toContain('crossbind: App Store Connect is still processing the build, 55 minutes on.');
        expect(keys()).not.toContain('PATCH /appStoreVersions/V1/relationships/build');
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

    test("looks for the build of its number where the upload has one", async () => {
        answers[`${BUILDS.replace('&sort=', '&filter[version]=42&sort=')}`] = { data: [build('B2', 'VALID')] };
        await release({ buildNumber: 42 });
        expect(keys()).toContain(BUILDS.replace('&sort=', '&filter[version]=42&sort='));
        expect(keys()).not.toContain(BUILDS);
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

    test('go up anew where App Store Connect shows the same files unprocessed, or refused, as a stopped publish leaves them', async () => {
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
        expect(keys().indexOf('PATCH /appScreenshotSets/SET1/relationships/appScreenshots')).toBeLessThan(keys().indexOf(BUILDS));
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

    test('name a screenshot App Store Connect refuses, before the build is waited for', async () => {
        answers[SETS] = { data: [] };
        answers['POST /appScreenshotSets'] = ({ data }) => ({ data: { id: 'SET1', ...data } });
        answers['GET /appScreenshotSets/SET1/appScreenshots?limit=200'] = {
            data: [{ id: 'SS1', attributes: { assetDeliveryState: { state: 'FAILED', errors: [{ code: 'IMAGE_INCORRECT_DIMENSIONS', description: 'The dimensions of one or more screenshots are wrong.' }] } } }],
        };
        const shot = file('1.png', 'first');
        await expect(release({ listings: listed({ APP_IPHONE_67: [shot] }) })).rejects
            .toThrow(`crossbind: App Store Connect refused ${shot}: The dimensions of one or more screenshots are wrong.`);
        expect(keys()).not.toContain(BUILDS);

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
            .toThrow('crossbind: App Store Connect has not processed the screenshots in 10 minutes, so the version went to no review: once it has, pick the build for 1.2.3 in App Store Connect and submit it there.');
        expect(keys().filter((key) => key === 'GET /appScreenshotSets/SET1/appScreenshots?limit=200')).toHaveLength(121);
    });
});
