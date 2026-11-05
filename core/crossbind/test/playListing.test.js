import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readPlayListing, releaseNotesOf } from '../src/publishers/google-play/playListing.js';

let project;
// Writes a file of the project's listing, under store/google-play.
const write = (file, text = '') => {
    const full = path.join(project, 'store', 'google-play', ...file.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
};
const shown = (file) => path.join('store', 'google-play', ...file.split('/'));

beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-listing-'));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe("a project's Google Play listing", () => {
    test('is none without its folder', () => {
        expect(readPlayListing(project)).toEqual([]);
    });

    test("is each language's texts, release notes and images, by the names fastlane gives their files, in order", () => {
        write('en-US/title.txt', 'Demo\r\n');
        write('en-US/full_description.txt', '  Line one\r\nLine two\n');
        write('en-US/video.txt', 'https://www.youtube.com/watch?v=demo');
        write('en-US/changelogs/default.txt', 'Fixes.\n');
        write('en-US/changelogs/1000007.txt', 'This one.');
        const icon = write('en-US/images/icon.png');
        const graphic = write('en-US/images/featureGraphic.JPG');
        const second = write('en-US/images/phoneScreenshots/2.png');
        const first = write('en-US/images/phoneScreenshots/1.jpeg');
        write('en-US/images/phoneScreenshots/.DS_Store');
        fs.mkdirSync(path.join(project, 'store', 'google-play', 'en-US', 'images', 'tenInchScreenshots'));
        write('tr-TR/short_description.txt', 'Bir deneme');
        write('.DS_Store');

        expect(readPlayListing(project)).toEqual([
            {
                language: 'en-US',
                texts: { title: 'Demo', fullDescription: 'Line one\nLine two', video: 'https://www.youtube.com/watch?v=demo' },
                notes: { default: 'Fixes.', 1000007: 'This one.' },
                images: { icon: [icon], featureGraphic: [graphic], phoneScreenshots: [first, second] },
            },
            { language: 'tr-TR', texts: { shortDescription: 'Bir deneme' }, notes: {}, images: {} },
        ]);
    });

    test('counts characters, not bytes, and stops at a text longer than Google Play takes', () => {
        write('en-US/title.txt', 'ü'.repeat(30));
        expect(readPlayListing(project)[0].texts.title).toHaveLength(30);
        write('en-US/title.txt', 'ü'.repeat(31));
        expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown('en-US/title.txt')} has 31 characters, and Google Play takes 30 at most.`);
        write('en-US/title.txt', 'Demo');
        write('en-US/changelogs/default.txt', 'x'.repeat(501));
        expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown('en-US/changelogs/default.txt')} has 501 characters, and Google Play takes 500 at most.`);
    });

    test('stops at a file or folder Google Play takes none of, naming it', () => {
        const refused = (file) => {
            write(file);
            expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown(file)} is none of the files a Google Play listing takes; app.md's Publishing names them.`);
            fs.rmSync(path.join(project, 'store'), { recursive: true });
        };
        refused('en-US/notes.txt');
        refused('en-US/constructor');
        refused('en-US/changelogs/latest.txt');
        refused('en-US/images/icon.gif');
        refused('en-US/images/promoGraphic.png');
        refused('en-US/images/phoneScreenshots/1.webp');
        fs.mkdirSync(path.join(project, 'store', 'google-play', 'en-US', 'images', 'phoneScreenshot'), { recursive: true });
        expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown('en-US/images/phoneScreenshot')} is none of the files a Google Play listing takes`);
    });

    test("stops at what is no language's folder, as images put a level too high, or a tag in another case than Play's", () => {
        write('images/icon.png');
        expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown('images')} is no language's folder, as en-US is, which a Google Play listing takes.`);
        fs.rmSync(path.join(project, 'store'), { recursive: true });
        write('README.md');
        expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown('README.md')} is no language's folder`);
        fs.rmSync(path.join(project, 'store'), { recursive: true });
        write('en-us/title.txt', 'Demo');
        expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown('en-us')} is no language's folder`);
        fs.rmSync(path.join(project, 'store'), { recursive: true });
        ['es-419', 'fil', 'iw-IL'].forEach((language) => write(`${language}/title.txt`, 'Demo'));
        expect(readPlayListing(project).map(({ language }) => language)).toEqual(['es-419', 'fil', 'iw-IL']);
    });

    test("stops at an empty text, but a video's, which takes the video away", () => {
        write('en-US/video.txt', '\n');
        expect(readPlayListing(project)[0].texts).toEqual({ video: '' });
        write('en-US/title.txt', ' \r\n');
        expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown('en-US/title.txt')} is empty: write its text, or remove the file.`);
        fs.rmSync(path.join(project, 'store'), { recursive: true });
        write('en-US/changelogs/default.txt');
        expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown('en-US/changelogs/default.txt')} is empty`);
    });

    test('stops at two files of one image', () => {
        write('en-US/images/icon.png');
        write('en-US/images/icon.jpg');
        expect(() => readPlayListing(project)).toThrow(`crossbind: ${shown('en-US/images')} has icon.jpg and icon.png, and Google Play takes one icon: keep one.`);
    });

    test('passes over the files systems leave in folders, and languages whose folders hold nothing', () => {
        write('en-US/images/phoneScreenshots/Thumbs.db');
        write('en-US/images/desktop.ini');
        write('tr-TR/.DS_Store');
        expect(readPlayListing(project)).toEqual([]);
    });
});

describe("a release's notes", () => {
    test("are each language's for the versionCode, else its default ones, and none for a language without", () => {
        const listings = [
            { language: 'de-DE', notes: {} },
            { language: 'en-US', notes: { default: 'Fixes.' } },
            { language: 'tr-TR', notes: { default: 'Düzeltmeler.', 1000007: 'Bu sürüm için.' } },
        ];
        expect(releaseNotesOf(listings, 1000007)).toEqual([{ language: 'en-US', text: 'Fixes.' }, { language: 'tr-TR', text: 'Bu sürüm için.' }]);
        expect(releaseNotesOf(listings, 1000008)).toEqual([{ language: 'en-US', text: 'Fixes.' }, { language: 'tr-TR', text: 'Düzeltmeler.' }]);
    });
});
