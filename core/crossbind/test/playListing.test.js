import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import upath from 'upath';
import {
    playListingProblems, readPlayListing, readPlaySettings, releaseNotesOf,
} from '../../../extensions/google-play/src/playListing.js';
import { playGuide } from '../../../extensions/google-play/src/playGuide.js';
import { RGBA, jpegOf, pngOf } from './listingImages.js';

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

describe("a project's Google Play settings", () => {
    test('are the contact details and Data safety declaration a publish sends, and what Play Console alone takes, beside the languages', () => {
        write('contact_email.txt', 'support@example.com\n');
        write('contact_website.txt', 'https://example.com');
        write('data_safety.csv', 'Question ID,Response ID\nPSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA,false\n');
        write('privacy_url.txt', 'https://example.com/privacy');
        write('category.txt', 'Tools');
        write('en-US/title.txt', 'Demo');
        expect(readPlaySettings(project)).toEqual({
            details: { contactEmail: 'support@example.com', contactWebsite: 'https://example.com' },
            dataSafety: 'Question ID,Response ID\nPSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA,false',
            privacyUrl: 'https://example.com/privacy',
            category: 'Tools',
        });
        expect(readPlayListing(project).map(({ language }) => language)).toEqual(['en-US']);
    });

    test('are none without their files', () => {
        expect(readPlaySettings(project)).toEqual({ details: {} });
    });
});

describe("what Google Play would refuse of a listing's images", () => {
    const problemsOf = () => playListingProblems(project, readPlayListing(project)).map(upath.toUnix);

    test('is nothing of images of the sizes it takes', () => {
        write('en-US/images/icon.png', pngOf(512, 512, { colorType: RGBA }));
        write('en-US/images/featureGraphic.jpg', jpegOf(1024, 500));
        write('en-US/images/phoneScreenshots/01.png', pngOf(1080, 1920));
        write('en-US/images/phoneScreenshots/02.png', pngOf(1920, 1080));
        write('en-US/images/tenInchScreenshots/01.png', pngOf(1600, 2560));
        write('en-US/images/wearScreenshots/01.png', pngOf(384, 384));
        expect(problemsOf()).toEqual([]);
    });

    test('is every image of another size, with transparency, larger than Play takes, or past its count, at once', () => {
        write('en-US/images/icon.png', Buffer.concat([pngOf(500, 500), Buffer.alloc(1025 * 1024)]));
        write('en-US/images/featureGraphic.png', pngOf(1024, 500, { colorType: RGBA }));
        write('en-US/images/phoneScreenshots/01.png', pngOf(1080, 2400));
        Array.from({ length: 9 }, (_, index) => write(`en-US/images/tenInchScreenshots/${index}.png`, pngOf(1600, 2560)));
        write('en-US/images/wearScreenshots/01.png', pngOf(384, 400));
        expect(problemsOf()).toEqual([
            'crossbind: store/google-play/en-US/images/featureGraphic.png holds transparency, which Google Play takes in no feature graphic: save it as a JPEG, or as a PNG without an alpha channel.',
            'crossbind: store/google-play/en-US/images/icon.png is 500 × 500, and Google Play takes an icon of 512 × 512.',
            'crossbind: store/google-play/en-US/images/icon.png is 1026 KB, and Google Play takes 1024 KB at most of an icon.',
            'crossbind: store/google-play/en-US/images/phoneScreenshots has 1 of the 2 phone screenshots at least that Google Play takes to publish a listing.',
            'crossbind: store/google-play/en-US/images/phoneScreenshots/01.png is 1080 × 2400, and Google Play takes phone screenshots of a long side at most 2 times the short one.',
            'crossbind: store/google-play/en-US/images/tenInchScreenshots has 9 10-inch tablet screenshots, and Google Play takes 8 at most.',
            'crossbind: store/google-play/en-US/images/wearScreenshots/01.png is 384 × 400, and Google Play takes Wear OS screenshots of a square, 384 pixels a side at least.',
        ]);
    });
});

describe("crossbind app store's word on Google Play", () => {
    test('names what a publish sends, what Play would refuse of it, and the steps Play Console alone takes', () => {
        write('en-US/title.txt', 'Demo');
        write('en-US/short_description.txt', 'A demo');
        write('en-US/full_description.txt', 'The demo app.');
        write('en-US/images/icon.png', pngOf(500, 500));
        write('en-US/changelogs/default.txt', 'Fixes.');
        write('contact_email.txt', 'support@example.com');
        write('privacy_url.txt', 'https://example.com/privacy');

        const guide = playGuide({ project: { root: project }, config: { app: { id: 'dev.example.demo' } } });

        expect(guide.where).toBe('Play Console');
        expect(guide.sends.map(upath.toUnix)).toEqual([
            'the bundle, signed with the upload key, with its native debug symbols, on a track',
            'store/google-play/en-US: full description, short description, title; icon; release notes',
            'contact details: e-mail support@example.com',
        ]);
        expect(guide.problems.map(upath.toUnix)).toEqual(['crossbind: store/google-play/en-US/images/icon.png is 500 × 500, and Google Play takes an icon of 512 × 512.']);
        expect(guide.steps[0]).toEqual({ text: "Create the app, with dev.example.demo as its package name, as Play's API makes none.", url: 'https://play.google.com/console' });
        const texts = guide.steps.map(({ text }) => text);
        expect(texts).toContain('Policy and programs › App content › Privacy policy: https://example.com/privacy.');
        expect(texts.map(upath.toUnix)).toContain('Policy and programs › App content › Data safety: answer it; to keep it in the project, export it to CSV as store/google-play/data_safety.csv, which later publishes then send.');
        expect(texts.some((text) => text.includes('Contact details'))).toBe(false);
    });
});
