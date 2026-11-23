import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import upath from 'upath';
import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    changedSubmission, partnerCenterCaller, releaseSubmission, storeApp, submitPackages, uploadBlob,
} from '../../../extensions/microsoft-store/src/partnerCenter.js';
import { writeZip } from '../../../extensions/microsoft-store/src/submissionZip.js';
import { pngOf, writeUnder } from './listingImages.js';

let dir;
let requests;
const SAS = 'https://storage.example.test/ingestion/abc?sv=2014-02-14&sig=x';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
// The message a step fails with, its paths with forward slashes.
const failureOf = (step) => {
    try {
        step();
    } catch (error) {
        return upath.toUnix(error.message);
    }
    return null;
};

// The entries of a zip as a reader finds them through its central directory, each with its bytes and whether their CRC
// is the one the directory gives.
function entriesOf(zip) {
    const bytes = fs.readFileSync(zip);
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const entries = [];
    for (let index = 0, at = bytes.readUInt32LE(end + 16); index < bytes.readUInt16LE(end + 10); index += 1) {
        const size = bytes.readUInt32LE(at + 24);
        const nameLength = bytes.readUInt16LE(at + 28);
        const offset = bytes.readUInt32LE(at + 42);
        const start = offset + 30 + bytes.readUInt16LE(offset + 26);
        const data = bytes.subarray(start, start + size);
        entries.push({
            name: bytes.toString('utf8', at + 46, at + 46 + nameLength), text: data.toString(), isCrcRight: bytes.readUInt32LE(at + 16) === zlib.crc32(data), flags: bytes.readUInt16LE(at + 8),
        });
        at += 46 + nameLength;
    }
    return entries;
}

// Runs a step to its end as time passes for its waits.
async function settled(promise) {
    let result;
    promise.then((value) => { result = { value }; }, (error) => { result = { error }; });
    while (!result) await vi.advanceTimersByTimeAsync(30_000);
    if (result.error) throw result.error;
    return result.value;
}

beforeEach(() => {
    dir = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-ms-submission-')));
    requests = [];
    vi.stubGlobal('fetch', async (url, init = {}) => {
        requests.push({ url: String(url), init });
        return new Response(null, { status: 201 });
    });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('a submission Partner Center made', () => {
    const shot = () => writeUnder(dir, 'shots/01.png', pngOf(1920, 1080));
    const created = (shotName) => ({
        id: 'S2',
        fileUploadUrl: SAS,
        applicationCategory: 'Productivity',
        applicationPackages: [{ fileName: 'demo-win32-x64.msix', fileStatus: 'Uploaded', id: 'P1' }],
        listings: {
            'en-us': {
                platformOverrides: {},
                baseListing: {
                    title: 'Demo',
                    description: 'Old.',
                    images: [
                        {
                            fileName: shotName, fileStatus: 'Uploaded', id: 'G1', imageType: 'Screenshot', description: 'Old caption',
                        },
                        {
                            fileName: 'tile.png', fileStatus: 'Uploaded', id: 'G2', imageType: 'Icon', description: '',
                        },
                    ],
                },
            },
        },
        packageDeliveryOptions: { packageRollout: { isPackageRollout: true, packageRolloutPercentage: 20, fallbackSubmissionId: '1' }, isMandatoryUpdate: false },
    });

    test("takes the build's packages in place of the old ones, the listing's texts, and the images that differ, anew", () => {
        const file = shot();
        const tile = writeUnder(dir, 'tile.png', pngOf(300, 300));
        const packages = [writeUnder(dir, 'dist/demo-win32-x64.msix', 'x64'), writeUnder(dir, 'dist/demo-win32-arm64.msix', 'arm64')];
        const shotName = `en-us-Screenshot-${digest(fs.readFileSync(file))}.png`;
        const tileName = `en-us-Icon-${digest(fs.readFileSync(tile))}.png`;
        const listings = [{
            language: 'en-US',
            texts: { description: 'New.', features: ['Converts'] },
            images: { Screenshot: [{ file, caption: 'The library' }], Icon: [{ file: tile }] },
        }];

        const { submission, uploads } = changedSubmission(created(shotName), {
            packages, listings, settings: { category: 'UtilitiesAndTools', notesForCertification: 'No sign-in.' },
        });

        expect(submission.applicationPackages).toEqual([
            {
                fileName: 'demo-win32-x64.msix', fileStatus: 'PendingDelete', id: 'P1',
            },
            {
                fileName: 'demo-win32-x64.msix', fileStatus: 'PendingUpload', minimumDirectXVersion: 'None', minimumSystemRam: 'None',
            },
            {
                fileName: 'demo-win32-arm64.msix', fileStatus: 'PendingUpload', minimumDirectXVersion: 'None', minimumSystemRam: 'None',
            },
        ]);
        expect(submission.listings['en-us'].baseListing).toEqual({
            title: 'Demo',
            description: 'New.',
            features: ['Converts'],
            images: [
                {
                    fileName: shotName, fileStatus: 'Uploaded', id: 'G1', imageType: 'Screenshot', description: 'The library',
                },
                {
                    fileName: 'tile.png', fileStatus: 'PendingDelete', id: 'G2', imageType: 'Icon', description: '',
                },
                {
                    fileName: tileName, fileStatus: 'PendingUpload', imageType: 'Icon', description: '',
                },
            ],
        });
        expect(uploads.map(({ name, file: source }) => [name, upath.toUnix(source)])).toEqual([
            ['demo-win32-x64.msix', packages[0]], ['demo-win32-arm64.msix', packages[1]], [tileName, tile],
        ]);
        expect(submission).toMatchObject({ applicationCategory: 'UtilitiesAndTools', notesForCertification: 'No sign-in.' });
        expect(submission.packageDeliveryOptions).toEqual(created(shotName).packageDeliveryOptions);
        expect(changedSubmission(created(shotName), { rollout: 12.5 }).submission.packageDeliveryOptions)
            .toEqual({ packageRollout: { isPackageRollout: true, packageRolloutPercentage: 12.5, fallbackSubmissionId: '1' }, isMandatoryUpdate: false });
        expect(changedSubmission(created(shotName), { rollout: null }).submission.packageDeliveryOptions.packageRollout)
            .toEqual({ isPackageRollout: false, packageRolloutPercentage: 0, fallbackSubmissionId: '1' });
    });

    test('keeps the packages and the rollout Partner Center has where the listing goes alone', () => {
        const tile = writeUnder(dir, 'tile.png', pngOf(300, 300));
        const tileName = `en-us-Icon-${digest(fs.readFileSync(tile))}.png`;
        const made = created('old.png');
        const { submission, uploads } = changedSubmission(made, {
            packages: null, listings: [{ language: 'en-US', texts: { description: 'New.' }, images: { Icon: [{ file: tile }] } }],
        });
        expect(submission.applicationPackages).toEqual(made.applicationPackages);
        expect(submission.packageDeliveryOptions).toEqual(made.packageDeliveryOptions);
        expect(submission.listings['en-us'].baseListing.description).toBe('New.');
        expect(uploads.map(({ name }) => name)).toEqual([tileName]);
    });

    test('gives a first submission, which comes with no device families, the desktop alone, and keeps those another has', () => {
        const first = {
            id: 'S1', fileUploadUrl: SAS, applicationPackages: [], listings: {}, allowTargetFutureDeviceFamilies: {},
        };
        expect(changedSubmission(first, {}).submission.allowTargetFutureDeviceFamilies).toEqual({
            Desktop: true, Mobile: false, Xbox: false, Holographic: false,
        });
        const families = {
            Desktop: true, Mobile: true, Xbox: false, Holographic: false,
        };
        expect(changedSubmission({ ...first, allowTargetFutureDeviceFamilies: families }, {}).submission.allowTargetFutureDeviceFamilies).toEqual(families);
    });

    test('makes a listing in a new language of its description, and names the file a new one lacks', () => {
        const packages = [writeUnder(dir, 'dist/demo-win32-x64.msix', 'x64')];
        expect(failureOf(() => changedSubmission(created('old.png'), { packages, listings: [{ language: 'tr-TR', texts: { title: 'Deneme' }, images: {} }] })))
            .toBe('crossbind: the Microsoft Store has no listing in tr-TR yet, which it makes of a description: add description.txt to store/microsoft-store/tr-TR.');
        const { submission } = changedSubmission(created('old.png'), { packages, listings: [{ language: 'tr-TR', texts: { description: 'Bir deneme.' }, images: {} }] });
        expect(submission.listings['tr-tr']).toEqual({ platformOverrides: {}, baseListing: { description: 'Bir deneme.', images: [] } });
        expect(submission.listings['en-us'].baseListing.description).toBe('Old.');
    });
});

describe("a submission's zip", () => {
    test('holds each file stored under its name, as a zip reader finds it', () => {
        const zip = upath.join(dir, 'submission.zip');
        writeZip([
            { name: 'demo-win32-x64.msix', file: writeUnder(dir, 'a.msix', 'package bytes') },
            { name: 'en-us-Icon-çğ.png', file: writeUnder(dir, 'tile.png', 'image bytes') },
        ], zip);
        expect(entriesOf(zip)).toEqual([
            {
                name: 'demo-win32-x64.msix', text: 'package bytes', isCrcRight: true, flags: 0x0800,
            },
            {
                name: 'en-us-Icon-çğ.png', text: 'image bytes', isCrcRight: true, flags: 0x0800,
            },
        ]);
    });
});

describe("a zip's upload to Partner Center's storage", () => {
    test('puts its blocks, then their list, with the version of the API that takes them', async () => {
        const file = writeUnder(dir, 'submission.zip', 'zip bytes');
        await uploadBlob(SAS, file);
        const id = encodeURIComponent(Buffer.from('00000000').toString('base64'));
        expect(requests.map(({ url, init }) => [init.method, url, init.headers['x-ms-version']])).toEqual([
            ['PUT', `${SAS}&comp=block&blockid=${id}`, '2021-08-06'],
            ['PUT', `${SAS}&comp=blocklist`, '2021-08-06'],
        ]);
        expect(String(requests[1].init.body)).toBe('<?xml version="1.0" encoding="utf-8"?><BlockList><Latest>MDAwMDAwMDA=</Latest></BlockList>');
    });
});

describe("an app's submission through Partner Center's API", () => {
    let calls;
    let statuses;
    let filled;
    let taken;
    const call = async (method, route, body) => {
        calls.push([method, route]);
        if (method === 'PUT') filled = body;
        if (method === 'POST' && route === 'applications/9N1/submissions') {
            return {
                id: 'S2', fileUploadUrl: SAS, applicationPackages: [], listings: {}, packageDeliveryOptions: {},
            };
        }
        if (route.endsWith('/status')) return statuses.shift();
        if (method === 'GET') return taken;
        return body ?? {};
    };
    const AGE_RATINGS = { code: 'InvalidParameterValue', details: 'Validation error: InvalidMicrosoftAgeRating - ' };
    const refused = (...errors) => [{ status: 'CommitFailed', statusDetails: { errors } }];
    const submit = (options = {}) => submitPackages(call, {
        appId: '9N1', packages: [writeUnder(dir, 'dist/demo-win32-x64.msix', 'x64')], listings: [], settings: {}, zip: upath.join(dir, 'submission.zip'), ...options,
    });

    beforeEach(() => {
        calls = [];
        statuses = [{ status: 'CommitStarted' }, { status: 'PreProcessing' }];
        filled = null;
        taken = {};
    });

    test('makes it, fills it, uploads its zip, commits it and waits for Partner Center to take it', async () => {
        vi.useFakeTimers();
        expect(await settled(submit())).toEqual({ id: 'S2', status: 'PreProcessing' });
        expect(calls).toEqual([
            ['POST', 'applications/9N1/submissions'],
            ['PUT', 'applications/9N1/submissions/S2'],
            ['POST', 'applications/9N1/submissions/S2/commit'],
            ['GET', 'applications/9N1/submissions/S2/status'],
            ['GET', 'applications/9N1/submissions/S2/status'],
        ]);
        expect(requests.map(({ url }) => url.replace(/blockid=.*$/, 'blockid=…'))).toEqual([`${SAS}&comp=block&blockid=…`, `${SAS}&comp=blocklist`]);
    });

    test('uploads no zip where nothing goes up, as a listing of texts alone', async () => {
        vi.useFakeTimers();
        expect(await settled(submit({ packages: null, listings: [{ language: 'en-US', texts: { description: 'New.' }, images: {} }] }))).toEqual({ id: 'S2', status: 'PreProcessing' });
        expect(requests).toEqual([]);
        expect(calls.map(([method]) => method)).toEqual(['POST', 'PUT', 'POST', 'GET', 'GET']);
    });

    test('leaves a draft uncommitted, for the release to submit', async () => {
        expect(await submit({ isDraft: true })).toEqual({ id: 'S2', status: 'PendingCommit' });
        expect(calls.map(([method]) => method)).toEqual(['POST', 'PUT']);
    });

    test('deletes a submission that fails before Partner Center takes it, or that it refuses, naming why', async () => {
        vi.stubGlobal('fetch', async () => new Response('denied', { status: 403 }));
        await expect(submit()).rejects.toThrow("crossbind: Partner Center's storage answered the upload of");
        expect(calls.at(-1)).toEqual(['DELETE', 'applications/9N1/submissions/S2']);
        vi.stubGlobal('fetch', async () => new Response(null, { status: 201 }));
        calls = [];
        statuses = [{ status: 'CommitFailed', statusDetails: { errors: [{ code: 'InvalidParameterValue', details: 'The title is no reserved name.' }] } }];
        await expect(submit()).rejects.toThrow('crossbind: Partner Center refused the submission: InvalidParameterValue: The title is no reserved name.');
        expect(calls.at(-1)).toEqual(['DELETE', 'applications/9N1/submissions/S2']);
    });

    test("commits an app's first one, published by hand, and leaves it where Partner Center took its files and stopped at the age ratings alone", async () => {
        statuses = refused(AGE_RATINGS);
        taken = {
            applicationPackages: [{ fileName: 'demo-win32-x64.msix', fileStatus: 'Uploaded' }],
            listings: { 'en-us': { baseListing: { images: [{ fileName: 'tile.png', fileStatus: 'Uploaded' }] } } },
        };
        expect(await submit({ isFirst: true })).toEqual({ id: 'S2', status: 'CommitFailed' });
        expect(filled.targetPublishMode).toBe('Manual');
        expect(calls).toEqual([
            ['POST', 'applications/9N1/submissions'],
            ['PUT', 'applications/9N1/submissions/S2'],
            ['POST', 'applications/9N1/submissions/S2/commit'],
            ['GET', 'applications/9N1/submissions/S2/status'],
            ['GET', 'applications/9N1/submissions/S2'],
        ]);
    });

    test('deletes a first one Partner Center refuses for more than its age ratings, or whose files it has not taken', async () => {
        statuses = refused(AGE_RATINGS, { code: 'InvalidParameterValue', details: 'Screenshots are required.' });
        taken = { applicationPackages: [{ fileName: 'demo-win32-x64.msix', fileStatus: 'Uploaded' }] };
        await expect(submit({ isFirst: true })).rejects.toThrow('InvalidParameterValue: Screenshots are required.');
        expect(calls.at(-1)).toEqual(['DELETE', 'applications/9N1/submissions/S2']);

        calls = [];
        statuses = refused(AGE_RATINGS);
        taken = { applicationPackages: [{ fileName: 'demo-win32-x64.msix', fileStatus: 'PendingUpload' }] };
        await expect(submit({ isFirst: true })).rejects.toThrow('crossbind: Partner Center refused the submission: InvalidParameterValue: Validation error: InvalidMicrosoftAgeRating');
        expect(calls.at(-1)).toEqual(['DELETE', 'applications/9N1/submissions/S2']);
    });
});

describe("the release of an app's submission an upload left", () => {
    let calls;
    let statuses;
    let pending;
    let put;
    const call = async (method, route, body) => {
        calls.push([method, route]);
        if (method === 'PUT') put = body;
        if (method === 'GET' && route === 'applications/9N1/submissions/S2') return pending;
        if (route.endsWith('/status')) return statuses.shift();
        return body ?? {};
    };
    const release = (options = {}) => releaseSubmission(call, {
        appId: '9N1', submissionId: 'S2', listings: [{ language: 'en-US', texts: { description: 'New.' }, images: {} }], rollout: 10, zip: upath.join(dir, 'submission.zip'), ...options,
    });

    beforeEach(() => {
        calls = [];
        statuses = [{ status: 'CommitStarted' }, { status: 'PreProcessing' }];
        pending = {
            id: 'S2', status: 'PendingCommit', fileUploadUrl: SAS, applicationPackages: [{ fileName: 'demo-win32-x64.msix', fileStatus: 'Uploaded' }], listings: {}, packageDeliveryOptions: { packageRollout: { fallbackSubmissionId: '1' } },
        };
        put = null;
    });

    test('commits it with its packages, the listing and the rollout, and waits for Partner Center to take it', async () => {
        vi.useFakeTimers();
        expect(await settled(release())).toBe('PreProcessing');
        expect(calls).toEqual([
            ['GET', 'applications/9N1/submissions/S2'],
            ['PUT', 'applications/9N1/submissions/S2'],
            ['POST', 'applications/9N1/submissions/S2/commit'],
            ['GET', 'applications/9N1/submissions/S2/status'],
            ['GET', 'applications/9N1/submissions/S2/status'],
        ]);
        expect(put.applicationPackages).toEqual(pending.applicationPackages);
        expect(put.listings['en-us'].baseListing.description).toBe('New.');
        expect(put.packageDeliveryOptions.packageRollout).toEqual({ fallbackSubmissionId: '1', isPackageRollout: true, packageRolloutPercentage: 10 });
        expect(requests).toEqual([]);
    });

    test('commits none Partner Center took already, and deletes none it refuses, as the upload made it', async () => {
        pending = { ...pending, status: 'Certification' };
        await expect(release()).rejects
            .toThrow('crossbind: Partner Center has submission S2 as Certification already, which goes on as Partner Center mails: crossbind app upload microsoft-store leaves the next one to release.');
        expect(calls).toEqual([['GET', 'applications/9N1/submissions/S2']]);

        pending = { ...pending, status: 'PendingCommit' };
        calls = [];
        statuses = [{ status: 'CommitFailed', statusDetails: { errors: [{ code: 'InvalidParameterValue', details: 'The title is no reserved name.' }] } }];
        await expect(release()).rejects.toThrow('crossbind: Partner Center refused the submission: InvalidParameterValue: The title is no reserved name.');
        expect(calls.map(([method]) => method)).not.toContain('DELETE');
    });

    test("stops before any change where the page's images changed after the upload, whose files Partner Center takes in one zip", async () => {
        const tile = writeUnder(dir, 'tile.png', pngOf(300, 300));
        pending = { ...pending, applicationPackages: [{ fileName: 'demo-win32-x64.msix', fileStatus: 'PendingUpload' }] };
        await expect(release({ listings: [{ language: 'en-US', texts: { description: 'New.' }, images: { Icon: [{ file: tile }] } }] })).rejects
            .toThrow("crossbind: the page's images changed after the upload, and Partner Center takes the files of a submission in one zip: crossbind app upload microsoft-store again sends them with the build's packages.");
        expect(calls).toEqual([['GET', 'applications/9N1/submissions/S2']]);
        expect(requests).toEqual([]);
    });
});

describe("Partner Center's API", () => {
    test("knows an app by its package's identity name, page by page", async () => {
        const pages = [];
        const call = async (method, route) => {
            pages.push(route);
            const skip = Number(/\$skip=(\d+)/.exec(route)[1]);
            const value = Array.from({ length: skip === 0 ? 100 : 3 }, (_, index) => ({ id: `9N${skip + index}`, packageIdentityName: `Example.App${skip + index}` }));
            return { value, totalCount: 103 };
        };
        expect(await storeApp(call, 'Example.App101')).toMatchObject({ id: '9N101' });
        expect(pages).toEqual(['applications?$top=100&$skip=0', 'applications?$top=100&$skip=100']);
        expect(await storeApp(call, 'Example.Other')).toBeNull();
    });

    test('takes a token of the Entra ID application once, and says what to do where Partner Center refuses it', async () => {
        const made = [];
        vi.stubGlobal('fetch', async (url, init = {}) => {
            made.push({ url: String(url), init });
            if (String(url).startsWith('https://login.microsoftonline.com/')) return json(200, { access_token: 'store-token', expires_in: '3600' });
            if (String(url).endsWith('/applications/9N1')) return json(200, { id: '9N1' });
            return json(401, { code: 'Unauthorized', message: 'The token is not valid.' });
        });
        const call = partnerCenterCaller({ tenant: 'contoso.onmicrosoft.com', client: 'C1', secret: 'S3cret' });
        expect(await call('GET', 'applications/9N1')).toEqual({ id: '9N1' });
        await expect(call('GET', 'applications/9N2')).rejects.toThrow("crossbind: Partner Center answered GET applications/9N2 with 401 Unauthorized: The token is not valid.\ncrossbind: Partner Center takes the Entra ID application once the account's owner has associated its tenant under Account settings › Tenants");
        expect(made.filter(({ url }) => url.startsWith('https://login.microsoftonline.com/'))).toHaveLength(1);
        expect(made[0].url).toBe('https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/token');
        expect(Object.fromEntries(new URLSearchParams(String(made[0].init.body)))).toEqual({
            grant_type: 'client_credentials', client_id: 'C1', client_secret: 'S3cret', resource: 'https://manage.devcenter.microsoft.com',
        });
        expect(made[1].init.headers.authorization).toBe('Bearer store-token');
    });

    test('says what to do where Partner Center finds no account of the token, as before its tenant is associated', async () => {
        vi.stubGlobal('fetch', async (url) => (String(url).startsWith('https://login.microsoftonline.com/')
            ? json(200, { access_token: 'store-token', expires_in: 3600 })
            : json(400, { code: 'Unauthorized', message: 'A valid account could not be found with given authorization token. CorrelationId=1' })));
        await expect(partnerCenterCaller({ tenant: 'T1', client: 'C1', secret: 'S3cret' })('GET', 'applications')).rejects
            .toThrow("crossbind: Partner Center answered GET applications with 400 Unauthorized: A valid account could not be found with given authorization token. CorrelationId=1\ncrossbind: Partner Center takes the Entra ID application once the account's owner has associated its tenant under Account settings › Tenants, and it has the Manager role under Account settings › User management › Microsoft Entra applications.");
    });

    test('names the application whose token Entra ID refuses', async () => {
        vi.stubGlobal('fetch', async () => json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: 1' }));
        await expect(partnerCenterCaller({ tenant: 'T1', client: 'C1', secret: 'wrong' })('GET', 'applications'))
            .rejects.toThrow('crossbind: Microsoft Entra ID gave no token of the application C1 in the tenant T1: invalid_client (AADSTS7000215: Invalid client secret provided.).');
    });
});
