import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import upath from 'upath';
import {
    appStoreListingProblems, listingOf, readAppStoreListing, readAppStoreSettings,
} from '../../store-kit/app-store/appStoreListing.js';
import { appStoreGuide } from '../../../extensions/app-store/src/appStoreGuide.js';
import { RGBA, jpegOf, pngOf } from './listingImages.js';

let project;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Writes a file of the project's listing, under store/app-store: a PNG's first bytes for an image unless given others.
const write = (file, text = /\.(png|jpe?g)$/i.test(file) ? PNG : '') => {
    const full = path.join(project, 'store', 'app-store', ...file.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
};
const shown = (file) => path.join('store', 'app-store', ...file.split('/'));

beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-app-store-listing-'));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe("a project's App Store listing", () => {
    test('is none without its folder', () => {
        expect(readAppStoreListing(project)).toEqual([]);
    });

    test("is each locale's texts of the app's information and of its version, by the names fastlane's deliver gives their files", () => {
        write('en-US/name.txt', 'Demo\n');
        write('en-US/subtitle.txt', '');
        write('en-US/privacy_url.txt', 'https://example.com/privacy');
        write('en-US/description.txt', 'Line one\r\nLine two\n');
        write('en-US/keywords.txt', 'demo,example');
        write('en-US/release_notes.txt', 'Fixes.');
        write('en-US/promotional_text.txt', 'Now faster.');
        write('en-US/support_url.txt', 'https://example.com/support');
        write('en-US/marketing_url.txt', 'https://example.com');
        write('tr/release_notes.txt', 'Düzeltmeler.');
        write('zh-Hans/release_notes.txt', '修复。');
        write('en-US/.DS_Store');

        expect(readAppStoreListing(project)).toEqual([
            {
                locale: 'en-US',
                info: { name: 'Demo', subtitle: '', privacyPolicyUrl: 'https://example.com/privacy' },
                version: {
                    description: 'Line one\nLine two', keywords: 'demo,example', whatsNew: 'Fixes.', promotionalText: 'Now faster.', supportUrl: 'https://example.com/support', marketingUrl: 'https://example.com',
                },
                screenshots: {},
            },
            { locale: 'tr', info: {}, version: { whatsNew: 'Düzeltmeler.' }, screenshots: {} },
            { locale: 'zh-Hans', info: {}, version: { whatsNew: '修复。' }, screenshots: {} },
        ]);
    });

    test('stops at a text longer than App Store Connect takes, or empty where Apple takes none empty', () => {
        write('en-US/keywords.txt', 'k'.repeat(101));
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-US/keywords.txt')} has 101 characters, and App Store Connect takes 100 at most.`);
        write('en-US/keywords.txt', 'demo');
        write('en-US/promotional_text.txt', 'p'.repeat(171));
        expect(() => readAppStoreListing(project)).toThrow(`${shown('en-US/promotional_text.txt')} has 171 characters, and App Store Connect takes 170 at most.`);
        write('en-US/promotional_text.txt', '');
        write('en-US/release_notes.txt', '\n');
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-US/release_notes.txt')} is empty: write its text, or remove the file.`);
    });

    test("is each locale's screenshots by display type, in the order of their names, without a type's empty folder", () => {
        write('en-US/screenshots/APP_IPHONE_67/02.png');
        write('en-US/screenshots/APP_IPHONE_67/01.jpg');
        write('en-US/screenshots/APP_IPAD_PRO_3GEN_129/01.PNG');
        write('en-US/screenshots/APP_IPHONE_67/Thumbs.db');
        fs.mkdirSync(path.join(project, 'store', 'app-store', 'en-US', 'screenshots', 'APP_IPHONE_65'));
        const folder = path.join(project, 'store', 'app-store', 'en-US', 'screenshots');
        expect(readAppStoreListing(project)).toEqual([{
            locale: 'en-US',
            info: {},
            version: {},
            screenshots: {
                APP_IPAD_PRO_3GEN_129: [path.join(folder, 'APP_IPAD_PRO_3GEN_129', '01.PNG')],
                APP_IPHONE_67: [path.join(folder, 'APP_IPHONE_67', '01.jpg'), path.join(folder, 'APP_IPHONE_67', '02.png')],
            },
        }]);
    });

    test('stops at a display type App Store Connect names none, a file no screenshot, or more screenshots than it takes', () => {
        write('en-US/screenshots/APP_IPHONE_69/01.png');
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-US/screenshots/APP_IPHONE_69')} is none of the files an App Store listing takes`);
        fs.rmSync(path.join(project, 'store'), { recursive: true });
        write('en-US/screenshots/APP_IPHONE_67/01.gif');
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-US/screenshots/APP_IPHONE_67/01.gif')} is none of the files an App Store listing takes`);
        fs.rmSync(path.join(project, 'store'), { recursive: true });
        Array.from({ length: 11 }, (_, index) => write(`en-US/screenshots/APP_IPHONE_67/${String(index + 1).padStart(2, '0')}.png`));
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-US/screenshots/APP_IPHONE_67')} has 11 screenshots, and App Store Connect takes 10 at most.`);
    });

    test('stops at a screenshot whose file holds no image, as an empty one or a Git LFS pointer, before the build', () => {
        write('en-US/screenshots/APP_IPHONE_67/01.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
        write('en-US/screenshots/APP_IPHONE_67/02.png', '');
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-US/screenshots/APP_IPHONE_67/02.png')} holds no PNG or JPEG image, as an empty file or a Git LFS pointer does: put the image there, or remove the file.`);
        write('en-US/screenshots/APP_IPHONE_67/02.png', 'version https://git-lfs.github.com/spec/v1\noid sha256:0000\nsize 1\n');
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-US/screenshots/APP_IPHONE_67/02.png')} holds no PNG or JPEG image`);
    });

    test("stops at a file it takes none of, and at what is no locale's folder", () => {
        write('en-US/copyright.txt', '2026 Demo');
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-US/copyright.txt')} is none of the files an App Store listing takes; app.md's Publishing names them.`);
        fs.rmSync(path.join(project, 'store'), { recursive: true });
        write('en-us/name.txt', 'Demo');
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-us')} is no language's folder, as en-US is, which an App Store listing takes.`);
    });
});

describe("a project's App Store settings", () => {
    test('are the copyright, categories, age rating answers and App Review contact an upload with --submit sends', () => {
        write('copyright.txt', '2026 Example Ltd.\n');
        write('primary_category.txt', 'UTILITIES');
        write('secondary_category.txt', 'PRODUCTIVITY');
        write('age_rating.json', JSON.stringify({
            violenceCartoonOrFantasy: 'NONE', gambling: false, kidsAgeBand: null, aQuestionAppleAdds: true,
        }));
        write('review_information/first_name.txt', 'Ada');
        write('review_information/email_address.txt', 'review@example.com');
        write('review_information/notes.txt', 'No sign-in.');
        write('en-US/name.txt', 'Demo');
        expect(readAppStoreSettings(project)).toEqual({
            copyright: '2026 Example Ltd.',
            categories: { primaryCategory: 'UTILITIES', secondaryCategory: 'PRODUCTIVITY' },
            ageRating: {
                violenceCartoonOrFantasy: 'NONE', gambling: false, kidsAgeBand: null, aQuestionAppleAdds: true,
            },
            review: { contactEmail: 'review@example.com', contactFirstName: 'Ada', notes: 'No sign-in.' },
        });
        expect(readAppStoreListing(project).map(({ locale }) => locale)).toEqual(['en-US']);
    });

    test('are none without their files', () => {
        expect(readAppStoreSettings(project)).toEqual({ categories: {}, review: {} });
    });

    test("take a demo account's name and password together, which App Review signs in with", () => {
        write('review_information/demo_user.txt', 'demo');
        expect(() => readAppStoreSettings(project)).toThrow('has one of demo_user.txt and demo_password.txt, and App Review signs in with both: add the other, or remove it.');
        write('review_information/demo_password.txt', 'secret');
        expect(readAppStoreSettings(project).review).toEqual({ demoAccountName: 'demo', demoAccountPassword: 'secret', demoAccountRequired: true });
    });

    test("stop at answers App Store Connect takes none of, and at a category's id it names none by", () => {
        write('age_rating.json', JSON.stringify({ violenceRealistic: 'SOMETIMES' }));
        expect(() => readAppStoreSettings(project)).toThrow('answers violenceRealistic with "SOMETIMES", which App Store Connect takes none of: it takes "NONE", "INFREQUENT_OR_MILD", "FREQUENT_OR_INTENSE", "INFREQUENT", "FREQUENT".');
        write('age_rating.json', JSON.stringify({ gambling: 'no' }));
        expect(() => readAppStoreSettings(project)).toThrow('answers gambling with "no", which App Store Connect takes none of: it takes true, false.');
        write('age_rating.json', JSON.stringify({ aQuestionAppleAdds: 'maybe' }));
        expect(() => readAppStoreSettings(project)).toThrow('answers aQuestionAppleAdds with "maybe", which App Store Connect takes none of.');
        write('age_rating.json', '[]');
        expect(() => readAppStoreSettings(project)).toThrow("holds no object of App Store Connect's age rating answers");
        write('age_rating.json', '{');
        expect(() => readAppStoreSettings(project)).toThrow('holds no JSON');
        write('age_rating.json', '{}');
        write('primary_category.txt', 'Utilities');
        expect(() => readAppStoreSettings(project)).toThrow('names "Utilities", which is no category\'s id as App Store Connect\'s API names it, as UTILITIES or PRODUCTIVITY.');
    });
});

describe("what App Store Connect would refuse of a listing's screenshots", () => {
    const problemsOf = () => appStoreListingProblems(project, readAppStoreListing(project)).map(upath.toUnix);

    test('is nothing of the sizes their display types take, portrait or turned', () => {
        write('en-US/screenshots/APP_IPHONE_67/01.png', pngOf(1320, 2868));
        write('en-US/screenshots/APP_IPHONE_67/02.jpg', jpegOf(2868, 1320));
        write('en-US/screenshots/APP_IPHONE_61/01.png', pngOf(1206, 2622));
        write('en-US/screenshots/APP_IPAD_PRO_3GEN_129/01.png', pngOf(2064, 2752));
        write('en-US/screenshots/APP_IPAD_PRO_3GEN_129/02.png', pngOf(2732, 2048));
        expect(problemsOf()).toEqual([]);
    });

    test('is every screenshot of a size its type takes none of, with transparency, or cut off, at once', () => {
        write('en-US/screenshots/APP_IPHONE_67/01.png', pngOf(1080, 1920));
        write('en-US/screenshots/APP_IPAD_PRO_3GEN_129/01.png', pngOf(2064, 2752, { colorType: RGBA }));
        write('en-US/screenshots/APP_IPAD_PRO_3GEN_129/02.png');
        expect(problemsOf()).toEqual([
            'crossbind: store/app-store/en-US/screenshots/APP_IPAD_PRO_3GEN_129/01.png holds transparency, which App Store Connect takes in no screenshot: save it as a JPEG, or as a PNG without an alpha channel.',
            'crossbind: store/app-store/en-US/screenshots/APP_IPAD_PRO_3GEN_129/02.png holds no PNG or JPEG image whose size it gives, as a cut-off file does: put the whole image there, or remove the file.',
            'crossbind: store/app-store/en-US/screenshots/APP_IPHONE_67/01.png is 1080 × 1920, and App Store Connect takes APP_IPHONE_67 screenshots of 1320 × 2868, 1290 × 2796, 1260 × 2736, 1284 × 2778, or the same turned.',
        ]);
    });

    test("is a Mac app's screenshot of other than its 16:10 sizes, which it takes unturned", () => {
        write('en-US/screenshots/APP_DESKTOP/01.png', pngOf(2560, 1600));
        write('en-US/screenshots/APP_DESKTOP/02.png', pngOf(1440, 900));
        write('en-US/screenshots/APP_DESKTOP/03.png', pngOf(1600, 2560));
        write('en-US/screenshots/APP_DESKTOP/04.png', pngOf(1920, 1080));
        expect(problemsOf()).toEqual([
            'crossbind: store/app-store/en-US/screenshots/APP_DESKTOP/03.png is 1600 × 2560, and App Store Connect takes APP_DESKTOP screenshots of 1280 × 800, 1440 × 900, 2560 × 1600, 2880 × 1800.',
            'crossbind: store/app-store/en-US/screenshots/APP_DESKTOP/04.png is 1920 × 1080, and App Store Connect takes APP_DESKTOP screenshots of 1280 × 800, 1440 × 900, 2560 × 1600, 2880 × 1800.',
        ]);
    });
});

describe("a platform's version of the App Store listing", () => {
    test("takes the Mac's screenshots for macOS, and every other type's for iOS", () => {
        write('en-US/name.txt', 'Demo');
        write('en-US/screenshots/APP_IPHONE_67/01.png', pngOf(1320, 2868));
        write('en-US/screenshots/APP_DESKTOP/01.png', pngOf(2560, 1600));
        const listings = readAppStoreListing(project);
        expect(Object.keys(listingOf(listings, 'IOS')[0].screenshots)).toEqual(['APP_IPHONE_67']);
        expect(Object.keys(listingOf(listings, 'MAC_OS')[0].screenshots)).toEqual(['APP_DESKTOP']);
        expect(listingOf(listings, 'MAC_OS')[0].info).toEqual({ name: 'Demo' });
    });
});

describe("crossbind app store's word on App Store Connect", () => {
    test('names what an upload sends, what --send sends, and the steps App Store Connect alone takes', () => {
        write('en-US/name.txt', 'Demo');
        write('en-US/privacy_url.txt', 'https://example.com/privacy');
        write('en-US/screenshots/APP_IPHONE_67/01.png', pngOf(1320, 2868));
        write('copyright.txt', '2026 Example Ltd.');
        write('primary_category.txt', 'UTILITIES');

        const guide = appStoreGuide({ project: { root: project }, config: { app: { id: 'dev.example.demo' } }, app: { encryption: false, category: { macos: 'public.app-category.utilities' } } });

        expect(guide.where).toBe('App Store Connect');
        expect(guide.problems).toEqual([]);
        expect(guide.publishes).toEqual([
            'the iOS app, archived and uploaded, which TestFlight hands to testers once Apple has processed it; -p ios sends it alone',
            'then the macOS app, sandboxed, in an archive Xcode exports to App Store Connect, which signs it and its installer package in the cloud, and whose TestFlight hands it to Mac testers once Apple has processed it; -p macos sends it alone',
            'with --submit, the page --send sends too, and the version to App Review',
        ]);
        expect(guide.sends.map(upath.toUnix)).toEqual([
            'store/app-store/en-US: name, privacy policy URL; 1 APP_IPHONE_67 screenshots',
            'copyright: 2026 Example Ltd.',
            'categories: UTILITIES',
        ]);
        const texts = guide.steps.map(({ text }) => text);
        expect(texts[0]).toBe("Apps › New App: an app with dev.example.demo as its bundle ID, on iOS and macOS, as an upload without -p sends both, with its name, primary language and SKU, as Apple's API makes none; an upload without --submit registers the bundle ID first, so the form lists it. An app on iOS alone takes macOS later with the + beside its platform in the sidebar, as a universal purchase, which stays one once both platforms are approved, and uploads with -p ios until then.");
        expect(texts.map(upath.toUnix)).toEqual(expect.arrayContaining([
            "App Information › Age Rating: answer Apple's questions, which store/app-store/age_rating.json would send.",
            "The version's App Review Information: a contact's name, phone and e-mail, which store/app-store/review_information would send.",
            "The version's 13-inch iPad screenshots, which App Store Connect takes of an app that runs on iPads, as crossbind's iOS apps do; a locale's screenshots/APP_IPAD_PRO_3GEN_129 would send them.",
        ]));
        expect(texts.some((text) => ['Privacy Policy URL', '› Category', 'Copyright', 'app.encryption'].some((part) => text.includes(part)))).toBe(false);
    });
});
