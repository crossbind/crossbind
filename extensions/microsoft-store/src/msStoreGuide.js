import path from 'node:path';
import {
    STORE_LISTING, readStoreListing, readStoreSettings, storeListingProblems,
} from './msStoreListing.js';
import { STORE_ENV } from './partnerCenter.js';

const PARTNER_CENTER = 'https://partner.microsoft.com/dashboard/apps-and-games/overview';
const USERS = 'https://partner.microsoft.com/dashboard/account/v3/usermanagement';
const TEXTS = {
    title: 'title',
    description: 'description',
    shortDescription: 'short description',
    releaseNotes: 'release notes',
    copyrightAndTrademarkInfo: 'copyright',
    licenseTerms: 'license terms',
    devStudio: 'developer',
};
const IMAGES = { Icon: 'tile', PromotionalArt16x9: 'hero' };

// What crossbind app store --send sends of a language, as a release does: its texts, its lists and its images.
function languageLine({ language, texts, images }) {
    const parts = [
        Object.entries(texts).map(([field, text]) => (Array.isArray(text) ? `${text.length} ${field === 'features' ? 'features' : 'search terms'}` : TEXTS[field])).join(', '),
        Object.entries(images).map(([type, shots]) => IMAGES[type] ?? `${shots.length} desktop screenshots`).join(', '),
    ].filter(Boolean);
    return `${path.join(STORE_LISTING, language)}: ${parts.join('; ')}`;
}

// The project's listing and settings, with what stops reading them as a problem of its own.
function readAll(root) {
    const problems = [];
    let listings = [];
    let settings = {};
    try {
        listings = readStoreListing(root);
        problems.push(...storeListingProblems(root, listings));
    } catch (error) {
        problems.push(error.message);
    }
    try {
        settings = readStoreSettings(root);
    } catch (error) {
        problems.push(error.message);
    }
    return { listings, settings, problems };
}

// A setting's value where its file names one, else the file that would.
const valueOr = (value, file) => value ?? `(${path.join(STORE_LISTING, file)} would name it)`;

// Why a crossbind app declares runFullTrust, as Partner Center asks of a package that does.
const fullTrustNote = (api) => `${api.app.name} is a Win32 desktop app (${api.project.name}.exe, entry point Windows.FullTrustApplication) packaged as MSIX, not a UWP app, so it needs runFullTrust to run. It shows its user interface in WebView2 and runs its native code in its own process. The Microsoft Store updates it; it does not update itself.`;

// What Partner Center alone takes of the app's first submission, which an upload leaves there: the age ratings, the
// Properties its API takes no more, the markets and the price, why the app declares runFullTrust, and when it publishes.
export function firstSubmissionFinish(api, settings) {
    return [
        'Age ratings: answer the IARC questionnaire.',
        `Properties, which Partner Center's API takes no more: Privacy policy URL ${valueOr(settings.privacyUrl, 'store.json.privacyUrl')}, Website ${valueOr(settings.websiteUrl, 'store.json.websiteUrl')}, Support contact info ${valueOr(settings.supportContact, 'store.json.supportContact')}.`,
        'Pricing and availability: the markets, the visibility and the price, as Free.',
        `Submission options › runFullTrust, which Partner Center asks the app to explain, in 500 characters at most: ${fullTrustNote(api)}`,
        'Submission options › Publishing: once certified, the submission waits for Publish now, as crossbind leaves the first; publishing it as soon as it passes is chosen there.',
    ];
}

// What crossbind app store says of the Microsoft Store: what an upload sends, which is the packages with the page, what
// a release puts out, what --send sends, which is the page alone, what Partner Center would refuse of it, and the steps
// Partner Center alone takes: the app's name, the application its API takes, and the rest of the first submission.
export function msStoreGuide(api) {
    const { listings, settings, problems } = readAll(api.project.root);
    const identity = api.config.app.windows?.msix;
    const uploads = [
        "the app's MSIX packages, x64 and arm64, with the page --send sends, in a submission left for the release",
        "the app's first submission likewise, committed for Partner Center to take its files, which stops it at its age ratings for Partner Center to finish",
    ];
    const releases = [
        'the submission an upload left, for certification, after which Partner Center signs the packages and puts them out to the share of users --rollout gives at first',
        'with them, the page --send sends',
    ];
    const sends = [
        ...listings.map(languageLine),
        ...(settings.category === undefined ? [] : [`category: ${settings.category}`]),
        ...(settings.notesForCertification === undefined ? [] : [`the notes for certification in ${path.join(STORE_LISTING, 'notes_for_certification.txt')}`]),
    ];
    const steps = [
        { text: `Apps and games › New product › MSIX or PWA app: reserve the app's name, as ${api.app.name}.`, url: PARTNER_CENTER },
        ...(identity?.name && identity.publisher && identity.publisherDisplayName ? [] : [{
            text: 'Product management › Product identity: copy Package/Identity/Name, Package/Identity/Publisher and Package/Properties/PublisherDisplayName into crossbind.config.js, as app.windows.msix: { name, publisher, publisherDisplayName }.',
        }]),
        {
            text: `Account settings › Tenants, as the account's owner: associate the Microsoft Entra tenant of an application, then Account settings › User management › Microsoft Entra applications: add it with the Manager role and make a key, which ${STORE_ENV.tenant}, ${STORE_ENV.client} and ${STORE_ENV.secret} name, or an upload on a terminal asks for once.`,
            url: USERS,
        },
        {
            text: "crossbind app upload microsoft-store: the first submission, with the build's packages and the page, which Partner Center takes and stops at the age ratings. Then, in Partner Center, finish it and submit it:",
            details: firstSubmissionFinish(api, settings),
        },
        { text: 'Later versions: crossbind app upload microsoft-store, then crossbind app release microsoft-store.' },
    ];
    return {
        uploads, sends, releases, problems, where: 'Partner Center', steps,
    };
}
