import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { carriedFilesOf, copyCarriedFiles } from '../src/utils/appFiles.js';
import { appFiles } from '../src/utils/appOptions.js';

const roots = [];

function folder(files = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-carried-'));
    roots.push(root);
    Object.entries(files).forEach(([file, text]) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
    });
    return root;
}

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("an app's own files", () => {
    const files = (root, listed) => () => appFiles({ paths: { project: root }, app: listed === undefined ? {} : { files: listed } });

    test('are none without app.files, and the files and folders of the project it lists, which keep their places', () => {
        const root = folder({ 'seeds/a.sqlite': '', 'words.txt': '', '..data/b.bin': '' });

        expect(files(root)()).toEqual([]);
        expect(files(root, ['seeds/', 'words.txt', '..data'])()).toEqual(['seeds', 'words.txt', '..data']);
        // A link that leads to the project's own files is none it carries, as its file is.
        fs.symlinkSync(path.join(root, 'seeds'), path.join(root, 'inner'));
        expect(files(root, ['inner/a.sqlite'])()).toEqual([path.join('inner', 'a.sqlite')]);
    });

    test("are refused before anything builds, outside the project's folder, missing, or holding a link", () => {
        const root = folder({ 'seeds/a.sqlite': '', 'words.txt': '' });

        expect(files(root, 'words.txt')).toThrow("crossbind: app.files \"words.txt\" is no list of the project's files and folders, as ['seed.sqlite'] is.");
        expect(files(root, ['../outside'])).toThrow("crossbind: app.files names \"../outside\", which is no path inside the project's folder.");
        expect(files(root, ['missing.bin'])).toThrow("crossbind: app.files names missing.bin, which is no file or folder of the project's.");
        fs.symlinkSync(os.tmpdir(), path.join(root, 'seeds', 'out'));
        expect(files(root, ['seeds/'])).toThrow(`crossbind: app.files names seeds/, which holds the link ${path.join('seeds', 'out')}: an app carries no link, which could reach any file of the machine it is built on.`);
        // A folder a link leads to outside the project, as the build machine's home.
        fs.symlinkSync(folder({ 'secret.txt': 'secret' }), path.join(root, 'home'));
        expect(files(root, ['home/secret.txt'])).toThrow("crossbind: app.files names home/secret.txt, which a link leads out of the project's folder: an app carries no link, which could reach any file of the machine it is built on.");
    });
});

describe('the files an app carries', () => {
    test("are each extension's in ext/<name>/ and the app's own in files/, each in the place it had in its folder", () => {
        const extension = folder({ 'models/eng/eng.bin': 'model', 'data/words.txt': 'words', 'native.cpp': '' });
        const project = folder({ 'seed.sqlite': 'seed' });
        const resources = folder();

        copyCarriedFiles(resources, [{ name: 'ocr', root: extension, paths: ['models/', 'data/words.txt'] }], { root: project, paths: ['seed.sqlite'] });

        expect(fs.readFileSync(path.join(resources, 'ext', 'ocr', 'models', 'eng', 'eng.bin'), 'utf8')).toBe('model');
        expect(fs.readFileSync(path.join(resources, 'ext', 'ocr', 'data', 'words.txt'), 'utf8')).toBe('words');
        expect(fs.existsSync(path.join(resources, 'ext', 'ocr', 'native.cpp'))).toBe(false);
        expect(fs.readFileSync(path.join(resources, 'files', 'seed.sqlite'), 'utf8')).toBe('seed');
    });

    test('are each file the lists name, those in their folders too, by its full path', () => {
        const extension = folder({ 'models/eng/eng.bin': 'model', 'data/words.txt': 'words' });
        const project = folder({ 'seed.sqlite': 'seed' });

        expect(carriedFilesOf([{ name: 'ocr', root: extension, paths: ['models/', 'data/words.txt'] }], { root: project, paths: ['seed.sqlite'] }).sort()).toEqual([
            path.join(extension, 'data', 'words.txt'), path.join(extension, 'models', 'eng', 'eng.bin'), path.join(project, 'seed.sqlite'),
        ].sort());
    });
});
