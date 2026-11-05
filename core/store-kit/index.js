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

// The folders of a store's listing in a project, one per language, of which a project without the listing has none.
export function languageFolders(store, project) {
    const root = path.join(project, store.folder);
    if (!fs.existsSync(root)) return [];
    return namesIn(root).map((language) => {
        const folder = path.join(root, language);
        if (!store.language.test(language) || !isFolder(folder)) {
            throw new Error(`crossbind: ${path.relative(project, folder)} is no language's folder, as ${store.example} is, which ${store.listing} takes.`);
        }
        return { language, folder };
    });
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
