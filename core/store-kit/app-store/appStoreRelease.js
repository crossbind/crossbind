import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { uploadParts } from './appStoreApi.js';
import { APP_STORE_LISTING } from './appStoreListing.js';

// App Store Connect's page of the team's apps.
export const APP_STORE_CONNECT = 'https://appstoreconnect.apple.com/apps';

// How often an upload asks App Store Connect about a build it processes, and how long it waits for it at most; then
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
const PREPARED_SUBMISSION = 'crossbind: App Store Connect prepares a review submission of the app with items in it already, as one an upload stopped in leaves: submit or remove them there, then upload again.';

const sleep = (seconds) => new Promise((resolve) => { setTimeout(resolve, seconds * 1000); });
const query = (route, filters) => `${route}?${new URLSearchParams(filters)}`;
const to = (type, id) => ({ data: { type, id } });

// The id App Store Connect knows an app by.
export async function appStoreApp(call, bundleId) {
    const { data } = await call('GET', query('/apps', { 'filter[bundleId]': bundleId }));
    const app = data.find(({ attributes }) => attributes.bundleId === bundleId);
    if (!app) {
        throw new Error(`crossbind: App Store Connect has no app ${bundleId}: create it at ${APP_STORE_CONNECT}, a new iOS app with ${bundleId} as its bundle ID. A form that lists no such bundle ID lists it once an upload without --submit has registered it with Apple.`);
    }
    return app.id;
}

// The app's version of a number on App Store Connect, on a platform, IOS or MAC_OS, or null without one; one App Store
// Connect takes no other build in, as in review or out, stops the upload.
async function versionOf(call, appId, versionString, platform) {
    const { data: [version = null] } = await call('GET', query(`/apps/${appId}/appStoreVersions`, { 'filter[platform]': platform, 'filter[versionString]': versionString }));
    const state = version?.attributes.appVersionState;
    if (state === 'READY_FOR_REVIEW') throw new Error(PREPARED_SUBMISSION);
    if (version && !EDITABLE.includes(state)) {
        throw new Error(`crossbind: App Store Connect has ${versionString} as ${state} already, which takes no other build or listing: raise the version in package.json, or, while App Review has it, cancel its review in App Store Connect.`);
    }
    return version;
}

// The review submission App Store Connect prepares for the app, with the items in it it has not removed, or null.
async function preparedSubmission(call, appId, platform) {
    const { data: [submission = null], included = [] } = await call('GET', query(`/apps/${appId}/reviewSubmissions`, { 'filter[platform]': platform, 'filter[state]': 'READY_FOR_REVIEW', include: 'items' }));
    if (!submission) return null;
    const items = (submission.relationships?.items?.data ?? [])
        .map(({ id }) => included.find((item) => item.type === 'reviewSubmissionItems' && item.id === id))
        .filter((item) => item?.attributes?.state !== 'REMOVED');
    return { submission, items };
}

// Stops an upload, before its build, that App Store Connect would not review: one of a version it takes no other build
// in, while App Review has another submission of the app, or where it prepares one with items in it.
export async function assertReviewable(call, appId, versionString, platform = 'IOS') {
    await versionOf(call, appId, versionString, platform);
    const { data: [submission] } = await call('GET', query(`/apps/${appId}/reviewSubmissions`, { 'filter[platform]': platform, 'filter[state]': IN_REVIEW.join(',') }));
    if (submission?.attributes.state === 'UNRESOLVED_ISSUES') {
        throw new Error('crossbind: App Review answered the app\'s last submission with issues, which App Store Connect resolves: upload without --submit, pick the new build there and resubmit, or cancel that submission first.');
    }
    if (submission) {
        throw new Error(`crossbind: App Review has the app's submission as ${submission.attributes.state}, and takes one at a time: let it finish, or cancel it in App Store Connect.`);
    }
    if ((await preparedSubmission(call, appId, platform))?.items.length > 0) throw new Error(PREPARED_SUBMISSION);
}

// The newest build App Store Connect has of the version, or of its number where the build has one already.
const newestQuery = (appId, versionString, buildNumber, platform) => query('/builds', {
    'filter[app]': appId,
    'filter[preReleaseVersion.version]': versionString,
    'filter[preReleaseVersion.platform]': platform,
    ...(buildNumber === null ? {} : { 'filter[version]': String(buildNumber) }),
    sort: '-uploadedDate',
    limit: '1',
});

// The newest build App Store Connect has of the version, which tells the upload's own from those before it.
export async function newestBuild(call, appId, versionString, platform = 'IOS') {
    const { data: [build] } = await call('GET', newestQuery(appId, versionString, null, platform));
    return build?.id ?? null;
}

// The upload's build once App Store Connect has processed it: the newest of the version, after the one it had before.
async function processedBuild(call, {
    appId, versionString, before, buildNumber, platform,
}) {
    console.log('crossbind: waiting for App Store Connect to process the build, usually 5 to 30 minutes.');
    for (let waited = 0; ; waited += BUILD_POLL_SECONDS) {
        const { data: [build] } = await call('GET', newestQuery(appId, versionString, buildNumber, platform));
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
async function openVersion(call, appId, versionString, platform) {
    const own = await versionOf(call, appId, versionString, platform);
    if (own) return own;
    const { data: [prepared] } = await call('GET', query(`/apps/${appId}/appStoreVersions`, { 'filter[platform]': platform, 'filter[appVersionState]': EDITABLE.join(',') }));
    if (prepared) {
        console.log(`crossbind: App Store Connect prepares ${prepared.attributes.versionString}, which becomes ${versionString}.`);
        return (await call('PATCH', `/appStoreVersions/${prepared.id}`, { data: { type: 'appStoreVersions', id: prepared.id, attributes: { versionString } } })).data;
    }
    const version = { type: 'appStoreVersions', attributes: { platform, versionString }, relationships: { app: to('apps', appId) } };
    return (await call('POST', '/appStoreVersions', { data: version })).data;
}

// The app's information that changes with the version App Store Connect prepares, which takes what the files name.
async function openInfo(call, appId, { what, files }) {
    const { data } = await call('GET', `/apps/${appId}/appInfos`);
    const info = data.find(({ attributes }) => EDITABLE_INFO.includes(attributes.state));
    if (!info) throw new Error(`crossbind: App Store Connect takes the app's ${what} in none of its versions now: remove ${files} from ${APP_STORE_LISTING} for this one.`);
    return info;
}

// What App Store Connect has of a relationship of the version's: its data, or null where it has none.
const relatedData = (call, route) => call('GET', route).then(({ data }) => data, (error) => {
    if (error.status === 404) return null;
    throw error;
});

// Changes a resource's attributes where App Store Connect's differ from the settings', and says whether it did.
async function patchDiffering(call, type, resource, wanted) {
    const differing = Object.entries(wanted).filter(([field, value]) => resource.attributes?.[field] !== value);
    if (differing.length > 0) await call('PATCH', `/${type}/${resource.id}`, { data: { type, id: resource.id, attributes: Object.fromEntries(differing) } });
    return differing.length > 0;
}

// Puts the app's categories and age rating into its information that changes with the version, where App Store
// Connect's differ, and gives the names of those it changed.
async function updateInfoSettings(call, appId, { categories, ageRating }) {
    const info = await openInfo(call, appId, { what: 'categories and age rating', files: 'primary_category.txt, secondary_category.txt and age_rating.json' });
    const changed = [];
    if (Object.keys(categories).length > 0) {
        const { data } = await call('GET', query(`/appInfos/${info.id}`, { include: 'primaryCategory,secondaryCategory' }));
        const differing = Object.entries(categories).filter(([field, id]) => data.relationships?.[field]?.data?.id !== id);
        if (differing.length > 0) {
            const relationships = Object.fromEntries(differing.map(([field, id]) => [field, to('appCategories', id)]));
            await call('PATCH', `/appInfos/${info.id}`, { data: { type: 'appInfos', id: info.id, relationships } });
            changed.push('categories');
        }
    }
    if (ageRating) {
        const declaration = await call('GET', `/appInfos/${info.id}/ageRatingDeclaration`).then(({ data }) => data);
        if (await patchDiffering(call, 'ageRatingDeclarations', declaration, ageRating)) changed.push('age rating');
    }
    return changed;
}

// Puts the project's settings into App Store Connect where its own differ: the version's copyright and App Review's
// contact, and the categories and age rating of the app's information. Gives the names of those it changed.
async function updateSettings(call, appId, version, {
    copyright, categories = {}, ageRating, review = {},
} = {}) {
    const changed = [];
    if (copyright !== undefined && await patchDiffering(call, 'appStoreVersions', version, { copyright })) changed.push('copyright');
    if (Object.keys(categories).length > 0 || ageRating) changed.push(...await updateInfoSettings(call, appId, { categories, ageRating }));
    if (Object.keys(review).length > 0) {
        const detail = await relatedData(call, `/appStoreVersions/${version.id}/appStoreReviewDetail`);
        if (!detail) {
            await call('POST', '/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes: review, relationships: { appStoreVersion: to('appStoreVersions', version.id) } } });
            changed.push("App Review's contact");
        } else if (await patchDiffering(call, 'appStoreReviewDetails', detail, review)) {
            changed.push("App Review's contact");
        }
    }
    return changed;
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

// Waits for App Store Connect to process the screenshots uploaded, a set at a time, naming one it refuses; afterwards
// says what then where it has not in time.
async function processedScreenshots(call, sets, afterwards) {
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
            throw new Error(`crossbind: App Store Connect has not processed the screenshots in ${SCREENSHOT_MINUTES} minutes${afterwards}`);
        }
        await sleep(SCREENSHOT_POLL_SECONDS);
    }
}

// Puts the project's listing into the version and the app's information that changes with it, and gives the locales it
// changed. App Store Connect makes a locale's information of its name.
async function updateListing(call, appId, version, listings, afterwards) {
    if (listings.length === 0) return [];
    const { data: versionTexts } = await call('GET', query(`/appStoreVersions/${version.id}/appStoreVersionLocalizations`, { limit: '200' }));
    const info = listings.some((listing) => Object.keys(listing.info).length > 0)
        ? await openInfo(call, appId, { what: 'name, subtitle and privacy policy URL', files: 'name.txt, subtitle.txt and privacy_url.txt' }) : null;
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
    await processedScreenshots(call, sets, afterwards);
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
// is ready for review; one prepared with items in it stops the upload, which knows none of them.
async function submitForReview(call, appId, versionId, platform) {
    const prepared = await preparedSubmission(call, appId, platform);
    if (prepared?.items.length > 0) throw new Error(PREPARED_SUBMISSION);
    const submission = prepared?.submission ?? (await call('POST', '/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform }, relationships: { app: to('apps', appId) } } })).data;
    const item = { type: 'reviewSubmissionItems', relationships: { reviewSubmission: to('reviewSubmissions', submission.id), appStoreVersion: to('appStoreVersions', versionId) } };
    await call('POST', '/reviewSubmissionItems', { data: item });
    for (let look = 1; ; look += 1) {
        const { data: version } = await call('GET', `/appStoreVersions/${versionId}`);
        if (version.attributes.appVersionState === 'READY_FOR_REVIEW' || look === READY_LOOKS) break;
        await sleep(READY_POLL_SECONDS);
    }
    await call('PATCH', `/reviewSubmissions/${submission.id}`, { data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } } });
}

// Puts the project's listing and settings into the app's version of a number on its platform, and gives the version,
// the locales whose listing changed and the settings that did; afterwards says what then where its screenshots are not
// processed in time.
async function preparePage(call, {
    appId, versionString, listings, settings, platform, afterwards,
}) {
    const version = await openVersion(call, appId, versionString, platform);
    const listed = await updateListing(call, appId, version, listings, afterwards);
    const settled = await updateSettings(call, appId, version, settings);
    return { version, listed, settled };
}

// Puts the project's page into the app's version of a number on its platform, IOS or MAC_OS: its own, the one App Store
// Connect prepares under another number, renamed, or a new one, which shows it once out; with no build and no review.
// Gives the locales whose listing changed and the settings that did.
export async function sendListing(call, {
    appId, versionString, listings, settings, platform = 'IOS',
}) {
    const { listed, settled } = await preparePage(call, {
        appId, versionString, listings, settings, platform, afterwards: `: once it has, they show in ${versionString}'s listing there.`,
    });
    return { listed, settled };
}

// How App Store Connect's states of a version and of a build read, as crossbind app store says what it has.
const VERSION_STATES = {
    PREPARE_FOR_SUBMISSION: 'being prepared for submission',
    READY_FOR_REVIEW: 'ready for review',
    WAITING_FOR_REVIEW: 'waiting for review',
    IN_REVIEW: 'in review',
    PENDING_DEVELOPER_RELEASE: 'approved, waiting for you to release it',
    PENDING_APPLE_RELEASE: 'approved, waiting for Apple to release it',
    PROCESSING_FOR_DISTRIBUTION: 'approved, processing for distribution',
    READY_FOR_DISTRIBUTION: 'out',
    READY_FOR_SALE: 'out',
    REJECTED: 'rejected by App Review',
    METADATA_REJECTED: 'rejected by App Review for its listing',
    DEVELOPER_REJECTED: 'withdrawn from review',
    INVALID_BINARY: 'refused for its build',
};
const BUILD_STATES = {
    PROCESSING: 'processing', VALID: 'processed', FAILED: 'failed', INVALID: 'invalid',
};
const PLATFORM_NAMES = { IOS: 'iOS', MAC_OS: 'macOS' };
const wordsOf = (states, state) => states[state] ?? state.toLowerCase().replaceAll('_', ' ');

// What App Store Connect has of the app on each platform it is on: its latest versions, as their states read, and its
// newest build, processed or not.
export async function appStoreState(call, appId) {
    const lines = [];
    for (const [platform, name] of Object.entries(PLATFORM_NAMES)) {
        const { data: versions } = await call('GET', query(`/apps/${appId}/appStoreVersions`, { 'filter[platform]': platform, limit: '3' }));
        lines.push(...versions.map(({ attributes }) => `${name} ${attributes.versionString}: ${wordsOf(VERSION_STATES, attributes.appVersionState)}`));
        const { data: [build], included = [] } = await call('GET', query('/builds', {
            'filter[app]': appId, 'filter[preReleaseVersion.platform]': platform, sort: '-uploadedDate', limit: '1', include: 'preReleaseVersion',
        }));
        if (build) {
            const prerelease = build.relationships?.preReleaseVersion?.data?.id;
            const version = included.find(({ type, id }) => type === 'preReleaseVersions' && id === prerelease)?.attributes.version;
            const number = version ? `${version} (${build.attributes.version})` : build.attributes.version;
            lines.push(`${name} newest build: ${number}, ${wordsOf(BUILD_STATES, build.attributes.processingState)}`);
        }
    }
    return lines;
}

// Hands the upload's build to App Review as the app's version on its platform, IOS or MAC_OS, with the project's listing
// and settings, once App Store Connect has processed it, to go out in phases over 7 days once released where isPhased
// says so. Gives the build's number, the locales whose listing changed and the settings that did.
export async function submitRelease(call, {
    appId, versionString, before, buildNumber = null, listings, settings, isPhased, platform = 'IOS',
}) {
    const { version, listed, settled } = await preparePage(call, {
        appId, versionString, listings, settings, platform, afterwards: `, so the version went to no review: once it has, pick the build for ${versionString} in App Store Connect and submit it there.`,
    });
    if (isPhased) await phaseRelease(call, version.id);
    const build = await processedBuild(call, {
        appId, versionString, before, buildNumber, platform,
    });
    await call('PATCH', `/appStoreVersions/${version.id}/relationships/build`, to('builds', build.id));
    await submitForReview(call, appId, version.id, platform);
    return { build: build.attributes.version, listed, settled };
}
