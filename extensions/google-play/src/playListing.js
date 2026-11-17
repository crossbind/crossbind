import fs from 'node:fs';
import path from 'node:path';
import {
    imageOf, isFolder, languageFolders, readSetting, readText, sizeOf, takenNames,
} from '@crossbind/core-store-kit';

// The app's contact details on Google Play, by their files beside the languages' folders, which an upload sends.
const DETAILS = {
    'contact_email.txt': { field: 'contactEmail', most: 100 },
    'contact_website.txt': { field: 'contactWebsite', most: 2000 },
    'contact_phone.txt': { field: 'contactPhone', most: 30 },
};
// The declaration of the app's Data safety section, as Play Console exports it, which an upload sends.
const DATA_SAFETY = 'data_safety.csv';
// What only Play Console takes, which crossbind app store names to enter there.
const BY_HAND = {
    'privacy_url.txt': { field: 'privacyUrl', most: 2000 },
    'category.txt': { field: 'category', most: 50 },
};

// A project's Google Play listing: a folder per language, named as Play names its listings (en-US, tr-TR, es-419, fil),
// with the files fastlane's supply names, and the app's settings beside them.
const STORE = {
    name: 'Google Play',
    listing: 'a Google Play listing',
    folder: path.join('store', 'google-play'),
    language: /^[a-z]{2,3}(-([A-Z]{2}|\d{3}))?$/,
    example: 'en-US',
    settings: [...Object.keys(DETAILS), DATA_SAFETY, ...Object.keys(BY_HAND)],
};
export const PLAY_LISTING = STORE.folder;
// A listing's texts by their files, and the most characters Play takes of each; a video's alone may be empty.
const TEXTS = {
    'title.txt': { field: 'title', most: 30 },
    'short_description.txt': { field: 'shortDescription', most: 80 },
    'full_description.txt': { field: 'fullDescription', most: 4000 },
    'video.txt': { field: 'video', most: Infinity, canBeEmpty: true },
};
// The texts Play makes a new listing of.
const NEW_LISTING = ['title.txt', 'short_description.txt', 'full_description.txt'];
const NOTES_MOST = 500;
const NOTES_FILE = /^(default|\d+)\.txt$/;
// Play's image types: one image each, or a folder of screenshots each.
const IMAGES = ['icon', 'featureGraphic', 'tvBanner'];
const SCREENSHOTS = ['phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvScreenshots', 'wearScreenshots'];
const IMAGE_FILE = /^(.+)\.(png|jpe?g)$/i;

// A release's notes by the versionCode they are for, or `default` for any other.
function readNotes(project, folder) {
    if (!fs.existsSync(folder)) return {};
    const names = takenNames(STORE, project, folder, (name, isDir) => !isDir && NOTES_FILE.test(name));
    return Object.fromEntries(names.map((name) => [path.basename(name, '.txt'), readText(STORE, project, path.join(folder, name), { most: NOTES_MOST })]));
}

// The image files of each type, in the order Play shows them.
function readImages(project, folder) {
    if (!fs.existsSync(folder)) return {};
    const imageOf = (name) => IMAGE_FILE.exec(name)?.[1];
    const names = takenNames(STORE, project, folder, (name, isDir) => (isDir ? SCREENSHOTS.includes(name) : IMAGES.includes(imageOf(name))));
    const twice = IMAGES.map((type) => names.filter((name) => imageOf(name) === type)).find((files) => files.length > 1);
    if (twice) throw new Error(`crossbind: ${path.relative(project, folder)} has ${twice.join(' and ')}, and Google Play takes one ${imageOf(twice[0])}: keep one.`);
    return Object.fromEntries(names.map((name) => {
        const file = path.join(folder, name);
        if (!isFolder(file)) return [imageOf(name), [file]];
        return [name, takenNames(STORE, project, file, (shot, isDir) => !isDir && IMAGE_FILE.test(shot)).map((shot) => path.join(file, shot))];
    }).filter(([, files]) => files.length > 0));
}

function readLanguage(project, { language, folder }) {
    const names = takenNames(STORE, project, folder, (name, isDir) => (isDir ? ['changelogs', 'images'].includes(name) : Object.hasOwn(TEXTS, name)));
    const texts = names.filter((name) => Object.hasOwn(TEXTS, name)).map((name) => [TEXTS[name].field, readText(STORE, project, path.join(folder, name), TEXTS[name])]);
    return {
        language,
        texts: Object.fromEntries(texts),
        notes: readNotes(project, path.join(folder, 'changelogs')),
        images: readImages(project, path.join(folder, 'images')),
    };
}

// The project's Google Play listing, a language's texts, release notes and images each, as its files hold them; none
// without the folder, and no language whose folder holds none.
export const readPlayListing = (project) => languageFolders(STORE, project).map((folder) => readLanguage(project, folder))
    .filter(({ texts, notes, images }) => [texts, notes, images].some((part) => Object.keys(part).length > 0));

// The release notes of each language that has some, which an upload sends with its bundle, read alone, as the rest of
// the folder goes with crossbind app store --send.
export const readPlayNotes = (project) => languageFolders(STORE, project)
    .map(({ language, folder }) => ({ language, notes: readNotes(project, path.join(folder, 'changelogs')) }))
    .filter(({ notes }) => Object.keys(notes).length > 0);

// Whether a language has texts or images for Play's listing, beside the notes of its releases.
export const isListed = ({ texts, images }) => Object.keys(texts).length > 0 || Object.keys(images).length > 0;

// The files a language's folder lacks of those Play makes a new listing of.
export const lackedForNewListing = ({ texts }) => NEW_LISTING.filter((file) => texts[TEXTS[file].field] === undefined);

// A release's notes in each language that has some, for its versionCode or else the default ones.
export const releaseNotesOf = (listings, versionCode) => listings
    .map(({ language, notes }) => ({ language, text: notes[versionCode] ?? notes.default }))
    .filter(({ text }) => text !== undefined);

// The app's settings beside the listing's languages: the contact details and the Data safety declaration an upload
// sends, and what only Play Console takes, each left out without its file.
export function readPlaySettings(project) {
    const textsOf = (files) => Object.fromEntries(Object.entries(files)
        .map(([file, limits]) => [limits.field, readSetting(STORE, project, file, limits)])
        .filter(([, text]) => text !== undefined));
    const dataSafety = readSetting(STORE, project, DATA_SAFETY, { most: Infinity });
    return { details: textsOf(DETAILS), ...(dataSafety === undefined ? {} : { dataSafety }), ...textsOf(BY_HAND) };
}

const KB = 1024;
// What Google Play takes of each image: its size, and whether it may hold transparency, which the icon alone may, and
// the bytes of the icon at most.
const IMAGE_RULES = {
    icon: { what: 'an icon', size: [512, 512], canHaveAlpha: true, bytes: 1024 * KB },
    featureGraphic: { what: 'a feature graphic', size: [1024, 500] },
    tvBanner: { what: 'a TV banner', size: [1280, 720] },
};
// What Google Play takes of the screenshots of each kind: the pixels of a side, the long side's ratio to the short one,
// or a square, the bytes of each at most, and how many at least and at most.
const SIDES = { least: 320, most: 3840, ratio: 2 };
const SCREENSHOT_RULES = {
    phoneScreenshots: { what: 'phone screenshots', ...SIDES, fewest: 2 },
    sevenInchScreenshots: { what: '7-inch tablet screenshots', ...SIDES, most: 7680 },
    tenInchScreenshots: { what: '10-inch tablet screenshots', ...SIDES, most: 7680 },
    tvScreenshots: { what: 'TV screenshots', ...SIDES },
    wearScreenshots: { what: 'Wear OS screenshots', least: 384, isSquare: true },
};
const SCREENSHOT_BYTES = 8 * KB * KB;
const SCREENSHOTS_MOST = 8;

// What Google Play would refuse of a screenshot's size.
function sidesProblem(image, rule) {
    const short = Math.min(image.width, image.height);
    const long = Math.max(image.width, image.height);
    if (rule.isSquare && image.width !== image.height) return `a square, ${rule.least} pixels a side at least`;
    if (short < rule.least || (rule.most && long > rule.most)) return `${rule.least} to ${rule.most} pixels a side`;
    if (rule.ratio && long > short * rule.ratio) return `a long side at most ${rule.ratio} times the short one`;
    return null;
}

// What Google Play would refuse of an image, before any goes up: a file that holds no PNG or JPEG image, another size,
// transparency, and more bytes than it takes.
function imageProblems(project, file, rule) {
    const shown = path.relative(project, file);
    const image = imageOf(file);
    if (!image) return [`crossbind: ${shown} holds no PNG or JPEG image, as an empty file or a Git LFS pointer does: put the image there, or remove the file.`];
    const problems = [];
    if (rule.size && (image.width !== rule.size[0] || image.height !== rule.size[1])) {
        problems.push(`crossbind: ${shown} is ${sizeOf(image)}, and Google Play takes ${rule.what} of ${rule.size.join(' × ')}.`);
    }
    const sides = rule.size ? null : sidesProblem(image, rule);
    if (sides) problems.push(`crossbind: ${shown} is ${sizeOf(image)}, and Google Play takes ${rule.what} of ${sides}.`);
    if (image.hasAlpha && !rule.canHaveAlpha) {
        const one = rule.size ? rule.what.replace(/^an? /, '') : rule.what.replace(/s$/, '');
        problems.push(`crossbind: ${shown} holds transparency, which Google Play takes in no ${one}: save it as a JPEG, or as a PNG without an alpha channel.`);
    }
    const bytes = rule.bytes ?? (rule.size ? Infinity : SCREENSHOT_BYTES);
    const size = fs.statSync(file).size;
    if (size > bytes) problems.push(`crossbind: ${shown} is ${Math.ceil(size / KB)} KB, and Google Play takes ${bytes / KB} KB at most of ${rule.what}.`);
    return problems;
}

// What Google Play would refuse of the listing's images, every one of them at once: their sizes, transparency and
// bytes, and how many screenshots of a kind.
export function playListingProblems(project, listings) {
    return listings.flatMap(({ language, images }) => Object.entries(images).flatMap(([type, files]) => {
        const rule = IMAGE_RULES[type] ?? SCREENSHOT_RULES[type];
        const folder = path.join(PLAY_LISTING, language, 'images', type);
        const counted = [];
        if (files.length > SCREENSHOTS_MOST && !IMAGE_RULES[type]) counted.push(`crossbind: ${folder} has ${files.length} ${rule.what}, and Google Play takes ${SCREENSHOTS_MOST} at most.`);
        if (files.length < (rule.fewest ?? 0)) counted.push(`crossbind: ${folder} has ${files.length} of the ${rule.fewest} ${rule.what} at least that Google Play takes to publish a listing.`);
        return [...counted, ...files.flatMap((file) => imageProblems(project, file, rule))];
    }));
}
