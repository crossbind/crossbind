import fs from 'node:fs';
import path from 'node:path';
import {
    STORE_LISTING, readStoreListing, readStoreSettings, storeListingProblems,
} from './msStoreListing.js';
import { STORE_ENV } from './partnerCenter.js';

const PARTNER_CENTER = 'https://partner.microsoft.com/dashboard/apps-and-games/overview';
const USERS = 'https://partner.microsoft.com/dashboard/account/v3/usermanagement';
// Partner Center's fields of a listing, by the files that hold them.
const FIELDS = [
    ['listing.json.title', 'Product name'],
    ['description.txt', 'Description'],
    ['listing.json.shortDescription', 'Short description'],
    ['release_notes.txt', "What's new in this version"],
    ['listing.json.features', 'Product features'],
    ['listing.json.keywords', 'Search terms'],
    ['listing.json.copyrightAndTrademarkInfo', 'Copyright and trademark info'],
    ['license_terms.txt', 'Additional license terms'],
    ['listing.json.devStudio', 'Developed by'],
    ['images/screenshots', 'Screenshots, Desktop'],
    ['images/tile.png', '1:1 App tile icon'],
    ['images/hero.png', '16:9 Super hero art'],
];
// What Partner Center takes no listing without.
const REQUIRED = [['description.txt', 'Description'], ['images/screenshots', 'Screenshots, Desktop']];
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

// The fields of a language's listing its folder holds, each from its file, and those it lacks of what Partner Center
// takes no listing without.
function listingDetails(root, { language, texts }) {
    const folder = path.join(STORE_LISTING, language);
    const has = (file) => file.startsWith('listing.json.') ? Object.hasOwn(texts, file.slice('listing.json.'.length)) : fs.existsSync(path.join(root, folder, file));
    return [
        ...FIELDS.filter(([file]) => has(file)).map(([file, field]) => `${field} ← ${path.join(folder, file)}`),
        ...REQUIRED.filter(([file]) => !has(file)).map(([file, field]) => `${field}: none yet, which ${path.join(folder, file)} would hold and Partner Center takes no listing without`),
    ];
}

// The steps of the first submission, which Partner Center's API takes none of.
function firstSubmission(api, listings, settings) {
    const name = api.project.name;
    const languages = listings.length > 0 ? listings : [{ language: 'en-US', texts: {} }];
    return [
        { text: `First submission › Packages: dist/${name}-win32-x64.msix and dist/${name}-win32-arm64.msix, which crossbind app build -p windows makes with app.windows.msix set.` },
        ...languages.map((listing) => ({
            text: `First submission › Store listings › ${listing.language}, each field from its file:`,
            details: listingDetails(api.project.root, listing),
        })),
        {
            text: "First submission › Properties, whose last three Partner Center's API takes no more, so a later change of them is made there too:",
            details: [
                `Category: ${valueOr(settings.category, 'store.json.category')}`,
                `Privacy policy URL: ${valueOr(settings.privacyUrl, 'store.json.privacyUrl')}`,
                `Website: ${valueOr(settings.websiteUrl, 'store.json.websiteUrl')}`,
                `Support contact info: ${valueOr(settings.supportContact, 'store.json.supportContact')}`,
            ],
        },
        { text: 'First submission › Age ratings: answer the IARC questionnaire.' },
        { text: 'First submission › Pricing and availability: the markets, the visibility and the price, as Free.' },
        { text: `First submission › Submission options › Notes for certification: ${settings.notesForCertification ?? `why the app asks for runFullTrust, as every desktop app in a package does: it runs as it does outside one; ${path.join(STORE_LISTING, 'notes_for_certification.txt')} would send it later.`}` },
    ];
}

// What crossbind app store says of the Microsoft Store: what an upload sends, which is the packages, what a release puts
// out, which is them with the page, what --send sends, which is the page alone, what Partner Center would refuse of it,
// and the steps Partner Center alone takes: the app's name, the first submission and the application its API takes.
export function msStoreGuide(api) {
    const { listings, settings, problems } = readAll(api.project.root);
    const identity = api.config.app.windows?.msix;
    const uploads = [
        "the app's MSIX packages, x64 and arm64, in place of the last submission's, in a submission left for the release",
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
        ...firstSubmission(api, listings, settings),
        {
            text: `For later versions, which uploads and releases send: Account settings › User management › Microsoft Entra applications: add one with the Manager role and make a key, which ${STORE_ENV.tenant}, ${STORE_ENV.client} and ${STORE_ENV.secret} name, or an upload on a terminal asks for once.`,
            url: USERS,
        },
    ];
    return {
        uploads, sends, releases, problems, where: 'Partner Center', steps,
    };
}
