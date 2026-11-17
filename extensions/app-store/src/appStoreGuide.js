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

// What a publish with --submit sends of a locale: its texts and its screenshots of each display type.
function localeLine({
    locale, info, version, screenshots,
}) {
    const parts = [
        Object.keys({ ...info, ...version }).map((field) => TEXTS[field]).join(', '),
        Object.entries(screenshots).map(([type, files]) => `${files.length} ${type} screenshots`).join(', '),
    ].filter(Boolean);
    return `with --submit, ${path.join(APP_STORE_LISTING, locale)}: ${parts.join('; ')}`;
}

// The project's listing and settings, with what stops reading them as a problem of its own.
function readAll(root) {
    const problems = [];
    let listings = [];
    let settings = { categories: {}, review: {} };
    try {
        listings = readAppStoreListing(root);
        problems.push(...appStoreListingProblems(root, listings));
    } catch (error) {
        problems.push(error.message);
    }
    try {
        settings = readAppStoreSettings(root);
    } catch (error) {
        problems.push(error.message);
    }
    return { listings, settings, problems };
}

// What a publish with --submit sends of the app's settings.
function settingsLines({
    copyright, categories, ageRating, review,
}) {
    return [
        copyright === undefined ? null : `copyright: ${copyright}`,
        Object.keys(categories).length === 0 ? null : `categories: ${Object.values(categories).join(', ')}`,
        ageRating ? `the age rating's answers in ${file('age_rating.json')}` : null,
        Object.keys(review).length === 0 ? null : `App Review's contact in ${file('review_information')}`,
    ].filter(Boolean).map((line) => `with --submit, ${line}`);
}

// The steps App Store Connect alone takes of what the project's files leave out.
function lackedSteps(listings, settings) {
    const has = (pattern) => listings.some(({ screenshots }) => Object.keys(screenshots).some((type) => pattern.test(type)));
    return [
        listings.some(({ info }) => info.privacyPolicyUrl !== undefined) ? null
            : `App Information › Privacy Policy URL, which privacy_url.txt in a locale's folder of ${APP_STORE_LISTING} would send.`,
        settings.categories.primaryCategory ? null : `App Information › Category, which ${file('primary_category.txt')} would send, as UTILITIES.`,
        settings.ageRating ? null : `App Information › Age Rating: answer Apple's questions, which ${file('age_rating.json')} would send.`,
        settings.copyright === undefined ? `The version's Copyright, which ${file('copyright.txt')} would send.` : null,
        Object.keys(settings.review).length > 0 ? null : `The version's App Review Information: a contact's name, phone and e-mail, which ${file('review_information')} would send.`,
        has(/^APP_IPHONE_/) ? null : "The version's iPhone screenshots, 6.9-inch ones at least, which a locale's screenshots/APP_IPHONE_67 would send.",
        has(/^APP_IPAD_PRO_3GEN_129$/) ? null : "The version's 13-inch iPad screenshots, which App Store Connect takes of an app that runs on iPads, as crossbind's iOS apps do; a locale's screenshots/APP_IPAD_PRO_3GEN_129 would send them.",
        has(/^APP_DESKTOP$/) ? null : "The macOS version's screenshots, 16:10 ones of 1280 × 800 to 2880 × 1800, which a locale's screenshots/APP_DESKTOP would send.",
    ].filter(Boolean).map((text) => ({ text }));
}

// What crossbind app store says of App Store Connect, of the iOS app and the macOS one alike: what a publish sends, with
// --submit the listing and settings too, what App Store Connect would refuse of them, and the steps it alone takes.
export function appStoreGuide(api) {
    const { listings, settings, problems: read } = readAll(api.project.root);
    const problems = [...read, ...(api.app.category?.macos ? [] : ['crossbind: app.category is not set, and the Mac App Store takes no app without its category.'])];
    const sends = [
        'with -p ios, the iOS app, archived and uploaded, which TestFlight hands to testers once Apple has processed it',
        'with -p macos, the macOS app, sandboxed, in an archive Xcode exports to App Store Connect, which signs it and its installer package in the cloud, and whose TestFlight hands it to Mac testers once Apple has processed it',
        ...listings.map(localeLine),
        ...settingsLines(settings),
    ];
    const id = api.config.app.id;
    const steps = [
        id === undefined
            ? { text: 'Set app.id in crossbind.config.js, as com.example.myapp, which App Store Connect keeps for good as the bundle ID; then create the app with it, under Apps, as a new app on iOS and, for -p macos, macOS.', url: APP_STORE_CONNECT }
            : { text: `Apps › New App: an app with ${id} as its bundle ID, on iOS and, for -p macos, macOS, with its name, primary language and SKU, as Apple's API makes none; a publish without --submit registers the bundle ID first, so the form lists it. An app on iOS alone takes macOS later with the + beside its platform in the sidebar, as a universal purchase, which stays one once both platforms are approved.`, url: APP_STORE_CONNECT },
        { text: "App Privacy: answer what data the app and the code it carries collect, as Data Not Collected where it collects none; Apple's API takes no answer." },
        { text: "Pricing and Availability: the price, free or one of Apple's, and the countries and regions the app goes to." },
        { text: "App Information › Content Rights: whether the app shows, holds or reaches others' content." },
        ...lackedSteps(listings, settings),
        ...(api.app.encryption === null ? [{ text: 'Set app.encryption in crossbind.config.js, whose answer App Store Connect takes of every build and App Review of every submission.' }] : []),
        ...(api.app.encryption === true ? [{ text: 'App Information › App Encryption Documentation: what export compliance takes of an app that uses encryption.' }] : []),
        { text: "For --submit and CI: Users and Access › Integrations › App Store Connect API: a key of the App Manager or Admin role, as CROSSBIND_APPLE_API_KEY, CROSSBIND_APPLE_API_KEY_ID and CROSSBIND_APPLE_API_ISSUER; Apple signs the uploads of an Admin key in the cloud, as it does those of Xcode's account on your Mac.", url: API_KEYS },
    ];
    return {
        sends, problems, where: 'App Store Connect', steps,
    };
}
