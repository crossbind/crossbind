import path from 'node:path';
import {
    APP_STORE_CONNECT, APP_STORE_LISTING, appStoreListingProblems, readAppStoreListing, readAppStoreSettings,
} from '@crossbind/core-store-kit';

const API_KEYS = 'https://appstoreconnect.apple.com/access/integrations/api';
const TEXTS = {
    name: 'name',
    subtitle: 'subtitle',
    privacyPolicyUrl: 'privacy policy URL',
    description: 'description',
    keywords: 'keywords',
    whatsNew: 'release notes',
    promotionalText: 'promotional text',
    supportUrl: 'support URL',
    marketingUrl: 'marketing URL',
};
const file = (name) => path.join(APP_STORE_LISTING, name);
// The platforms whose App Review notes and files can differ, as their folders in review_information name them.
const REVIEW_PLATFORMS = { ios: 'iOS', macos: 'macOS' };

// What crossbind app store --send sends of a locale, as a release does: its texts and its screenshots of
// each display type.
function localeLine({
    locale, info, version, screenshots, creativeAssets = {},
}) {
    const parts = [
        Object.keys({ ...info, ...version }).map((field) => TEXTS[field]).join(', '),
        Object.entries(screenshots).map(([type, files]) => `${files.length} ${type} screenshots`).join(', '),
        Object.keys(creativeAssets).map((role) => `${role} creative asset`).join(', '),
    ].filter(Boolean);
    return `${path.join(APP_STORE_LISTING, locale)}: ${parts.join('; ')}`;
}

// The project's listing, its settings for the platform and each platform's App Review details, with what stops reading
// them as a problem of its own.
function readAll(root, platform = 'ios') {
    const problems = [];
    let listings = [];
    let settings = { categories: {}, review: {} };
    const reviews = {};
    try {
        listings = readAppStoreListing(root);
        problems.push(...appStoreListingProblems(root, listings));
    } catch (error) {
        problems.push(error.message);
    }
    for (const name of Object.keys(REVIEW_PLATFORMS)) {
        try {
            const read = readAppStoreSettings(root, name);
            reviews[name] = read.review;
            if (name === platform) settings = read;
        } catch (error) {
            if (!problems.includes(error.message)) problems.push(error.message);
        }
    }
    return { listings, settings, reviews, problems };
}

// App Review's notes and files, once where every platform's are the same, else each platform's own.
function reviewLines(reviews) {
    const lines = (valueOf, line) => {
        const values = Object.entries(reviews).map(([name, review]) => [name, valueOf(review)]);
        if (values.every(([, value]) => value === undefined)) return [];
        if (new Set(values.map(([, value]) => JSON.stringify(value ?? null))).size === 1) return [line(values[0][1], '')];
        return values.filter(([, value]) => value !== undefined).map(([name, value]) => line(value, ` for ${REVIEW_PLATFORMS[name]}`));
    };
    const names = (files) => (files.length === 0 ? "none, so App Store Connect's go" : files.map((one) => path.basename(one)).join(', '));
    return [
        ...lines((review) => review.notes, (notes, whose) => `App Review notes${whose}`),
        ...lines((review) => review.attachments?.map((one) => path.basename(one)), (files, whose) => `App Review attachments${whose}: ${names(files)}`),
    ];
}

// What crossbind app store --send sends of the app's settings, as a release does.
function settingsLines({
    copyright, categories, ageRating, review,
}, reviews) {
    return [
        copyright === undefined ? null : `copyright: ${copyright}`,
        Object.keys(categories).length === 0 ? null : `categories: ${Object.values(categories).join(', ')}`,
        ageRating ? `the age rating's answers in ${file('store.json.ageRating')}` : null,
        Object.hasOwn(review, 'demoAccountRequired') ? `App Review sign-in required: ${review.demoAccountRequired ? 'yes' : 'no'}` : null,
        Object.keys(review).some((key) => key.startsWith('contact')) ? 'App Review contact details' : null,
        ...reviewLines(reviews),
    ].filter(Boolean);
}

// The steps App Store Connect alone takes of what the project's files leave out.
function lackedSteps(listings, settings) {
    const has = (pattern) => listings.some(({ screenshots }) => Object.keys(screenshots).some((type) => pattern.test(type)));
    return [
        listings.some(({ info }) => info.privacyPolicyUrl !== undefined) ? null
            : `App Information › Privacy Policy URL, which listing.json.privacyPolicyUrl in a locale's folder of ${APP_STORE_LISTING} would send.`,
        settings.categories.primaryCategory ? null : `App Information › Category, which ${file('store.json.primaryCategory')} would send, as UTILITIES.`,
        settings.ageRating ? null : `App Information › Age Rating: answer Apple's questions, which ${file('store.json.ageRating')} would send.`,
        settings.copyright === undefined ? `The version's Copyright, which ${file('store.json.copyright')} would send.` : null,
        ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'].every((key) => settings.review[key]) ? null : `The version's App Review Information: a contact's name, phone and e-mail, which ${file('review_information/private.json')} would send.`,
        has(/^APP_IPHONE_/) ? null : "The version's iPhone screenshots, 6.9-inch ones at least, which a locale's screenshots/APP_IPHONE_67 would send.",
        has(/^APP_IPAD_PRO_3GEN_129$/) ? null : "The version's 13-inch iPad screenshots, which App Store Connect takes of an app that runs on iPads, as crossbind's iOS apps do; a locale's screenshots/APP_IPAD_PRO_3GEN_129 would send them.",
        has(/^APP_DESKTOP$/) ? null : "The macOS version's screenshots, 16:10 ones of 1280 × 800 to 2880 × 1800, which a locale's screenshots/APP_DESKTOP would send.",
    ].filter(Boolean).map((text) => ({ text }));
}

// What crossbind app store says of App Store Connect, of the iOS app and the macOS one alike: what an upload sends, what
// a release puts out, what --send sends, which a release sends too, what App Store Connect would refuse of them, and the
// steps it alone takes.
export function appStoreGuide(api) {
    const { listings, settings, reviews, problems: read } = readAll(api.project.root, api.platform);
    const problems = [...read, ...(api.app.category?.macos ? [] : ['crossbind: app.category is not set, and the Mac App Store takes no app without its category.'])];
    const uploads = [
        'the iOS app, archived and uploaded, which TestFlight hands to testers once Apple has processed it; -p ios sends it alone',
        'then the macOS app, sandboxed, in an archive Xcode exports to App Store Connect, which signs it and its installer package in the cloud, and whose TestFlight hands it to Mac testers once Apple has processed it; -p macos sends it alone',
    ];
    const sends = [...listings.map(localeLine), ...settingsLines(settings, reviews)];
    const releases = [
        "the newest build of the version TestFlight's testers have, to App Review, which puts it out once approved, in phases over 7 days with --rollout",
        'with it, the page --send sends',
    ];
    const id = api.config.app.id;
    const steps = [
        id === undefined
            ? { text: 'Set app.id in crossbind.config.js, as com.example.myapp, which App Store Connect keeps for good as the bundle ID; then create the app with it, under Apps, as a new app on iOS and macOS, as an upload without -p sends both.', url: APP_STORE_CONNECT }
            : { text: `Apps › New App: an app with ${id} as its bundle ID, on iOS and macOS, as an upload without -p sends both, with its name, primary language and SKU, as Apple's API makes none; an upload registers the bundle ID first, so the form lists it. An app on iOS alone takes macOS later with the + beside its platform in the sidebar, as a universal purchase, which stays one once both platforms are approved, and uploads with -p ios until then.`, url: APP_STORE_CONNECT },
        { text: "App Privacy: answer what data the app and the code it carries collect, as Data Not Collected where it collects none; Apple's API takes no answer." },
        { text: "Pricing and Availability: the price, free or one of Apple's, and the countries and regions the app goes to." },
        { text: "App Information › Content Rights: whether the app shows, holds or reaches others' content." },
        ...lackedSteps(listings, settings),
        ...(api.app.encryption === null ? [{ text: 'Set app.encryption in crossbind.config.js, whose answer App Store Connect takes of every build and App Review of every submission.' }] : []),
        ...(api.app.encryption === true ? [{ text: 'App Information › App Encryption Documentation: what export compliance takes of an app that uses encryption.' }] : []),
        { text: "For --send, releases and CI: Users and Access › Integrations › App Store Connect API: a key of the App Manager or Admin role, which crossbind config set APPLE_API_KEY <its .p8 file> and APPLE_API_ISSUER <its issuer ID> keep on this Mac, and CI gives as CROSSBIND_APPLE_API_KEY, CROSSBIND_APPLE_API_KEY_ID and CROSSBIND_APPLE_API_ISSUER. Uploads then go with the key too: Apple signs the uploads of an Admin key in the cloud, as it does those of Xcode's account on your Mac.", url: API_KEYS },
    ];
    return {
        uploads, sends, releases, problems, where: 'App Store Connect', steps,
    };
}
