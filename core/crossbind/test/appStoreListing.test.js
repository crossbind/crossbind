import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readAppStoreListing } from '../src/actions/appStoreListing.js';

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
