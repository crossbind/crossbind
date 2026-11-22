import fs from 'node:fs';
import path from 'node:path';
import {
    imageOf, languageFolders, metadataTexts, readMetadata, readText, sizeOf, stringList, takenNames,
} from '@crossbind/core-store-kit';

// The settings beside the languages' folders: those Partner Center's submission API takes, which an upload sends, and
// those of its Properties page, which the API takes no more, so crossbind app store names them to enter there.
const SENT = {
    category: { most: 100 },
    notesForCertification: { file: 'notes_for_certification.txt', most: 2000 },
};
const BY_HAND = {
    privacyUrl: { most: 2000 },
    websiteUrl: { most: 2000 },
    supportContact: { most: 2000 },
};

// A project's Microsoft Store listing: a folder per language, named as BCP 47 names it (en-US, tr-TR, zh-Hans-CN), with
// localized metadata, long text and images in each one.
const STORE = {
    name: 'the Microsoft Store',
    listing: 'a Microsoft Store listing',
    folder: path.join('store', 'microsoft-store'),
    language: /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/,
    example: 'en-US',
    settings: [SENT.notesForCertification.file],
};
export const STORE_LISTING = STORE.folder;

// Partner Center's text limits apply to both JSON properties and dedicated long-text files.
const TEXTS = {
    title: { most: 256 },
    description: { file: 'description.txt', most: 10000 },
    shortDescription: { most: 1000 },
    releaseNotes: { file: 'release_notes.txt', most: 1500, canBeEmpty: true },
    copyrightAndTrademarkInfo: { most: 200 },
    licenseTerms: { file: 'license_terms.txt', most: 10000 },
    devStudio: { most: 255 },
};
const LISTS = {
    features: { entries: 20, most: 200 },
    keywords: { entries: 7, most: 40 },
};
const KEYWORD_WORDS = 21;
// The images a listing takes, by their files: the desktop's screenshots, each with a caption in the text file of its
// name, and the 1:1 app tile icon and 16:9 super hero art, by Partner Center's types.
const SCREENSHOTS = 'screenshots';
const IMAGES = { 'tile.png': 'Icon', 'hero.png': 'PromotionalArt16x9' };
const SCREENSHOTS_MOST = 10;
const CAPTION_MOST = 200;
const PNG_FILE = /^(.+)\.png$/i;

// Partner Center limits each list's length and each entry's character count.
function checkedList(lines, shown, { entries, most }) {
    if (lines.length > entries) throw new Error(`crossbind: ${shown} has ${lines.length} entries, and the Microsoft Store takes ${entries} at most.`);
    const long = lines.find((line) => [...line].length > most);
    if (long !== undefined) throw new Error(`crossbind: ${shown} has an entry of ${[...long].length} characters, and the Microsoft Store takes ${most} at most: ${long}`);
    return lines;
}

// The desktop's screenshots in order, each with its caption.
function readScreenshots(project, folder) {
    const names = takenNames(STORE, project, folder, (name, isDir) => !isDir && (PNG_FILE.test(name) || /\.txt$/i.test(name)));
    const shots = names.filter((name) => PNG_FILE.test(name)).map((name) => {
        const caption = path.join(folder, `${PNG_FILE.exec(name)[1]}.txt`);
        return {
            file: path.join(folder, name),
            ...(fs.existsSync(caption) ? { caption: readText(STORE, project, caption, { most: CAPTION_MOST }) } : {}),
        };
    });
    const loose = names.find((name) => /\.txt$/i.test(name) && !names.some((shot) => PNG_FILE.test(shot) && PNG_FILE.exec(shot)[1] === name.slice(0, -4)));
    if (loose) throw new Error(`crossbind: ${path.relative(project, path.join(folder, loose))} is the caption of no screenshot, which is the PNG of its name.`);
    return shots;
}

function readImages(project, folder) {
    if (!fs.existsSync(folder)) return {};
    const names = takenNames(STORE, project, folder, (name, isDir) => (isDir ? name === SCREENSHOTS : Object.hasOwn(IMAGES, name)));
    return Object.fromEntries(names.map((name) => (name === SCREENSHOTS
        ? ['Screenshot', readScreenshots(project, path.join(folder, name))]
        : [IMAGES[name], [{ file: path.join(folder, name) }]])).filter(([, shots]) => shots.length > 0));
}

function readLanguage(project, { language, folder }) {
    takenNames(STORE, project, folder, (name, isDir) => (isDir ? name === 'images' : name === 'listing.json' || Object.values(TEXTS).some((limits) => limits.file === name)));
    const file = path.join(folder, 'listing.json');
    const source = path.relative(project, file);
    const json = readMetadata(project, file, ['title', 'shortDescription', 'copyrightAndTrademarkInfo', 'devStudio', 'features', 'keywords']);
    const texts = metadataTexts(STORE, project, file, json, TEXTS);
    const lists = {};
    for (const [field, limits] of Object.entries(LISTS)) {
        if (Object.hasOwn(json, field)) {
            const label = `${source}.${field}`;
            lists[field] = checkedList(stringList(json[field], label), label, limits);
        }
    }
    const words = (lists.keywords ?? []).join(' ').split(/\s+/).filter(Boolean).length;
    if (words > KEYWORD_WORDS) {
        throw new Error(`crossbind: ${source}.keywords has ${words} words, and the Microsoft Store takes ${KEYWORD_WORDS} at most in all its search terms.`);
    }
    return { language, texts: { ...texts, ...lists }, images: readImages(project, path.join(folder, 'images')) };
}

// The project's Microsoft Store listing, a language's texts and images each; none without the folder, and no language
// whose folder holds none.
export const readStoreListing = (project) => languageFolders(STORE, project).map((folder) => readLanguage(project, folder))
    .filter(({ texts, images }) => Object.keys(texts).length > 0 || Object.keys(images).length > 0);

// The app's settings beside the listing's languages, each left out without its file.
export function readStoreSettings(project) {
    const fields = { ...SENT, ...BY_HAND };
    const folder = path.join(project, STORE.folder);
    const file = path.join(folder, 'store.json');
    languageFolders(STORE, project);
    const json = readMetadata(project, file, ['category', 'privacyUrl', 'websiteUrl', 'supportContact']);
    const settings = metadataTexts(STORE, project, file, json, fields);
    if (settings.category !== undefined && !/^[A-Za-z]+(_[A-Za-z]+)?$/.test(settings.category)) {
        const source = `${path.relative(project, file)}.category`;
        throw new Error(`crossbind: ${source} names ${JSON.stringify(settings.category)}, which is no category as Partner Center's API names one, as UtilitiesAndTools or Productivity.`);
    }
    return settings;
}

// What the Microsoft Store takes of each image: the desktop's screenshots, landscape or portrait, at least 1366 × 768 and
// at most 3840 × 2160, and the tile and hero at one size or another; PNG alone, of 50 MB at most.
const IMAGE_BYTES = 50 * 1024 * 1024;
const SIZES = { Icon: [[300, 300]], PromotionalArt16x9: [[1920, 1080], [3840, 2160]] };
const NAMES = { Screenshot: 'a desktop screenshot', Icon: 'a 1:1 app tile icon', PromotionalArt16x9: 'a 16:9 super hero art' };

function sizeProblem(type, image) {
    if (type !== 'Screenshot') {
        return SIZES[type].some(([width, height]) => width === image.width && height === image.height) ? null : SIZES[type].map((size) => size.join(' × ')).join(' or ');
    }
    const long = Math.max(image.width, image.height);
    const short = Math.min(image.width, image.height);
    return long >= 1366 && short >= 768 && long <= 3840 && short <= 2160 ? null : '1366 × 768 to 3840 × 2160, landscape or portrait';
}

// What the Microsoft Store would refuse of the listing's images, every one at once.
export function storeListingProblems(project, listings) {
    return listings.flatMap(({ language, images }) => Object.entries(images).flatMap(([type, shots]) => {
        const counted = shots.length > SCREENSHOTS_MOST
            ? [`crossbind: ${path.join(STORE.folder, language, 'images', SCREENSHOTS)} has ${shots.length} screenshots, and the Microsoft Store takes ${SCREENSHOTS_MOST} desktop ones at most.`] : [];
        return [...counted, ...shots.flatMap(({ file }) => {
            const shown = path.relative(project, file);
            const image = imageOf(file);
            if (image?.format !== 'png') return [`crossbind: ${shown} holds no PNG image, which the Microsoft Store takes alone: save it as a PNG, or remove the file.`];
            const size = sizeProblem(type, image);
            return [
                ...(size ? [`crossbind: ${shown} is ${sizeOf(image)}, and the Microsoft Store takes ${NAMES[type]} of ${size}.`] : []),
                ...(fs.statSync(file).size > IMAGE_BYTES ? [`crossbind: ${shown} is larger than the 50 MB the Microsoft Store takes of an image.`] : []),
            ];
        })];
    }));
}
