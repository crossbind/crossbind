import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import {
    afterEach, beforeEach, describe, expect, test,
} from 'vitest';
import {
    imageOf, languageFolders, readSetting, sizeOf,
} from '../../store-kit/index.js';
import {
    RGB, RGBA, jpegOf, pngOf, writeUnder,
} from './listingImages.js';

let project;
const STORE = {
    name: 'Demo Store', listing: 'a Demo Store listing', folder: upath.join('store', 'demo'), language: /^[a-z]{2}-[A-Z]{2}$/, example: 'en-US',
};

beforeEach(() => {
    project = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-store-kit-')));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe("a listing's image", () => {
    test('is a PNG or a JPEG of the size its header gives, with transparency where a PNG holds any', () => {
        expect(imageOf(writeUnder(project, 'rgb.png', pngOf(1320, 2868)))).toEqual({
            format: 'png', width: 1320, height: 2868, hasAlpha: false,
        });
        expect(imageOf(writeUnder(project, 'rgba.png', pngOf(512, 512, { colorType: RGBA })))).toMatchObject({ hasAlpha: true });
        expect(imageOf(writeUnder(project, 'gray.png', pngOf(10, 10, { colorType: 4 })))).toMatchObject({ hasAlpha: true });
        expect(imageOf(writeUnder(project, 'keyed.png', pngOf(10, 10, { colorType: RGB, isTransparent: true })))).toMatchObject({ hasAlpha: true });
        expect(imageOf(writeUnder(project, 'photo.jpg', jpegOf(1080, 1920)))).toEqual({
            format: 'jpeg', width: 1080, height: 1920, hasAlpha: false,
        });
        expect(imageOf(writeUnder(project, 'progressive.jpg', jpegOf(1024, 500, 0xc2)))).toMatchObject({ width: 1024, height: 500 });
    });

    test('is none of a file that holds no image, or whose header ends early', () => {
        expect(imageOf(writeUnder(project, 'text.png', 'version https://git-lfs.github.com/spec/v1'))).toBeNull();
        expect(imageOf(writeUnder(project, 'empty.png'))).toBeNull();
        expect(imageOf(writeUnder(project, 'cut.png', pngOf(10, 10).subarray(0, 20)))).toBeNull();
        expect(imageOf(writeUnder(project, 'cut.jpg', jpegOf(10, 10).subarray(0, 14)))).toBeNull();
    });

    test('has a size messages name as width × height', () => {
        expect(sizeOf({ width: 1080, height: 1920 })).toBe('1080 × 1920');
    });
});

describe("a store's folder", () => {
    test("is a folder per language, beside the store's settings, which are none", () => {
        writeUnder(project, 'store/demo/en-US/title.txt', 'Demo');
        writeUnder(project, 'store/demo/contact.txt', 'demo@example.com');
        writeUnder(project, 'store/demo/review/notes.txt', 'Notes');
        const settings = { ...STORE, settings: ['contact.txt', 'review'] };
        expect(languageFolders(settings, project).map(({ language, folder }) => [language, upath.toUnix(folder)])).toEqual([['en-US', upath.join(project, 'store/demo/en-US')]]);
    });

    test('names the settings it takes beside the languages where a file is neither', () => {
        writeUnder(project, 'store/demo/notes.md', 'Notes');
        expect(() => languageFolders(STORE, project)).toThrow("is no language's folder, as en-US is, which a Demo Store listing takes.");
        const settings = { ...STORE, settings: ['contact.txt', 'review'] };
        expect(() => languageFolders(settings, project)).toThrow("which a Demo Store listing takes. Beside the languages' folders it takes contact.txt, review alone.");
    });

    test("has a setting's text, trimmed, or none without its file, and stops at one longer than the store takes", () => {
        expect(readSetting(STORE, project, 'contact.txt', { most: 20 })).toBeUndefined();
        writeUnder(project, 'store/demo/contact.txt', ' demo@example.com\r\n');
        expect(readSetting(STORE, project, 'contact.txt', { most: 20 })).toBe('demo@example.com');
        expect(() => readSetting(STORE, project, 'contact.txt', { most: 5 })).toThrow('has 16 characters, and Demo Store takes 5 at most.');
    });
});
