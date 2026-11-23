import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { STORE_LISTING } from './msStoreListing.js';
import { writeZip } from './submissionZip.js';

const API = 'https://manage.devcenter.microsoft.com/v1.0/my';
const RESOURCE = 'https://manage.devcenter.microsoft.com';
const LOGIN = 'https://login.microsoftonline.com';
// The Entra ID application Partner Center's account has, by the environment's names, else this machine's settings, and
// the keychain's name of its key.
export const STORE_ENV = { tenant: 'CROSSBIND_MICROSOFT_STORE_TENANT_ID', client: 'CROSSBIND_MICROSOFT_STORE_CLIENT_ID', secret: 'CROSSBIND_MICROSOFT_STORE_CLIENT_SECRET' };
export const STORE_SETTINGS = { tenant: 'TENANT_ID', client: 'CLIENT_ID' };
export const SECRET = 'client-secret';
// A token lasts an hour; a call makes one anew once it has 5 minutes left.
const TOKEN_MARGIN_SECONDS = 300;
// How often a call that does the same when made twice tries again on an answer Partner Center gives when busy or down,
// and how long it waits first where the answer names no time.
const RETRIES = 3;
const RETRY_SECONDS = 10;
// The blocks the zip goes up in, and the version of Azure's storage API that takes a block list.
const BLOCK_BYTES = 32 * 1024 * 1024;
const BLOB_VERSION = '2021-08-06';
// How often an upload asks how Partner Center takes the submission, and how long it waits at most.
const COMMIT_POLL_SECONDS = 30;
const COMMIT_MINUTES = 30;
const APPS_PAGE = 100;
// The device families a first submission comes without, and Partner Center takes none back without: the desktop's,
// which a Windows app's MSIX package targets.
const DEVICE_FAMILIES = {
    Desktop: true, Mobile: false, Xbox: false, Holographic: false,
};
// Partner Center's word for the age ratings a commit lacks, which its API takes none of.
const AGE_RATINGS = 'InvalidMicrosoftAgeRating';

const sleep = (seconds) => new Promise((resolve) => { setTimeout(resolve, seconds * 1000); });
const isTransient = (status) => status === 429 || status >= 500;

// The Entra ID application's credentials, each null where neither the environment nor this machine has it.
export function storeCredentials(env, settings, secrets) {
    return {
        tenant: env[STORE_ENV.tenant] || settings.get(STORE_SETTINGS.tenant) || null,
        client: env[STORE_ENV.client] || settings.get(STORE_SETTINGS.client) || null,
        secret: env[STORE_ENV.secret] || secrets.get(SECRET) || null,
    };
}

// An hour's token of Partner Center's API, which the application's key buys from Entra ID.
async function tokenOf({ tenant, client, secret }) {
    const response = await fetch(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/token`, {
        method: 'POST',
        body: new URLSearchParams({
            grant_type: 'client_credentials', client_id: client, client_secret: secret, resource: RESOURCE,
        }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
        const said = (body.error_description ?? '').split(/\r?\n/)[0];
        throw new Error(`crossbind: Microsoft Entra ID gave no token of the application ${client} in the tenant ${tenant}: ${body.error ?? response.status}${said ? ` (${said})` : ''}. ${STORE_ENV.tenant}, ${STORE_ENV.client} and ${STORE_ENV.secret} name the application Partner Center's account has, and its key expires as Partner Center made it to.`);
    }
    return { token: body.access_token, until: Date.now() + (Number(body.expires_in ?? 3600) - TOKEN_MARGIN_SECONDS) * 1000 };
}

// The answer to a request, which init makes anew at each try; one that does the same when made twice tries again when
// its host is busy or out of reach for a moment, and any other only where it said it was too busy to take it.
async function answerTo(url, init, isRepeatable, what) {
    for (let attempt = 0; ; attempt += 1) {
        let response;
        try {
            response = await fetch(url, init());
        } catch (error) {
            if (!isRepeatable || attempt >= RETRIES) throw new Error(`crossbind: Partner Center was out of reach for ${what}: ${error.cause?.message ?? error.message}`, { cause: error });
            await sleep(RETRY_SECONDS);
            continue;
        }
        const isRetried = isRepeatable ? isTransient(response.status) : response.status === 429;
        if (attempt >= RETRIES || !isRetried) return response;
        await sleep(Number(response.headers.get('retry-after')) || RETRY_SECONDS);
    }
}

function apiError(status, what, body) {
    const said = typeof body === 'string' ? body.slice(0, 200) : body?.message ?? body?.error?.message ?? '';
    const code = typeof body === 'string' ? null : body?.code ?? body?.error?.code;
    let text = `crossbind: Partner Center answered ${what} with ${status}${code ? ` ${code}` : ''}${said ? `: ${said}` : '.'}`;
    // Partner Center answers 400 Unauthorized where no account has the token's tenant yet.
    if (status === 401 || status === 403 || (status === 400 && code === 'Unauthorized')) {
        text += "\ncrossbind: Partner Center takes the Entra ID application once the account's owner has associated its tenant under Account settings › Tenants, and it has the Manager role under Account settings › User management › Microsoft Entra applications.";
    } else if (status === 409) {
        text += "\ncrossbind: Partner Center's API takes no submission of an app with mandatory updates or Store-managed consumable add-ons, which Partner Center alone takes, nor one while another is in progress.";
    }
    return Object.assign(new Error(text), { status, code });
}

// A caller of Partner Center's submission API with the application's credentials, which buys a token anew as one runs
// out, as an upload may outlast one.
export function partnerCenterCaller(credentials) {
    let current = null;
    return async (method, route, body) => {
        if (!current || Date.now() >= current.until) current = await tokenOf(credentials);
        const what = `${method} ${route.split('?')[0]}`;
        const response = await answerTo(`${API}/${route}`, () => ({
            method,
            headers: { authorization: `Bearer ${current.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
        }), method === 'GET' || method === 'PUT', what);
        const text = await response.text();
        let json;
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            json = text;
        }
        if (response.ok) return json;
        throw apiError(response.status, what, json);
    };
}

// The app Partner Center knows by its package's identity name, as app.windows.msix names it, or null.
export async function storeApp(call, identityName) {
    for (let skip = 0; ; skip += APPS_PAGE) {
        const { value = [], totalCount = Infinity } = await call('GET', `applications?$top=${APPS_PAGE}&$skip=${skip}`);
        const app = value.find(({ packageIdentityName }) => packageIdentityName === identityName);
        if (app) return app;
        if (value.length < APPS_PAGE || skip + value.length >= totalCount) return null;
    }
}

const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

// A listing's images as the submission takes them: of each type the project's folder has, those Partner Center has
// already where they went up as the files are, by the names their bytes give them, with the captions of the files;
// else the files anew, and the old ones to delete. A type the folder has none of stays as Partner Center has it.
function imagesOf(shown, key, images) {
    return Object.entries(images).reduce(({ list, uploads }, [type, shots]) => {
        const wanted = shots.map(({ file, caption = '' }) => ({ fileName: `${key}-${type}-${digest(file)}.png`, file, caption }));
        const current = list.filter((image) => image.imageType === type && image.fileStatus !== 'PendingDelete');
        if (current.length === wanted.length && current.every((image, index) => image.fileName === wanted[index].fileName)) {
            return { list: list.map((image) => (current.includes(image) ? { ...image, description: wanted[current.indexOf(image)].caption } : image)), uploads };
        }
        return {
            list: [
                ...list.map((image) => (current.includes(image) ? { ...image, fileStatus: 'PendingDelete' } : image)),
                ...wanted.map(({ fileName, caption }) => ({
                    fileName, fileStatus: 'PendingUpload', imageType: type, description: caption,
                })),
            ],
            uploads: [...uploads, ...wanted.map(({ fileName, file }) => ({ name: fileName, file }))],
        };
    }, { list: shown, uploads: [] });
}

// A language's listing as the submission takes it, of Partner Center's own and the project's folder, with the images
// that go up for it. A language Partner Center has no listing in takes a description, which it makes one of.
function listingOf(shownListings, { language, texts, images }) {
    const key = language.toLowerCase();
    const shown = shownListings[key];
    if (!shown?.baseListing && texts.description === undefined) {
        throw new Error(`crossbind: the Microsoft Store has no listing in ${language} yet, which it makes of a description: add description.txt to ${path.join(STORE_LISTING, language)}.`);
    }
    const { list, uploads } = imagesOf(shown?.baseListing?.images ?? [], key, images);
    return { key, value: { platformOverrides: {}, ...shown, baseListing: { ...shown?.baseListing, ...texts, images: list } }, uploads };
}

// A submission of Partner Center's, with the build's packages in place of the old ones, or, where packages is null, the
// packages it has; the rollout to a percent of the app's users, or to all where rollout is null, or, where it is not
// given, the rollout it has; with the project's listing and settings, and the desktop's device family where it names
// none, as a first submission; and the files that go up for it, by the names it gives them.
export function changedSubmission(submission, {
    packages = null, listings = [], settings = {}, rollout,
}) {
    const families = Object.keys(submission.allowTargetFutureDeviceFamilies ?? {}).length > 0 ? {} : { allowTargetFutureDeviceFamilies: DEVICE_FAMILIES };
    const packageUploads = (packages ?? []).map((file) => ({ name: path.basename(file), file }));
    const listed = listings.map((listing) => listingOf(submission.listings ?? {}, listing));
    const delivery = submission.packageDeliveryOptions ?? {};
    const packaged = packages === null ? {} : {
        applicationPackages: [
            ...(submission.applicationPackages ?? []).map((one) => ({ ...one, fileStatus: 'PendingDelete' })),
            ...packageUploads.map(({ name }) => ({
                fileName: name, fileStatus: 'PendingUpload', minimumDirectXVersion: 'None', minimumSystemRam: 'None',
            })),
        ],
    };
    const rolledOut = rollout === undefined ? {} : {
        packageDeliveryOptions: {
            ...delivery,
            packageRollout: { ...delivery.packageRollout, isPackageRollout: rollout !== null, packageRolloutPercentage: rollout ?? 0 },
        },
    };
    return {
        submission: {
            ...submission,
            ...families,
            ...packaged,
            ...rolledOut,
            listings: { ...submission.listings, ...Object.fromEntries(listed.map(({ key, value }) => [key, value])) },
            ...(settings.category === undefined ? {} : { applicationCategory: settings.category }),
            ...(settings.notesForCertification === undefined ? {} : { notesForCertification: settings.notesForCertification }),
        },
        uploads: [...packageUploads, ...listed.flatMap(({ uploads }) => uploads)],
    };
}

// Puts a block of the zip where Partner Center's storage takes it, trying again where it is busy or out of reach.
async function putBlob(url, body, file) {
    const response = await answerTo(url, () => ({ method: 'PUT', headers: { 'x-ms-version': BLOB_VERSION }, body }), true, `the upload of ${file}`);
    if (!response.ok) throw new Error(`crossbind: Partner Center's storage answered the upload of ${file} with ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

// Uploads a file where the submission's shared access signature points, in blocks and then their list, as Azure's
// storage takes a large one.
export async function uploadBlob(sasUrl, file) {
    const size = fs.statSync(file).size;
    const ids = [];
    const descriptor = fs.openSync(file, 'r');
    try {
        for (let at = 0; at < size; at += BLOCK_BYTES) {
            const bytes = Buffer.alloc(Math.min(BLOCK_BYTES, size - at));
            fs.readSync(descriptor, bytes, 0, bytes.length, at);
            const id = Buffer.from(String(ids.length).padStart(8, '0')).toString('base64');
            await putBlob(`${sasUrl}&comp=block&blockid=${encodeURIComponent(id)}`, bytes, file);
            ids.push(id);
        }
    } finally {
        fs.closeSync(descriptor);
    }
    const list = `<?xml version="1.0" encoding="utf-8"?><BlockList>${ids.map((id) => `<Latest>${id}</Latest>`).join('')}</BlockList>`;
    await putBlob(`${sasUrl}&comp=blocklist`, Buffer.from(list), file);
}

// The status Partner Center gives the committed submission once it has taken it, or still takes it after 30 minutes;
// one it refused stops the upload, naming why.
async function committedStatus(call, route) {
    for (let waited = 0; ; waited += COMMIT_POLL_SECONDS) {
        const { status, statusDetails } = await call('GET', `${route}/status`);
        if (status === 'CommitFailed') {
            const said = (statusDetails?.errors ?? []).map(({ code, details }) => `${code}: ${details}`).join(' ');
            throw Object.assign(new Error(`crossbind: Partner Center refused the submission${said ? `: ${said}` : '.'}`), { isCommitFailed: true, errors: statusDetails?.errors ?? [] });
        }
        if (status !== 'CommitStarted' || waited >= COMMIT_MINUTES * 60) return status;
        await sleep(COMMIT_POLL_SECONDS);
    }
}

// A submission's files, its packages and its listings' images, which Partner Center takes from its zip at the commit.
const filesOf = (submission) => [
    ...(submission.applicationPackages ?? []),
    ...Object.values(submission.listings ?? {}).flatMap(({ baseListing }) => baseListing?.images ?? []),
];
const isWaiting = ({ fileStatus }) => fileStatus === 'PendingUpload';

// Whether Partner Center refused a first submission's commit for its age ratings alone, once it took its files.
async function isLeftForPartnerCenter(call, route, error) {
    if (!error.isCommitFailed || error.errors.length === 0 || !error.errors.every(({ details = '' }) => details.includes(AGE_RATINGS))) return false;
    const files = filesOf(await call('GET', route).catch(() => ({})));
    return files.length > 0 && !files.some(isWaiting);
}

// Puts what goes in a submission of the app into it, uploads the files that go up in one zip, and commits it for
// certification, unless isDraft leaves it for a release to submit. Gives its status, once Partner Center has taken a
// committed one; a failure after the commit says so.
async function fillSubmission(call, route, made, { isDraft, zip, ...changes }) {
    const { submission, uploads } = changedSubmission(made, changes);
    if (uploads.length > 0 && filesOf(made).some(isWaiting)) {
        throw new Error("crossbind: the page's images changed after the upload, and Partner Center takes the files of a submission in one zip: crossbind app upload microsoft-store again sends them with the build's packages.");
    }
    await call('PUT', route, submission);
    if (uploads.length > 0) {
        writeZip(uploads, zip);
        await uploadBlob(made.fileUploadUrl, zip);
    }
    if (isDraft) return 'PendingCommit';
    await call('POST', `${route}/commit`);
    try {
        return await committedStatus(call, route);
    } catch (error) {
        throw Object.assign(error, { isCommitted: true });
    }
}

// Makes a submission of the app with the build's packages, or, where packages is null, those it has, and the project's
// listing and settings, uploads the files that go up in one zip, and commits it for certification, unless isDraft
// leaves it for a release to submit. The app's first, isFirst, is committed for Partner Center to take its files, to
// publish by hand once certified, and stays where Partner Center took them and stopped it at the age ratings alone,
// which only Partner Center takes. A submission that fails before Partner Center takes it is deleted, so the next one
// is made anew. Gives its id and status.
export async function submitPackages(call, {
    appId, packages = null, listings = [], settings = {}, isDraft = false, isFirst = false, zip,
}) {
    const created = await call('POST', `applications/${appId}/submissions`);
    const route = `applications/${appId}/submissions/${created.id}`;
    const made = isFirst ? { ...created, targetPublishMode: 'Manual' } : created;
    try {
        return {
            id: created.id,
            status: await fillSubmission(call, route, made, {
                packages, listings, settings, isDraft, zip,
            }),
        };
    } catch (error) {
        if (isFirst && await isLeftForPartnerCenter(call, route, error)) return { id: created.id, status: 'CommitFailed' };
        if (!error.isCommitted || error.isCommitFailed) await call('DELETE', route).catch(() => {});
        throw error;
    }
}

// Commits for certification the app's submission an upload left, with its packages, the project's listing and settings,
// and the rollout to a percent of the app's users, or to all where rollout is null. One Partner Center has taken already
// is none to commit. Gives its status once Partner Center has taken it.
export async function releaseSubmission(call, {
    appId, submissionId, listings = [], settings = {}, rollout = null, zip,
}) {
    const route = `applications/${appId}/submissions/${submissionId}`;
    const pending = await call('GET', route);
    if (pending.status !== 'PendingCommit') {
        throw new Error(`crossbind: Partner Center has submission ${submissionId} as ${pending.status} already, which goes on as Partner Center mails: crossbind app upload microsoft-store leaves the next one to release.`);
    }
    return fillSubmission(call, route, pending, {
        listings, settings, rollout, isDraft: false, zip,
    });
}

// Deletes the app's submission in progress, so an upload makes its own.
export const deleteSubmission = (call, appId, submissionId) => call('DELETE', `applications/${appId}/submissions/${submissionId}`);
