import fs from 'node:fs';
import path from 'node:path';
import {
    assertImage, languageFolders, readText, takenNames,
} from '../storeFolder.js';

// A project's App Store listing: a folder per locale, named as App Store Connect names its localizations (en-US, tr,
// zh-Hans), with the texts' files fastlane's deliver names and a folder of screenshots per display type.
const STORE = {
    name: 'App Store Connect', listing: 'an App Store listing', folder: path.join('store', 'app-store'), language: /^[a-z]{2,3}(-([A-Z]{2}|[A-Z][a-z]{3}))?$/, example: 'en-US',
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
// The display types of an iOS app's screenshots, as App Store Connect names them, a folder each, and the most it takes
// of one type.
const DISPLAY_TYPES = [
    'APP_IPHONE_67', 'APP_IPHONE_65', 'APP_IPHONE_61', 'APP_IPHONE_58', 'APP_IPHONE_55', 'APP_IPHONE_47', 'APP_IPHONE_40', 'APP_IPHONE_35',
    'APP_IPAD_PRO_3GEN_129', 'APP_IPAD_PRO_3GEN_11', 'APP_IPAD_PRO_129', 'APP_IPAD_105', 'APP_IPAD_97',
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
