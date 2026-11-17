import fs from 'node:fs';
import path from 'node:path';

// The files systems leave in folders, as .DS_Store and Thumbs.db, which a store's listing passes over.
const isSystemFile = (name) => name.startsWith('.') || ['Thumbs.db', 'desktop.ini'].includes(name);

export const isFolder = (file) => fs.statSync(file).isDirectory();
const namesIn = (folder) => fs.readdirSync(folder).filter((name) => !isSystemFile(name)).sort();

// The names in a folder of a store's listing, in order, each one the listing takes.
export function takenNames(store, project, folder, isTaken) {
    const names = namesIn(folder);
    const other = names.find((name) => !isTaken(name, isFolder(path.join(folder, name))));
    if (other !== undefined) {
        throw new Error(`crossbind: ${path.relative(project, path.join(folder, other))} is none of the files ${store.listing} takes; app.md's Publishing names them.`);
    }
    return names;
}

// The first bytes of a PNG and of a JPEG image.
const IMAGE_SIGNATURES = [Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8, 0xff])];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// PNG's color types with an alpha channel: gray and RGB, each with alpha.
const PNG_ALPHA_TYPES = [4, 6];
// JPEG's start-of-frame markers, which give the image's size: 0xC0 to 0xCF but the tables' 0xC4, 0xC8 and 0xCC.
const isFrameMarker = (marker) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
// JPEG's markers that stand alone, with no length after them.
const isBareMarker = (marker) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);

// A PNG's size and whether it holds transparency: an alpha channel, or a tRNS chunk before its image data.
function pngOf(bytes) {
    if (bytes.length < 33 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
    let hasAlpha = PNG_ALPHA_TYPES.includes(bytes[25]);
    for (let at = 8; !hasAlpha && at + 8 <= bytes.length;) {
        const type = bytes.toString('latin1', at + 4, at + 8);
        if (type === 'IDAT') break;
        hasAlpha = type === 'tRNS';
        at += 12 + bytes.readUInt32BE(at);
    }
    return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), hasAlpha };
}

// A JPEG's size, from its first start-of-frame segment.
function jpegOf(bytes) {
    for (let at = 2; at + 4 <= bytes.length;) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        if (marker === 0xff) {
            at += 1;
        } else if (isBareMarker(marker)) {
            at += 2;
        } else if (isFrameMarker(marker)) {
            return at + 9 <= bytes.length ? {
                format: 'jpeg', width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5), hasAlpha: false,
            } : null;
        } else {
            at += 2 + bytes.readUInt16BE(at + 2);
        }
    }
    return null;
}

// A listing's image as its header gives it: PNG or JPEG, its width and height in pixels and whether it holds
// transparency, which no JPEG does; null for a file that holds neither, or whose header ends early.
export function imageOf(file) {
    const bytes = fs.readFileSync(file);
    if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return pngOf(bytes);
    if (bytes.subarray(0, 3).equals(IMAGE_SIGNATURES[1])) return jpegOf(bytes);
    return null;
}

// An image's size, as messages name it.
export const sizeOf = ({ width, height }) => `${width} × ${height}`;

// Stops at a listing's image file that holds no PNG or JPEG image, as an empty file or a Git LFS pointer does.
export function assertImage(project, file) {
    const head = Buffer.alloc(4);
    const descriptor = fs.openSync(file, 'r');
    try {
        fs.readSync(descriptor, head, 0, head.length, 0);
    } finally {
        fs.closeSync(descriptor);
    }
    if (!IMAGE_SIGNATURES.some((signature) => head.subarray(0, signature.length).equals(signature))) {
        throw new Error(`crossbind: ${path.relative(project, file)} holds no PNG or JPEG image, as an empty file or a Git LFS pointer does: put the image there, or remove the file.`);
    }
}

// The text of a listing's file, with its line ends as stores take them; only an optional text's file may be empty.
export function readText(store, project, file, { most, canBeEmpty = false }) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
    const length = [...text].length;
    if (length === 0 && !canBeEmpty) throw new Error(`crossbind: ${path.relative(project, file)} is empty: write its text, or remove the file.`);
    if (length > most) throw new Error(`crossbind: ${path.relative(project, file)} has ${length} characters, and ${store.name} takes ${most} at most.`);
    return text;
}

// The folders of a store's listing in a project, one per language, of which a project without the listing has none;
// the files of the store's settings beside them, which store.settings names, are none.
export function languageFolders(store, project) {
    const root = path.join(project, store.folder);
    if (!fs.existsSync(root)) return [];
    const settings = store.settings ?? [];
    return namesIn(root).filter((name) => !settings.includes(name)).map((language) => {
        const folder = path.join(root, language);
        if (!store.language.test(language) || !isFolder(folder)) {
            const beside = settings.length > 0 ? ` Beside the languages' folders it takes ${settings.join(', ')} alone.` : '';
            throw new Error(`crossbind: ${path.relative(project, folder)} is no language's folder, as ${store.example} is, which ${store.listing} takes.${beside}`);
        }
        return { language, folder };
    });
}

// The text of a setting's file beside the listing's language folders, or undefined without the file.
export function readSetting(store, project, name, limits) {
    const file = path.join(project, store.folder, name);
    return fs.existsSync(file) ? readText(store, project, file, limits) : undefined;
}

// An id both stores take: dot-separated parts of letters and digits, each starting with a letter, as Apple's take no
// underscore and Google's no hyphen.
const STORE_APP_ID = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;

// Asks for the app's id, which the store keeps for good, under the name the store gives it.
export async function askAppId(api, store, term) {
    api.log(`crossbind: ${store} knows an app by its ${term}, app.id, and keeps it for good.`);
    for (;;) {
        const id = (await api.ask(`The ${term}, as com.example.myapp: `)).trim();
        if (STORE_APP_ID.test(id)) {
            await api.config.write('app.id', id);
            return id;
        }
        api.log(`That is no ${term} both stores take, which is dot-separated parts of letters and digits, each starting with a letter.`);
    }
}

// App Store Connect's API, the app's versions and their review, and the listing in store/app-store, of the iOS app and
// the macOS one alike.
export { appStoreCaller, appStoreToken, uploadParts } from './app-store/appStoreApi.js';
export {
    APP_STORE_LISTING, appStoreListingProblems, listingOf, readAppStoreListing, readAppStoreSettings,
} from './app-store/appStoreListing.js';
export {
    APP_STORE_CONNECT, appStoreApp, assertReviewable, newestBuild, submitRelease,
} from './app-store/appStoreRelease.js';
export { untilDone, uploadArchive } from './app-store/appStoreExport.js';
