import fs from 'node:fs';
import path from 'node:path';
import {
    isFolder, languageFolders, readText, takenNames,
} from './storeFolder.js';

// A project's Google Play listing: a folder per language, named as Play names its listings (en-US, tr-TR, es-419, fil),
// with the files fastlane's supply names.
const STORE = {
    name: 'Google Play', listing: 'a Google Play listing', folder: path.join('store', 'google-play'), language: /^[a-z]{2,3}(-([A-Z]{2}|\d{3}))?$/, example: 'en-US',
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

// Whether a language has texts or images for Play's listing, beside the notes of its releases.
export const isListed = ({ texts, images }) => Object.keys(texts).length > 0 || Object.keys(images).length > 0;

// The files a language's folder lacks of those Play makes a new listing of.
export const lackedForNewListing = ({ texts }) => NEW_LISTING.filter((file) => texts[TEXTS[file].field] === undefined);

// A release's notes in each language that has some, for its versionCode or else the default ones.
export const releaseNotesOf = (listings, versionCode) => listings
    .map(({ language, notes }) => ({ language, text: notes[versionCode] ?? notes.default }))
    .filter(({ text }) => text !== undefined);
