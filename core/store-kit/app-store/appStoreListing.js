import fs from 'node:fs';
import path from 'node:path';
import {
    assertImage, imageOf, isFolder, languageFolders, readSetting, readText, sizeOf, takenNames,
} from '../index.js';

// The app's settings beside the locales' folders, by fastlane deliver's names, which an upload with --submit sends: the
// version's copyright, the app's categories, its age rating's answers and App Review's contact.
const COPYRIGHT = 'copyright.txt';
const CATEGORIES = { 'primary_category.txt': 'primaryCategory', 'secondary_category.txt': 'secondaryCategory' };
const AGE_RATING = 'age_rating.json';
const REVIEW = 'review_information';
const REVIEW_TEXTS = {
    'first_name.txt': 'contactFirstName',
    'last_name.txt': 'contactLastName',
    'phone_number.txt': 'contactPhone',
    'email_address.txt': 'contactEmail',
    'demo_user.txt': 'demoAccountName',
    'demo_password.txt': 'demoAccountPassword',
    'notes.txt': 'notes',
};
const REVIEW_NOTES_MOST = 4000;

// A project's App Store listing: a folder per locale, named as App Store Connect names its localizations (en-US, tr,
// zh-Hans), with the texts' files fastlane's deliver names and a folder of screenshots per display type, and the app's
// settings beside them.
const STORE = {
    name: 'App Store Connect',
    listing: 'an App Store listing',
    folder: path.join('store', 'app-store'),
    language: /^[a-z]{2,3}(-([A-Z]{2}|[A-Z][a-z]{3}))?$/,
    example: 'en-US',
    settings: [COPYRIGHT, ...Object.keys(CATEGORIES), AGE_RATING, REVIEW],
};
export const APP_STORE_LISTING = STORE.folder;
// A listing's texts by their files: those of the app's information, which change with its next version, and those of
// the version itself, with the most characters App Store Connect takes of each; an optional one's empty file clears it.
const TEXTS = {
    'name.txt': { part: 'info', field: 'name', most: 30 },
    'subtitle.txt': { part: 'info', field: 'subtitle', most: 30, canBeEmpty: true },
    'privacy_url.txt': { part: 'info', field: 'privacyPolicyUrl', most: Infinity },
    'description.txt': { part: 'version', field: 'description', most: 4000 },
    'keywords.txt': { part: 'version', field: 'keywords', most: 100 },
    'release_notes.txt': { part: 'version', field: 'whatsNew', most: 4000 },
    'promotional_text.txt': { part: 'version', field: 'promotionalText', most: 170, canBeEmpty: true },
    'support_url.txt': { part: 'version', field: 'supportUrl', most: Infinity },
    'marketing_url.txt': { part: 'version', field: 'marketingUrl', most: Infinity, canBeEmpty: true },
};
// The display types of an iOS app's screenshots and a Mac app's, as App Store Connect names them, a folder each, and the
// most it takes of one type.
const DESKTOP = 'APP_DESKTOP';
const DISPLAY_TYPES = [
    'APP_IPHONE_67', 'APP_IPHONE_65', 'APP_IPHONE_61', 'APP_IPHONE_58', 'APP_IPHONE_55', 'APP_IPHONE_47', 'APP_IPHONE_40', 'APP_IPHONE_35',
    'APP_IPAD_PRO_3GEN_129', 'APP_IPAD_PRO_3GEN_11', 'APP_IPAD_PRO_129', 'APP_IPAD_105', 'APP_IPAD_97', DESKTOP,
];
const SCREENSHOTS_MOST = 10;
const IMAGE_FILE = /\.(png|jpe?g)$/i;

// The screenshots of each display type, in the order App Store Connect shows them.
function readScreenshots(project, folder) {
    if (!fs.existsSync(folder)) return {};
    const types = takenNames(STORE, project, folder, (name, isDir) => isDir && DISPLAY_TYPES.includes(name));
    return Object.fromEntries(types.map((type) => {
        const files = takenNames(STORE, project, path.join(folder, type), (name, isDir) => !isDir && IMAGE_FILE.test(name));
        if (files.length > SCREENSHOTS_MOST) {
            throw new Error(`crossbind: ${path.relative(project, path.join(folder, type))} has ${files.length} screenshots, and App Store Connect takes ${SCREENSHOTS_MOST} at most.`);
        }
        const paths = files.map((file) => path.join(folder, type, file));
        paths.forEach((file) => assertImage(project, file));
        return [type, paths];
    }).filter(([, files]) => files.length > 0));
}

function readLocale(project, { language: locale, folder }) {
    const names = takenNames(STORE, project, folder, (name, isDir) => (isDir ? name === 'screenshots' : Object.hasOwn(TEXTS, name)));
    const texts = names.filter((name) => Object.hasOwn(TEXTS, name)).map((name) => ({ ...TEXTS[name], text: readText(STORE, project, path.join(folder, name), TEXTS[name]) }));
    const partOf = (which) => Object.fromEntries(texts.filter(({ part }) => part === which).map(({ field, text }) => [field, text]));
    return {
        locale, info: partOf('info'), version: partOf('version'), screenshots: readScreenshots(project, path.join(folder, 'screenshots')),
    };
}

// The project's App Store listing, a locale's texts of the app's information and of its version, and the version's
// screenshots, each as its files hold them; none without the folder, and no locale whose folder holds none.
export const readAppStoreListing = (project) => languageFolders(STORE, project).map((folder) => readLocale(project, folder))
    .filter(({ info, version, screenshots }) => [info, version, screenshots].some((part) => Object.keys(part).length > 0));

// The answers App Store Connect's age rating takes, by its API's names: how often a kind of content shows, whether the
// app does a thing, and the overrides of the rating it works out.
const FREQUENCIES = ['NONE', 'INFREQUENT_OR_MILD', 'FREQUENT_OR_INTENSE', 'INFREQUENT', 'FREQUENT'];
const AGE_RATING_ANSWERS = {
    ...Object.fromEntries([
        'alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'gunsOrOtherWeapons', 'horrorOrFearThemes',
        'matureOrSuggestiveThemes', 'medicalOrTreatmentInformation', 'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity',
        'sexualContentOrNudity', 'violenceCartoonOrFantasy', 'violenceRealistic', 'violenceRealisticProlongedGraphicOrSadistic',
    ].map((field) => [field, FREQUENCIES])),
    ...Object.fromEntries([
        'advertising', 'ageAssurance', 'gambling', 'healthOrWellnessTopics', 'lootBox', 'messagingAndChat', 'parentalControls',
        'socialMedia', 'socialMediaAgeRestricted', 'unrestrictedWebAccess', 'userGeneratedContent',
    ].map((field) => [field, [true, false]])),
    kidsAgeBand: ['FIVE_AND_UNDER', 'SIX_TO_EIGHT', 'NINE_TO_ELEVEN', null],
    ageRatingOverrideV2: ['NONE', 'NINE_PLUS', 'THIRTEEN_PLUS', 'SIXTEEN_PLUS', 'EIGHTEEN_PLUS', 'UNRATED'],
    koreaAgeRatingOverride: ['NONE', 'ALL', 'TWELVE_PLUS', 'FIFTEEN_PLUS', 'NINETEEN_PLUS'],
};
// A category's id, as App Store Connect's API names it: UTILITIES, PRODUCTIVITY, GAMES_PUZZLE.
const CATEGORY_ID = /^[A-Z][A-Z_]*$/;

// The answers of age_rating.json: those of App Store Connect's API it knows, each checked, and any other it passes on
// as App Store Connect names it, for a question Apple adds.
function readAgeRating(project) {
    const file = path.join(project, STORE.folder, AGE_RATING);
    if (!fs.existsSync(file)) return null;
    const shown = path.relative(project, file);
    let answers;
    try {
        answers = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`crossbind: ${shown} holds no JSON: ${error.message}`, { cause: error });
    }
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
        throw new Error(`crossbind: ${shown} holds no object of App Store Connect's age rating answers, as { "violenceCartoonOrFantasy": "NONE", "gambling": false }.`);
    }
    for (const [field, answer] of Object.entries(answers)) {
        const known = AGE_RATING_ANSWERS[field];
        const isTaken = known ? known.includes(answer) : typeof answer === 'boolean' || (typeof answer === 'string' && CATEGORY_ID.test(answer));
        if (!isTaken) {
            throw new Error(`crossbind: ${shown} answers ${field} with ${JSON.stringify(answer)}, which App Store Connect takes none of${known ? `: it takes ${known.map((one) => JSON.stringify(one)).join(', ')}` : ''}.`);
        }
    }
    return answers;
}

// App Review's contact and demo account, by the files of review_information.
function readReview(project) {
    const folder = path.join(project, STORE.folder, REVIEW);
    if (!fs.existsSync(folder)) return {};
    if (!isFolder(folder)) throw new Error(`crossbind: ${path.relative(project, folder)} is no folder, which holds App Review's contact as fastlane's deliver names its files.`);
    const names = takenNames(STORE, project, folder, (name, isDir) => !isDir && Object.hasOwn(REVIEW_TEXTS, name));
    const texts = Object.fromEntries(names.map((name) => [REVIEW_TEXTS[name], readText(STORE, project, path.join(folder, name), { most: name === 'notes.txt' ? REVIEW_NOTES_MOST : Infinity })]));
    if ((texts.demoAccountName === undefined) !== (texts.demoAccountPassword === undefined)) {
        throw new Error(`crossbind: ${path.relative(project, folder)} has one of demo_user.txt and demo_password.txt, and App Review signs in with both: add the other, or remove it.`);
    }
    return texts.demoAccountName === undefined ? texts : { ...texts, demoAccountRequired: true };
}

// The app's settings beside the listing's locales, which an upload with --submit sends, each left out without its file:
// the version's copyright, the app's categories, its age rating's answers and App Review's contact.
export function readAppStoreSettings(project) {
    const copyright = readSetting(STORE, project, COPYRIGHT, { most: Infinity });
    const categories = Object.fromEntries(Object.entries(CATEGORIES).map(([file, field]) => {
        const id = readSetting(STORE, project, file, { most: Infinity });
        if (id !== undefined && !CATEGORY_ID.test(id)) {
            throw new Error(`crossbind: ${path.join(STORE.folder, file)} names ${JSON.stringify(id)}, which is no category's id as App Store Connect's API names it, as UTILITIES or PRODUCTIVITY.`);
        }
        return [field, id];
    }).filter(([, id]) => id !== undefined));
    const ageRating = readAgeRating(project);
    return {
        ...(copyright === undefined ? {} : { copyright }), categories, ...(ageRating === null ? {} : { ageRating }), review: readReview(project),
    };
}

// The sizes App Store Connect takes of each display type's screenshots, portrait, which it takes turned too, and the
// landscape ones of the oldest types that are no portrait one turned, which leave the status bar out.
const PORTRAITS = {
    APP_IPHONE_67: [[1320, 2868], [1290, 2796], [1260, 2736], [1284, 2778]],
    APP_IPHONE_65: [[1284, 2778], [1242, 2688]],
    APP_IPHONE_61: [[1206, 2622], [1179, 2556], [1170, 2532]],
    APP_IPHONE_58: [[1125, 2436], [1170, 2532], [1080, 2340]],
    APP_IPHONE_55: [[1242, 2208]],
    APP_IPHONE_47: [[750, 1334]],
    APP_IPHONE_40: [[640, 1136], [640, 1096]],
    APP_IPHONE_35: [[640, 960], [640, 920]],
    APP_IPAD_PRO_3GEN_129: [[2064, 2752], [2048, 2732]],
    APP_IPAD_PRO_129: [[2048, 2732]],
    APP_IPAD_PRO_3GEN_11: [[1668, 2388], [1640, 2360], [1668, 2420], [1488, 2266], [1512, 2316]],
    APP_IPAD_105: [[1668, 2224]],
    APP_IPAD_97: [[1536, 2048], [1536, 2008], [768, 1024], [768, 1004]],
};
const LANDSCAPES = { APP_IPHONE_40: [[1136, 600]], APP_IPHONE_35: [[960, 600]], APP_IPAD_97: [[2048, 1496], [1024, 748]] };
// A Mac app's screenshots, which App Store Connect takes in these 16:10 sizes alone.
const DESKTOPS = [[1280, 800], [1440, 900], [2560, 1600], [2880, 1800]];

// The listing as one platform's version takes it: the Mac's screenshots for MAC_OS, the other types' for IOS.
export const listingOf = (listings, platform) => listings.map((listing) => ({
    ...listing,
    screenshots: Object.fromEntries(Object.entries(listing.screenshots).filter(([type]) => (type === DESKTOP) === (platform === 'MAC_OS'))),
}));

// The sizes App Store Connect takes of a display type's screenshots, and how it says so.
function sizesOf(type) {
    if (type === DESKTOP) return { sizes: DESKTOPS, said: DESKTOPS.map((size) => size.join(' × ')).join(', ') };
    const portraits = PORTRAITS[type];
    return {
        sizes: [...portraits, ...portraits.map(([width, height]) => [height, width]), ...(LANDSCAPES[type] ?? [])],
        said: `${portraits.map((size) => size.join(' × ')).join(', ')}, or the same turned`,
    };
}

// What App Store Connect would refuse of the listing's screenshots, every one at once: a size its display type takes
// none of, and transparency, which it takes in no image.
export function appStoreListingProblems(project, listings) {
    return listings.flatMap(({ screenshots }) => Object.entries(screenshots).flatMap(([type, files]) => files.flatMap((file) => {
        const shown = path.relative(project, file);
        const image = imageOf(file);
        if (!image) return [`crossbind: ${shown} holds no PNG or JPEG image whose size it gives, as a cut-off file does: put the whole image there, or remove the file.`];
        const { sizes, said } = sizesOf(type);
        const problems = [];
        if (!sizes.some(([width, height]) => width === image.width && height === image.height)) {
            problems.push(`crossbind: ${shown} is ${sizeOf(image)}, and App Store Connect takes ${type} screenshots of ${said}.`);
        }
        if (image.hasAlpha) problems.push(`crossbind: ${shown} holds transparency, which App Store Connect takes in no screenshot: save it as a JPEG, or as a PNG without an alpha channel.`);
        return problems;
    })));
}
