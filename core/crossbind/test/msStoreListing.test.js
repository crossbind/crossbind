import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import {
    afterEach, beforeEach, describe, expect, test,
} from 'vitest';
import {
    readStoreListing, readStoreSettings, storeListingProblems,
} from '../../../extensions/microsoft-store/src/msStoreListing.js';
import { jpegOf, pngOf, writeUnder } from './listingImages.js';

let project;
// Writes a file of the project's listing, under store/microsoft-store.
const write = (file, bytes = '') => writeUnder(project, `store/microsoft-store/${file}`, bytes);
const problemsOf = () => storeListingProblems(project, readStoreListing(project)).map(upath.toUnix);

beforeEach(() => {
    project = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-ms-listing-')));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe("a project's Microsoft Store listing", () => {
    test.each([
        ['en-US/keywords.txt', readStoreListing],
        ['category.txt', readStoreSettings]
    ])('rejects the retired %s file even without JSON', (file, read) => {
        write(file, 'unused');
        expect(() => read(project)).toThrow(file.split('/').at(-1));
    });

    test('reads typed lists from locale JSON with the same limits and keeps certification notes in their file', () => {
        write('store.json', JSON.stringify({ category: 'Productivity', websiteUrl: 'https://example.com' }));
        write('notes_for_certification.txt', 'Open a file.');
        write('en-US/listing.json', JSON.stringify({ title: 'Demo', features: ['Reads maps'], keywords: ['geo'] }));
        write('en-US/release_notes.txt', 'Initial release.');
        expect(readStoreSettings(project)).toEqual({ category: 'Productivity', websiteUrl: 'https://example.com', notesForCertification: 'Open a file.' });
        expect(readStoreListing(project)[0].texts).toEqual({ title: 'Demo', features: ['Reads maps'], keywords: ['geo'], releaseNotes: 'Initial release.' });
        write('en-US/listing.json', JSON.stringify({ keywords: Array(8).fill('map') }));
        expect(() => readStoreListing(project)).toThrow('7 at most');
    });

    test('is none without its folder', () => {
        expect(readStoreListing(project)).toEqual([]);
        expect(readStoreSettings(project)).toEqual({});
    });

    test("is each language's texts, its list entries, and its images, the screenshots in order with captions", () => {
        write('en-US/listing.json', JSON.stringify({ title: 'Demo\n', features: ['Converts files', 'Works offline'], keywords: ['demo', 'converter'] }));
        write('en-US/description.txt', 'The demo app.\r\nSecond line.');
        write('en-US/release_notes.txt', '');
        const second = write('en-US/images/screenshots/02.png', pngOf(1920, 1080));
        const first = write('en-US/images/screenshots/01.png', pngOf(1920, 1080));
        write('en-US/images/screenshots/01.txt', 'The library');
        const tile = write('en-US/images/tile.png', pngOf(300, 300));
        write('tr-TR/listing.json', JSON.stringify({ title: 'Deneme' }));
        write('store.json', JSON.stringify({ category: 'UtilitiesAndTools', privacyUrl: 'https://example.com/privacy' }));

        expect(readStoreListing(project).map((listing) => JSON.parse(JSON.stringify(listing, (key, value) => (key === 'file' ? upath.toUnix(value) : value))))).toEqual([
            {
                language: 'en-US',
                texts: {
                    title: 'Demo', description: 'The demo app.\nSecond line.', releaseNotes: '', features: ['Converts files', 'Works offline'], keywords: ['demo', 'converter'],
                },
                images: {
                    Screenshot: [{ file: upath.toUnix(first), caption: 'The library' }, { file: upath.toUnix(second) }],
                    Icon: [{ file: upath.toUnix(tile) }],
                },
            },
            { language: 'tr-TR', texts: { title: 'Deneme' }, images: {} },
        ]);
        expect(readStoreSettings(project)).toEqual({ category: 'UtilitiesAndTools', privacyUrl: 'https://example.com/privacy' });
    });

    test("stops at a list longer than the Store takes, a line too long, too many search terms' words, and a caption of no screenshot", () => {
        write('en-US/listing.json', JSON.stringify({ features: Array.from({ length: 21 }, (_, index) => `Feature ${index}`) }));
        expect(() => readStoreListing(project)).toThrow('listing.json.features has 21 entries, and the Microsoft Store takes 20 at most.');
        write('en-US/listing.json', JSON.stringify({ features: ['x'.repeat(201)] }));
        expect(() => readStoreListing(project)).toThrow('has an entry of 201 characters, and the Microsoft Store takes 200 at most');
        write('en-US/listing.json', JSON.stringify({ features: ['Fine'], keywords: ['one two three four', 'five six seven eight', 'nine ten eleven twelve', 'thirteen fourteen fifteen sixteen', 'seventeen eighteen nineteen twenty', 'twenty-one twenty-two'] }));
        expect(() => readStoreListing(project)).toThrow('listing.json.keywords has 22 words, and the Microsoft Store takes 21 at most in all its search terms.');
        write('en-US/listing.json', JSON.stringify({ keywords: ['demo'] }));
        write('en-US/images/screenshots/03.txt', 'Lost caption');
        expect(() => readStoreListing(project)).toThrow('03.txt is the caption of no screenshot, which is the PNG of its name.');
    });

    test("stops at a file it takes none of, and at a category's name Partner Center's API takes none of", () => {
        write('en-US/images/poster.png', pngOf(720, 1080));
        expect(() => readStoreListing(project)).toThrow('poster.png is none of the files a Microsoft Store listing takes');
        fs.rmSync(upath.join(project, 'store/microsoft-store/en-US/images/poster.png'));
        write('store.json', JSON.stringify({ category: 'Utilities + tools' }));
        expect(() => readStoreSettings(project)).toThrow('names "Utilities + tools", which is no category as Partner Center\'s API names one, as UtilitiesAndTools or Productivity.');
    });
});

describe("what the Microsoft Store would refuse of a listing's images", () => {
    test('is nothing of PNGs of the sizes it takes, landscape or portrait', () => {
        write('en-US/images/screenshots/01.png', pngOf(1366, 768));
        write('en-US/images/screenshots/02.png', pngOf(768, 1366));
        write('en-US/images/screenshots/03.png', pngOf(3840, 2160));
        write('en-US/images/tile.png', pngOf(300, 300));
        write('en-US/images/hero.png', pngOf(3840, 2160));
        expect(problemsOf()).toEqual([]);
    });

    test('is every image of another size or kind at once, and screenshots past ten', () => {
        write('en-US/images/screenshots/01.png', pngOf(1280, 720));
        write('en-US/images/screenshots/02.png', jpegOf(1920, 1080));
        Array.from({ length: 9 }, (_, index) => write(`en-US/images/screenshots/${String(index + 3).padStart(2, '0')}.png`, pngOf(1920, 1080)));
        write('en-US/images/tile.png', pngOf(512, 512));
        write('en-US/images/hero.png', pngOf(1920, 1200));
        expect(problemsOf()).toEqual([
            'crossbind: store/microsoft-store/en-US/images/hero.png is 1920 × 1200, and the Microsoft Store takes a 16:9 super hero art of 1920 × 1080 or 3840 × 2160.',
            'crossbind: store/microsoft-store/en-US/images/screenshots has 11 screenshots, and the Microsoft Store takes 10 desktop ones at most.',
            'crossbind: store/microsoft-store/en-US/images/screenshots/01.png is 1280 × 720, and the Microsoft Store takes a desktop screenshot of 1366 × 768 to 3840 × 2160, landscape or portrait.',
            'crossbind: store/microsoft-store/en-US/images/screenshots/02.png holds no PNG image, which the Microsoft Store takes alone: save it as a PNG, or remove the file.',
            'crossbind: store/microsoft-store/en-US/images/tile.png is 512 × 512, and the Microsoft Store takes a 1:1 app tile icon of 300 × 300.',
        ]);
    });
});
