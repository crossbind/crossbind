import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { uploadParts } from './appStoreApi.js';
import { APP_STORE_CONNECT } from './appStoreConnect.js';
import { APP_STORE_LISTING } from './appStoreListing.js';

// How often a publish asks App Store Connect about a build it processes, and how long it waits for it at most; then
// how often it asks whether a version is ready for review, and how many times.
const BUILD_POLL_SECONDS = 30;
const PROCESSING_MINUTES = 60;
const SAY_EVERY_MINUTES = 5;
const READY_POLL_SECONDS = 15;
const READY_LOOKS = 10;
const SCREENSHOT_POLL_SECONDS = 5;
const SCREENSHOT_MINUTES = 10;
// The states of a version App Store Connect takes another build and listing in.
const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];
// The states of the app's information that changes with the version App Store Connect prepares.
const EDITABLE_INFO = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED'];
// The states of a review submission App Review has, one at a time, or answered with issues to resolve.
const IN_REVIEW = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES'];
const PREPARED_SUBMISSION = 'crossbind: App Store Connect prepares a review submission of the app with items in it already, as one a publish stopped in leaves: submit or remove them there, then publish again.';

const sleep = (seconds) => new Promise((resolve) => { setTimeout(resolve, seconds * 1000); });
const query = (route, filters) => `${route}?${new URLSearchParams(filters)}`;
const to = (type, id) => ({ data: { type, id } });

// The id App Store Connect knows an app by.
export async function appStoreApp(call, bundleId) {
    const { data } = await call('GET', query('/apps', { 'filter[bundleId]': bundleId }));
    const app = data.find(({ attributes }) => attributes.bundleId === bundleId);
    if (!app) {
        throw new Error(`crossbind: App Store Connect has no app ${bundleId}: create it at ${APP_STORE_CONNECT}, a new iOS app with ${bundleId} as its bundle ID. A form that lists no such bundle ID lists it once a publish without --submit has registered it with Apple.`);
    }
    return app.id;
}

// The app's version of a number on App Store Connect, or null without one; one App Store Connect takes no other build
// in, as in review or out, stops the publish.
async function versionOf(call, appId, versionString) {
    const { data: [version = null] } = await call('GET', query(`/apps/${appId}/appStoreVersions`, { 'filter[platform]': 'IOS', 'filter[versionString]': versionString }));
    const state = version?.attributes.appVersionState;
    if (state === 'READY_FOR_REVIEW') throw new Error(PREPARED_SUBMISSION);
    if (version && !EDITABLE.includes(state)) {
        throw new Error(`crossbind: App Store Connect has ${versionString} as ${state} already, which takes no other build: raise the version in package.json, or, while App Review has it, cancel its review in App Store Connect.`);
    }
    return version;
}

// The review submission App Store Connect prepares for the app, with the items in it it has not removed, or null.
async function preparedSubmission(call, appId) {
    const { data: [submission = null], included = [] } = await call('GET', query(`/apps/${appId}/reviewSubmissions`, { 'filter[platform]': 'IOS', 'filter[state]': 'READY_FOR_REVIEW', include: 'items' }));
    if (!submission) return null;
    const items = (submission.relationships?.items?.data ?? [])
        .map(({ id }) => included.find((item) => item.type === 'reviewSubmissionItems' && item.id === id))
        .filter((item) => item?.attributes?.state !== 'REMOVED');
    return { submission, items };
}

// Stops a publish, before its build, that App Store Connect would not review: one of a version it takes no other build
// in, while App Review has another submission of the app, or where it prepares one with items in it.
export async function assertReviewable(call, appId, versionString) {
    await versionOf(call, appId, versionString);
    const { data: [submission] } = await call('GET', query(`/apps/${appId}/reviewSubmissions`, { 'filter[platform]': 'IOS', 'filter[state]': IN_REVIEW.join(',') }));
    if (submission?.attributes.state === 'UNRESOLVED_ISSUES') {
        throw new Error('crossbind: App Review answered the app\'s last submission with issues, which App Store Connect resolves: publish without --submit, pick the new build there and resubmit, or cancel that submission first.');
    }
    if (submission) {
        throw new Error(`crossbind: App Review has the app's submission as ${submission.attributes.state}, and takes one at a time: let it finish, or cancel it in App Store Connect.`);
    }
    if ((await preparedSubmission(call, appId))?.items.length > 0) throw new Error(PREPARED_SUBMISSION);
}

// The newest build App Store Connect has of the version, or of its number where the build has one already.
const newestQuery = (appId, versionString, buildNumber) => query('/builds', {
    'filter[app]': appId,
    'filter[preReleaseVersion.version]': versionString,
    'filter[preReleaseVersion.platform]': 'IOS',
    ...(buildNumber === null ? {} : { 'filter[version]': String(buildNumber) }),
    sort: '-uploadedDate',
    limit: '1',
});

// The newest build App Store Connect has of the version, which tells the upload's own from those before it.
export async function newestBuild(call, appId, versionString) {
    const { data: [build] } = await call('GET', newestQuery(appId, versionString, null));
    return build?.id ?? null;
}

// The upload's build once App Store Connect has processed it: the newest of the version, after the one it had before.
async function processedBuild(call, { appId, versionString, before, buildNumber }) {
    console.log('crossbind: waiting for App Store Connect to process the build, usually 5 to 30 minutes.');
    for (let waited = 0; ; waited += BUILD_POLL_SECONDS) {
        const { data: [build] } = await call('GET', newestQuery(appId, versionString, buildNumber));
        const state = build && build.id !== before ? build.attributes.processingState : null;
        if (state === 'VALID') return build;
        if (state === 'FAILED' || state === 'INVALID') {
            throw new Error(`crossbind: App Store Connect could not process build ${build.attributes.version} of ${versionString}, which it marked ${state}; Apple mails why.`);
        }
        if (waited >= PROCESSING_MINUTES * 60) {
            throw new Error(`crossbind: App Store Connect has not processed the build in ${PROCESSING_MINUTES} minutes, so it went to no review: once it has, pick it for ${versionString} in App Store Connect and submit it there.`);
        }
        if (waited > 0 && waited % (SAY_EVERY_MINUTES * 60) === 0) console.log(`crossbind: App Store Connect is still processing the build, ${waited / 60} minutes on.`);
        await sleep(BUILD_POLL_SECONDS);
    }
}

// The app's version to submit: its own, the one App Store Connect prepares under another number, renamed, or a new one.
async function openVersion(call, appId, versionString) {
    const own = await versionOf(call, appId, versionString);
    if (own) return own;
    const { data: [prepared] } = await call('GET', query(`/apps/${appId}/appStoreVersions`, { 'filter[platform]': 'IOS', 'filter[appVersionState]': EDITABLE.join(',') }));
    if (prepared) {
        console.log(`crossbind: App Store Connect prepares ${prepared.attributes.versionString}, which becomes ${versionString}.`);
        return (await call('PATCH', `/appStoreVersions/${prepared.id}`, { data: { type: 'appStoreVersions', id: prepared.id, attributes: { versionString } } })).data;
    }
    const version = { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString }, relationships: { app: to('apps', appId) } };
    return (await call('POST', '/appStoreVersions', { data: version })).data;
}

// The app's information that changes with the version App Store Connect prepares.
async function openInfo(call, appId) {
    const { data } = await call('GET', `/apps/${appId}/appInfos`);
    const info = data.find(({ attributes }) => EDITABLE_INFO.includes(attributes.state));
    if (!info) throw new Error(`crossbind: App Store Connect takes the app's name, subtitle and privacy policy URL in none of its versions now: remove name.txt, subtitle.txt and privacy_url.txt from ${APP_STORE_LISTING} for this one.`);
    return info;
}

// Gives App Store Connect a locale's texts of one kind where they differ from its own, in a new localization where it
// has none of the locale and one is wanted, and gives the localization's id and whether it changed it. An empty text
// clears Apple's, which takes none for it.
async function localize(call, { type, shown, owner }, locale, texts, isWanted = Object.keys(texts).length > 0) {
    const current = shown.find(({ attributes }) => attributes.locale === locale);
    if (!current) {
        if (!isWanted) return { id: null, isChanged: false };
        const given = Object.fromEntries(Object.entries(texts).filter(([, text]) => text !== ''));
        const { data } = await call('POST', `/${type}`, { data: { type, attributes: { locale, ...given }, relationships: owner } });
        return { id: data.id, isChanged: true };
    }
    const changed = Object.entries(texts).filter(([field, text]) => (current.attributes[field] ?? '') !== text);
    if (changed.length > 0) {
        const attributes = Object.fromEntries(changed.map(([field, text]) => [field, text === '' ? null : text]));
        await call('PATCH', `/${type}/${current.id}`, { data: { type, id: current.id, attributes } });
    }
    return { id: current.id, isChanged: changed.length > 0 };
}

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');

// Uploads a screenshot into its set as App Store Connect takes a file: reserved, its bytes uploaded where the reservation
// says, then committed with its checksum, naming the file where App Store Connect refuses it. Gives its id.
async function uploadScreenshot(call, setId, file, bytes) {
    try {
        const screenshot = { type: 'appScreenshots', attributes: { fileName: path.basename(file), fileSize: bytes.length }, relationships: { appScreenshotSet: to('appScreenshotSets', setId) } };
        const { data: reserved } = await call('POST', '/appScreenshots', { data: screenshot });
        await uploadParts(reserved.attributes.uploadOperations, bytes, file);
        await call('PATCH', `/appScreenshots/${reserved.id}`, { data: { type: 'appScreenshots', id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: md5(bytes) } } });
        return reserved.id;
    } catch (error) {
        if (error.message.includes(file)) throw error;
        throw Object.assign(new Error(`${error.message}\ncrossbind: it answered so for ${file}.`), { status: error.status, errors: error.errors });
    }
}

// Whether App Store Connect shows a set's screenshots as the files are, processed and in their order.
const isShownAsFiles = (shown, bytes) => shown.length === bytes.length && shown.every(({ attributes }, index) => attributes.assetDeliveryState?.state === 'COMPLETE'
    && attributes.sourceFileChecksum?.toLowerCase() === md5(bytes[index]));

// Puts a locale's screenshots of each display type into its localization where App Store Connect shows others, in
// another order, or unprocessed, and gives the sets it changed with their new screenshots in order. A screenshot gone
// already, as one a retried call removed, is gone.
async function updateScreenshots(call, localizationId, screenshots) {
    if (Object.keys(screenshots).length === 0) return [];
    const { data: sets, included = [] } = await call('GET', query(`/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`, { include: 'appScreenshots', 'limit[appScreenshots]': '50' }));
    const changed = [];
    for (const [displayType, files] of Object.entries(screenshots)) {
        const bytes = files.map((file) => fs.readFileSync(file));
        const set = sets.find(({ attributes }) => attributes.screenshotDisplayType === displayType) ?? (await call('POST', '/appScreenshotSets', {
            data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: displayType }, relationships: { appStoreVersionLocalization: to('appStoreVersionLocalizations', localizationId) } },
        })).data;
        const shown = (set.relationships?.appScreenshots?.data ?? []).map(({ id }) => included.find((one) => one.type === 'appScreenshots' && one.id === id)).filter(Boolean);
        if (isShownAsFiles(shown, bytes)) continue;
        for (const old of shown) {
            await call('DELETE', `/appScreenshots/${old.id}`).catch((error) => {
                if (error.status !== 404) throw error;
            });
        }
        const uploaded = [];
        for (const [index, file] of files.entries()) uploaded.push({ id: await uploadScreenshot(call, set.id, file, bytes[index]), file });
        changed.push({ setId: set.id, uploaded });
    }
    return changed;
}

// Waits for App Store Connect to process the screenshots uploaded, a set at a time, naming one it refuses.
async function processedScreenshots(call, sets, versionString) {
    for (let waited = 0; ; waited += SCREENSHOT_POLL_SECONDS) {
        let isProcessed = true;
        for (const { setId, uploaded } of sets) {
            const { data: shown } = await call('GET', query(`/appScreenshotSets/${setId}/appScreenshots`, { limit: '200' }));
            for (const { id, file } of uploaded) {
                const delivery = shown.find((one) => one.id === id)?.attributes.assetDeliveryState;
                if (delivery?.state === 'FAILED') {
                    const said = (delivery.errors ?? []).map(({ description, code }) => description ?? code).join(' ');
                    throw new Error(`crossbind: App Store Connect refused ${file}${said ? `: ${said}` : '.'}`);
                }
                if (delivery?.state !== 'COMPLETE') isProcessed = false;
            }
        }
        if (isProcessed) return;
        if (waited >= SCREENSHOT_MINUTES * 60) {
            throw new Error(`crossbind: App Store Connect has not processed the screenshots in ${SCREENSHOT_MINUTES} minutes, so the version went to no review: once it has, pick the build for ${versionString} in App Store Connect and submit it there.`);
        }
        await sleep(SCREENSHOT_POLL_SECONDS);
    }
}

// Puts the project's listing into the version and the app's information that changes with it, and gives the locales it
// changed. App Store Connect makes a locale's information of its name.
async function updateListing(call, appId, version, listings) {
    if (listings.length === 0) return [];
    const { data: versionTexts } = await call('GET', query(`/appStoreVersions/${version.id}/appStoreVersionLocalizations`, { limit: '200' }));
    const info = listings.some((listing) => Object.keys(listing.info).length > 0) ? await openInfo(call, appId) : null;
    const infoTexts = info ? (await call('GET', query(`/appInfos/${info.id}/appInfoLocalizations`, { limit: '200' }))).data : [];
    const lacking = listings.find((listing) => Object.keys(listing.info).length > 0 && listing.info.name === undefined
        && !infoTexts.some(({ attributes }) => attributes.locale === listing.locale));
    if (lacking) throw new Error(`crossbind: App Store Connect has no ${lacking.locale} information of the app yet, which it makes of its name: add name.txt to ${path.join(APP_STORE_LISTING, lacking.locale)}.`);
    const changed = [];
    const sets = [];
    for (const listing of listings) {
        const isWanted = Object.keys(listing.version).length > 0 || Object.keys(listing.screenshots).length > 0;
        const versionText = await localize(call, { type: 'appStoreVersionLocalizations', shown: versionTexts, owner: { appStoreVersion: to('appStoreVersions', version.id) } }, listing.locale, listing.version, isWanted);
        const infoText = info ? await localize(call, { type: 'appInfoLocalizations', shown: infoTexts, owner: { appInfo: to('appInfos', info.id) } }, listing.locale, listing.info) : { isChanged: false };
        const shotSets = await updateScreenshots(call, versionText.id, listing.screenshots);
        sets.push(...shotSets);
        if (versionText.isChanged || infoText.isChanged || shotSets.length > 0) changed.push(listing.locale);
    }
    await processedScreenshots(call, sets, version.attributes.versionString);
    for (const { setId, uploaded } of sets) {
        await call('PATCH', `/appScreenshotSets/${setId}/relationships/appScreenshots`, { data: uploaded.map(({ id }) => ({ type: 'appScreenshots', id })) });
    }
    return changed;
}

// Releases the version in phases over 7 days once App Review approves it, unless it does already.
async function phaseRelease(call, versionId) {
    const { data } = await call('GET', `/appStoreVersions/${versionId}/appStoreVersionPhasedRelease`).catch((error) => {
        if (error.status === 404) return { data: null };
        throw error;
    });
    if (data) return;
    const phased = { type: 'appStoreVersionPhasedReleases', attributes: { phasedReleaseState: 'INACTIVE' }, relationships: { appStoreVersion: to('appStoreVersions', versionId) } };
    await call('POST', '/appStoreVersionPhasedReleases', { data: phased });
}

// Hands the version to App Review in the app's submission App Store Connect prepares, or a new one, once the version
// is ready for review; one prepared with items in it stops the publish, which knows none of them.
async function submitForReview(call, appId, versionId) {
    const prepared = await preparedSubmission(call, appId);
    if (prepared?.items.length > 0) throw new Error(PREPARED_SUBMISSION);
    const submission = prepared?.submission ?? (await call('POST', '/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: to('apps', appId) } } })).data;
    const item = { type: 'reviewSubmissionItems', relationships: { reviewSubmission: to('reviewSubmissions', submission.id), appStoreVersion: to('appStoreVersions', versionId) } };
    await call('POST', '/reviewSubmissionItems', { data: item });
    for (let look = 1; ; look += 1) {
        const { data: version } = await call('GET', `/appStoreVersions/${versionId}`);
        if (version.attributes.appVersionState === 'READY_FOR_REVIEW' || look === READY_LOOKS) break;
        await sleep(READY_POLL_SECONDS);
    }
    await call('PATCH', `/reviewSubmissions/${submission.id}`, { data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } } });
}

// Hands the upload's build to App Review as the app's version, with the project's listing, once App Store Connect has
// processed it, to go out in phases over 7 days once released where isPhased says so. Gives the build's number and the
// locales whose listing changed.
export async function submitRelease(call, {
    appId, versionString, before, buildNumber = null, listings, isPhased,
}) {
    const version = await openVersion(call, appId, versionString);
    const listed = await updateListing(call, appId, version, listings);
    if (isPhased) await phaseRelease(call, version.id);
    const build = await processedBuild(call, {
        appId, versionString, before, buildNumber,
    });
    await call('PATCH', `/appStoreVersions/${version.id}/relationships/build`, to('builds', build.id));
    await submitForReview(call, appId, version.id);
    return { build: build.attributes.version, listed };
}
