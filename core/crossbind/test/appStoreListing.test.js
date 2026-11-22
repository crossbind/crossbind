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
    test.each([
        ['en-US/name.txt', readAppStoreListing],
        ['en-US/creative-assets/header.id', readAppStoreListing],
        ['copyright.txt', readAppStoreSettings],
        ['age_rating.json', readAppStoreSettings],
        ['review_information/email_address.txt', readAppStoreSettings]
    ])('rejects the retired %s file even without JSON', (file, read) => {
        write(file, 'unused');
        expect(() => read(project)).toThrow(file.split('/').at(-1));
    });

    test('reads store and locale JSON, preserving an explicit false and applying version overrides per platform', () => {
        const id = '6e4f57c4-447c-464f-9525-ca3856ea8afc';
        write('store.json', JSON.stringify({
            primaryCategory: 'UTILITIES', ageRating: { advertising: false },
            review: { signInRequired: false }, platforms: { ios: { copyright: '2026 Demo' }, macos: { review: { signInRequired: true } } },
        }));
        write('review_information/private.json', JSON.stringify({ contactEmail: 'review@example.com' }));
        write('en-US/listing.json', JSON.stringify({ name: 'Demo', subtitle: '', keywords: ['convert', 'maps'], creativeAssets: { header: { assetId: id } } }));
        write('en-US/description.txt', 'Multi-line\ndescription.');
        const ios = readAppStoreSettings(project, 'ios');
        const mac = readAppStoreSettings(project, 'macos');
        expect(ios).toEqual({ copyright: '2026 Demo', categories: { primaryCategory: 'UTILITIES' }, ageRating: { advertising: false }, review: { contactEmail: 'review@example.com', demoAccountRequired: false } });
        expect(mac.copyright).toBeUndefined();
        expect(mac.review.demoAccountRequired).toBe(true);
        expect(readAppStoreListing(project)[0]).toMatchObject({ info: { name: 'Demo', subtitle: '' }, version: { keywords: 'convert,maps', description: 'Multi-line\ndescription.' }, creativeAssets: { header: { id } } });
        write('store.json', '{}');
        expect(readAppStoreSettings(project).review).not.toHaveProperty('demoAccountRequired');
    });

    test('rejects conflicts, unknown fields and invalid JSON types before sending', () => {
        write('store.json', JSON.stringify({ review: { signInRequired: 'false' } }));
        expect(() => readAppStoreSettings(project)).toThrow('signInRequired must be true or false');
        write('store.json', JSON.stringify({ review: { signInRequired: false } }));
        write('review_information/private.json', JSON.stringify({ demoAccountName: 'demo', demoAccountPassword: 'secret' }));
        expect(() => readAppStoreSettings(project)).toThrow('supplies demo credentials');
        write('store.json', JSON.stringify({ platforms: { ios: { primaryCategory: 'GAMES' } } }));
        expect(() => readAppStoreSettings(project)).toThrow('unknown field primaryCategory');
        write('en-US/listing.json', JSON.stringify({ keywords: 'demo' }));
        expect(() => readAppStoreListing(project)).toThrow('array');
        write('en-US/listing.json', JSON.stringify({ name: 'Demo' }));
        write('en-US/name.txt', 'Demo');
        expect(() => readAppStoreListing(project)).toThrow(/name.txt is none/);
    });

    test('previews shared and localized creative artwork and only includes it for iOS', () => {
        write('en-US/creative-assets/universal.png', pngOf(5244, 2950));
        write('en-US/creative-assets/search-results.jpg', jpegOf(3000, 2000));
        write('tr/listing.json', JSON.stringify({ keywords: ['harita'], creativeAssets: { header: { assetId: '6E4F57C4-447C-464F-9525-CA3856EA8AFC' } } }));
        const listings = readAppStoreListing(project);
        expect(listings[1].creativeAssets.header.id).toBe('6e4f57c4-447c-464f-9525-ca3856ea8afc');
        expect(appStoreListingProblems(project, listingOf(listings, 'IOS'))).toEqual([]);
        expect(listingOf(listings, 'MAC_OS')).toEqual([{ locale: 'tr', info: {}, version: { keywords: 'harita' }, screenshots: {} }]);
        const guide = appStoreGuide({ project: { root: project }, config: { app: {} }, app: { category: { macos: 'public.app-category.utilities' } } });
        expect(guide.sends.map(upath.toUnix)).toContain('store/app-store/en-US: search-results creative asset, universal creative asset');
    });

    test.each([
        ['header.png', pngOf(3840, 1646), null],
        ['search-results.png', pngOf(3840, 2560), null],
        ['search-results.jpg', jpegOf(1920, 1280), null],
        ['search-results.png', pngOf(5244, 2950), null],
        ['header.png', pngOf(3840, 1646, { isTransparent: true }), 'transparency'],
        ['universal.png', pngOf(5244, 2950, { colorType: RGBA }), 'transparency'],
        ['header.jpg', jpegOf(3840, 1646), 'PNG'],
        ['universal.png', pngOf(3840, 1646), '5244 × 2950'],
        ['search-results.jpg', jpegOf(1920, 1300), '3:2'],
        ['search-results.jpg', jpegOf(3843, 2562), '3:2'],
        ['search-results.jpg', pngOf(1920, 1280), 'matching its filename'],
        ['header.png', 'version https://git-lfs.github.com/spec/v1', 'matching its filename'],
    ])('checks %s against its placement specification', (name, image, error) => {
        write(`en-US/creative-assets/${name}`, image);
        const problems = appStoreListingProblems(project, readAppStoreListing(project));
        if (error) expect(problems).toEqual([expect.stringContaining(error)]);
        else expect(problems).toEqual([]);
    });

    test('identifies invalid IDs and competing sources for one placement', () => {
        write('tr/listing.json', JSON.stringify({ creativeAssets: { header: { assetId: 'bad id' } } }));
        expect(() => readAppStoreListing(project)).toThrow(/header.assetId.*UUID/);
        write('tr/listing.json', JSON.stringify({ creativeAssets: { header: { assetId: '6e4f57c4-447c-464f-9525-ca3856ea8afc' } } }));
        write('tr/creative-assets/header.png', pngOf(3840, 1646));
        expect(() => readAppStoreListing(project)).toThrow('two files for header');
    });

    test('is none without its folder', () => {
        expect(readAppStoreListing(project)).toEqual([]);
    });

    test("is each locale's texts of the app's information and of its version", () => {
        write('en-US/listing.json', JSON.stringify({
            name: 'Demo\n',
            subtitle: '',
            privacyPolicyUrl: 'https://example.com/privacy',
            keywords: ['demo', 'example'],
            promotionalText: 'Now faster.',
            supportUrl: 'https://example.com/support',
            marketingUrl: 'https://example.com',
        }));
        write('en-US/description.txt', 'Line one\r\nLine two\n');
        write('en-US/release_notes.txt', 'Fixes.');
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
        write('en-US/listing.json', JSON.stringify({ keywords: ['k'.repeat(101)] }));
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-US/listing.json.keywords')} has 101 characters, and App Store Connect takes 100 at most.`);
        write('en-US/listing.json', JSON.stringify({ keywords: ['demo'], promotionalText: 'p'.repeat(171) }));
        expect(() => readAppStoreListing(project)).toThrow(`${shown('en-US/listing.json.promotionalText')} has 171 characters, and App Store Connect takes 170 at most.`);
        write('en-US/listing.json', JSON.stringify({ promotionalText: '' }));
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
        write('en-us/listing.json', JSON.stringify({ name: 'Demo' }));
        expect(() => readAppStoreListing(project)).toThrow(`crossbind: ${shown('en-us')} is no language's folder, as en-US is, which an App Store listing takes.`);
    });
});

describe("a project's App Store settings", () => {
    test('are the copyright, categories, age rating answers and App Review contact a release sends', () => {
        write('store.json', JSON.stringify({
            copyright: '2026 Example Ltd.\n', primaryCategory: 'UTILITIES', secondaryCategory: 'PRODUCTIVITY',
            ageRating: { violenceCartoonOrFantasy: 'NONE', gambling: false, kidsAgeBand: null, aQuestionAppleAdds: true },
        }));
        write('review_information/private.json', JSON.stringify({ contactFirstName: 'Ada', contactEmail: 'review@example.com' }));
        write('review_information/notes.txt', 'No sign-in.');
        write('en-US/listing.json', JSON.stringify({ name: 'Demo' }));
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
        write('review_information/private.json', JSON.stringify({ demoAccountName: 'demo' }));
        expect(() => readAppStoreSettings(project)).toThrow('must supply demoAccountName and demoAccountPassword together.');
        write('review_information/private.json', JSON.stringify({ demoAccountName: 'demo', demoAccountPassword: 'secret' }));
        expect(readAppStoreSettings(project).review).toEqual({ demoAccountName: 'demo', demoAccountPassword: 'secret', demoAccountRequired: true });
    });

    test("stop at answers App Store Connect takes none of, and at a category's id it names none by", () => {
        write('store.json', JSON.stringify({ ageRating: { violenceRealistic: 'SOMETIMES' } }));
        expect(() => readAppStoreSettings(project)).toThrow('answers violenceRealistic with "SOMETIMES", which App Store Connect takes none of: it takes "NONE", "INFREQUENT_OR_MILD", "FREQUENT_OR_INTENSE", "INFREQUENT", "FREQUENT".');
        write('store.json', JSON.stringify({ ageRating: { gambling: 'no' } }));
        expect(() => readAppStoreSettings(project)).toThrow('answers gambling with "no", which App Store Connect takes none of: it takes true, false.');
        write('store.json', JSON.stringify({ ageRating: { aQuestionAppleAdds: 'maybe' } }));
        expect(() => readAppStoreSettings(project)).toThrow('answers aQuestionAppleAdds with "maybe", which App Store Connect takes none of.');
        write('store.json', JSON.stringify({ ageRating: [] }));
        expect(() => readAppStoreSettings(project)).toThrow("holds no object of App Store Connect's age rating answers");
        write('store.json', '{');
        expect(() => readAppStoreSettings(project)).toThrow('cannot read JSON');
        write('store.json', JSON.stringify({ primaryCategory: 'Utilities' }));
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
        write('en-US/listing.json', JSON.stringify({ name: 'Demo' }));
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
        write('en-US/listing.json', JSON.stringify({ name: 'Demo', privacyPolicyUrl: 'https://example.com/privacy' }));
        write('en-US/screenshots/APP_IPHONE_67/01.png', pngOf(1320, 2868));
        write('store.json', JSON.stringify({ copyright: '2026 Example Ltd.', primaryCategory: 'UTILITIES' }));

        const guide = appStoreGuide({ project: { root: project }, config: { app: { id: 'dev.example.demo' } }, app: { encryption: false, category: { macos: 'public.app-category.utilities' } } });

        expect(guide.where).toBe('App Store Connect');
        expect(guide.problems).toEqual([]);
        expect(guide.uploads).toEqual([
            'the iOS app, archived and uploaded, which TestFlight hands to testers once Apple has processed it; -p ios sends it alone',
            'then the macOS app, sandboxed, in an archive Xcode exports to App Store Connect, which signs it and its installer package in the cloud, and whose TestFlight hands it to Mac testers once Apple has processed it; -p macos sends it alone',
        ]);
        expect(guide.releases).toEqual([
            "the newest build of the version TestFlight's testers have, to App Review, which puts it out once approved, in phases over 7 days with --rollout",
            'with it, the page --send sends',
        ]);
        expect(guide.sends.map(upath.toUnix)).toEqual([
            'store/app-store/en-US: name, privacy policy URL; 1 APP_IPHONE_67 screenshots',
            'copyright: 2026 Example Ltd.',
            'categories: UTILITIES',
        ]);
        const texts = guide.steps.map(({ text }) => text);
        expect(texts[0]).toBe("Apps › New App: an app with dev.example.demo as its bundle ID, on iOS and macOS, as an upload without -p sends both, with its name, primary language and SKU, as Apple's API makes none; an upload registers the bundle ID first, so the form lists it. An app on iOS alone takes macOS later with the + beside its platform in the sidebar, as a universal purchase, which stays one once both platforms are approved, and uploads with -p ios until then.");
        expect(texts.map(upath.toUnix)).toEqual(expect.arrayContaining([
            "App Information › Age Rating: answer Apple's questions, which store/app-store/store.json.ageRating would send.",
            "The version's App Review Information: a contact's name, phone and e-mail, which store/app-store/review_information/private.json would send.",
            "The version's 13-inch iPad screenshots, which App Store Connect takes of an app that runs on iPads, as crossbind's iOS apps do; a locale's screenshots/APP_IPAD_PRO_3GEN_129 would send them.",
        ]));
        expect(texts.some((text) => ['Privacy Policy URL', '› Category', 'Copyright', 'app.encryption'].some((part) => text.includes(part)))).toBe(false);
    });
});
