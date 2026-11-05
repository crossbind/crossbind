import { describe, expect, test } from 'vitest';
import {
    activityTypeOwners, appLinkParts, checkedActivityTypes, checkedFileTypes, checkedLinks, checkedShortcutItems, fileTypeOwners, iosDocumentTypes,
    iosShortcutItems, linkOwners, macDocumentTypes, shortcutItemOwners,
} from '../src/utils/appLaunches.js';

const config = (app = {}, extensions = []) => ({ general: { name: 'demo-app' }, app, extensions });
const kml = { name: 'KML', extensions: ['kml'], mimeTypes: ['application/vnd.google-earth.kml+xml'], role: 'viewer', contentTypes: [] };

describe("an app's file types", () => {
    test('take a name and the extensions of its files, an editor of no MIME or content type by default', () => {
        expect(checkedFileTypes([{ name: 'GeoJSON', extensions: ['geojson'] }], 'app.fileTypes'))
            .toEqual([{ name: 'GeoJSON', extensions: ['geojson'], mimeTypes: [], role: 'editor', contentTypes: [] }]);
        expect(checkedFileTypes([{ ...kml, contentTypes: ['com.google.earth.kml'] }], 'app.fileTypes')[0].contentTypes).toEqual(['com.google.earth.kml']);
    });

    test('refuse an extension with its dot or in capitals, naming what they take', () => {
        for (const extension of ['.geojson', 'GeoJSON', 'tar.gz', '']) {
            expect(() => checkedFileTypes([{ name: 'GeoJSON', extensions: [extension] }], 'app.fileTypes'))
                .toThrow("app.fileTypes[0].extensions takes lowercase letters and digits without the dot, as 'geojson' is");
        }
    });

    test('refuse a type without a name or extensions, of an unknown key or role, and a MIME type that is none', () => {
        expect(() => checkedFileTypes([{ extensions: ['geojson'] }], 'app.fileTypes')).toThrow('app.fileTypes[0] has no name');
        expect(() => checkedFileTypes([{ name: 'Geo\nJSON', extensions: ['geojson'] }], 'app.fileTypes')).toThrow('holds a control character');
        expect(() => checkedFileTypes([{ name: 'GeoJSON', extensions: [] }], 'app.fileTypes')).toThrow('app.fileTypes[0].extensions lists none');
        expect(() => checkedFileTypes([{ name: 'GeoJSON', extensions: ['geojson'], icon: 'x.png' }], 'app.fileTypes')).toThrow('icon is none of them');
        expect(() => checkedFileTypes([{ name: 'GeoJSON', extensions: ['geojson'], role: 'owner' }], 'app.fileTypes')).toThrow("role is 'editor' or 'viewer'");
        expect(() => checkedFileTypes([{ name: 'GeoJSON', extensions: ['geojson'], mimeTypes: ['geojson'] }], 'app.fileTypes')).toThrow('app.fileTypes[0].mimeTypes takes');
        expect(() => checkedFileTypes({ name: 'GeoJSON' }, 'app.fileTypes')).toThrow('is no list of file types');
    });

    test('give each extension one owner: the app, or the extension that declared it', () => {
        const app = config({ fileTypes: [{ name: 'GeoJSON', extensions: ['geojson', 'geo'] }] }, [{ name: 'maps', app: { fileTypes: [kml] } }]);
        expect(fileTypeOwners(app).map(({ extensions, extension }) => [extensions, extension])).toEqual([[['geojson', 'geo'], null], [['kml'], 'maps']]);
        expect(fileTypeOwners(config())).toEqual([]);
    });

    test('stop the build when two owners claim the files of one extension, naming both', () => {
        expect(() => fileTypeOwners(config({ fileTypes: [{ name: 'Earth', extensions: ['kml'] }] }, [{ name: 'maps', app: { fileTypes: [kml] } }])))
            .toThrow('app.fileTypes and the extension maps both claim the files .kml, which one alone opens.');
        expect(() => fileTypeOwners(config({ fileTypes: [{ name: 'A', extensions: ['kml'] }, { name: 'B', extensions: ['kml'] }] })))
            .toThrow('app.fileTypes lists the files .kml twice.');
    });
});

describe("an Apple app's document types", () => {
    const geojson = { name: 'GeoJSON', extensions: ['geojson', 'geo'], mimeTypes: ['application/geo+json'], role: 'editor', contentTypes: [] };
    const csv = { name: 'CSV', extensions: ['csv'], mimeTypes: [], role: 'viewer', contentTypes: ['public.comma-separated-values-text'] };

    test("name a macOS app's types by their extensions, unless their content types name them", () => {
        expect(macDocumentTypes([geojson, csv])).toEqual([
            { CFBundleTypeName: 'GeoJSON', CFBundleTypeRole: 'Editor', CFBundleTypeExtensions: ['geojson', 'geo'], CFBundleTypeMIMETypes: ['application/geo+json'] },
            { CFBundleTypeName: 'CSV', CFBundleTypeRole: 'Viewer', LSItemContentTypes: ['public.comma-separated-values-text'] },
        ]);
    });

    test("declare an iOS app's own identifier for a type Apple has none of, which it opens where it is", () => {
        expect(iosDocumentTypes([geojson, csv], '$(PRODUCT_BUNDLE_IDENTIFIER)')).toEqual({
            CFBundleDocumentTypes: [
                { CFBundleTypeName: 'GeoJSON', CFBundleTypeRole: 'Editor', LSItemContentTypes: ['$(PRODUCT_BUNDLE_IDENTIFIER).geojson'] },
                { CFBundleTypeName: 'CSV', CFBundleTypeRole: 'Viewer', LSItemContentTypes: ['public.comma-separated-values-text'] },
            ],
            UTImportedTypeDeclarations: [{
                UTTypeIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER).geojson',
                UTTypeDescription: 'GeoJSON',
                UTTypeConformsTo: ['public.data'],
                UTTypeTagSpecification: { 'public.filename-extension': ['geojson', 'geo'], 'public.mime-type': ['application/geo+json'] },
            }],
            LSSupportsOpeningDocumentsInPlace: true,
        });
        expect(iosDocumentTypes([], '$(PRODUCT_BUNDLE_IDENTIFIER)')).toEqual({});
    });

    test("make an iOS app's own identifier of an extension's letters, digits and hyphens alone", () => {
        const source = { name: 'C++', extensions: ['c++'], mimeTypes: [], role: 'editor', contentTypes: [] };
        expect(iosDocumentTypes([source], 'dev.example.app').UTImportedTypeDeclarations[0].UTTypeIdentifier).toBe('dev.example.app.c--');
    });
});

describe("an app's https links", () => {
    test("take a site's domain, maybe with *. for its subdomains, then maybe the path its links start with", () => {
        expect(checkedLinks(['example.com', '*.example.org', 'example.com/invite', 'example.xn--p1ai'], 'app.links'))
            .toEqual(['example.com', '*.example.org', 'example.com/invite', 'example.xn--p1ai']);
        expect(appLinkParts('example.com/invite')).toEqual({ host: 'example.com', path: '/invite' });
        expect(appLinkParts('*.example.org')).toEqual({ host: '*.example.org', path: '' });
    });

    test('refuse a link with its scheme, naming the fix', () => {
        expect(() => checkedLinks(['https://example.com/invite'], 'app.links')).toThrow('without its https://');
    });

    test('refuse capitals, a query, a fragment, an escape, a bare word and a list that is none', () => {
        for (const link of ['Example.com', 'example.com/a?b=1', 'example.com/#top', 'example.com/a%20b', 'example.com/a"b', 'example.com/a\\b', 'localhost', 'example', 42]) {
            expect(() => checkedLinks([link], 'app.links')).toThrow(`app.links takes a site's domain`);
        }
        expect(() => checkedLinks('example.com', 'app.links')).toThrow('is no list of links');
        expect(() => checkedLinks(['example.com', 'example.com'], 'app.links')).toThrow('app.links lists example.com twice');
    });

    test('give each link one owner, and stop the build when two claim one, naming both', () => {
        const app = config({ links: ['example.com'] }, [{ name: 'invites', app: { links: ['example.com/invite'] } }]);
        expect(linkOwners(app)).toEqual([{ link: 'example.com', extension: null }, { link: 'example.com/invite', extension: 'invites' }]);
        expect(() => linkOwners(config({ links: ['example.com/invite'] }, [{ name: 'invites', app: { links: ['example.com/invite'] } }])))
            .toThrow('app.links and the extension invites both claim the links of example.com/invite, which one alone gets.');
    });
});

describe("an Apple app's user activities", () => {
    test("take the types of the activities it continues, reverse-DNS names and intents' classes alike", () => {
        expect(checkedActivityTypes(['com.example.app.edit', 'INSendMessageIntent', 'com.example.app.view_item-2'], 'app.activityTypes'))
            .toEqual(['com.example.app.edit', 'INSendMessageIntent', 'com.example.app.view_item-2']);
    });

    test("refuse a web page's type, which app.links takes, a type of other characters, a type twice and a list that is none", () => {
        expect(() => checkedActivityTypes(['NSUserActivityTypeBrowsingWeb'], 'app.activityTypes')).toThrow("a web page's, which app.links takes by its site");
        for (const type of ['', '.com.example', 'com.example app', 'com.example."edit"', 'com.example\\edit', 42]) {
            expect(() => checkedActivityTypes([type], 'app.activityTypes')).toThrow('app.activityTypes takes user activity types');
        }
        expect(() => checkedActivityTypes('com.example.app.edit', 'app.activityTypes')).toThrow('is no list of user activity types');
        expect(() => checkedActivityTypes(['com.example.app.edit', 'com.example.app.edit'], 'app.activityTypes')).toThrow('app.activityTypes lists com.example.app.edit twice');
    });

    test('give each type one owner, and stop the build when two claim one, naming both', () => {
        const app = config({ activityTypes: ['com.example.app.edit'] }, [{ name: 'notes', app: { activityTypes: ['com.example.notes.open'] } }]);
        expect(activityTypeOwners(app)).toEqual([{ type: 'com.example.app.edit', extension: null }, { type: 'com.example.notes.open', extension: 'notes' }]);
        expect(activityTypeOwners(config())).toEqual([]);
        expect(() => activityTypeOwners(config({ activityTypes: ['com.example.notes.open'] }, [{ name: 'notes', app: { activityTypes: ['com.example.notes.open'] } }])))
            .toThrow('app.activityTypes and the extension notes both claim the user activities com.example.notes.open, which one alone continues.');
    });
});

describe("a phone app's quick actions", () => {
    const newNote = { type: 'com.example.app.new-note', title: 'New note' };

    test('take a type and a title, and an iOS subtitle and icon of its own', () => {
        expect(checkedShortcutItems([newNote, { type: 'search', title: 'Search', subtitle: 'Find a note', icon: 'search' }], 'app.shortcutItems')).toEqual([
            { ...newNote, subtitle: null, icon: null }, { type: 'search', title: 'Search', subtitle: 'Find a note', icon: 'search' },
        ]);
    });

    test('refuse an item that is none, of an unknown key, type or icon, without a title, of two lines, and a type twice', () => {
        expect(() => checkedShortcutItems(newNote, 'app.shortcutItems')).toThrow("crossbind: app.shortcutItems {\"type\":\"com.example.app.new-note\",\"title\":\"New note\"} is no list of quick actions, as [{ type: 'new-note', title: 'New note' }] is.");
        expect(() => checkedShortcutItems(['new-note'], 'app.shortcutItems')).toThrow("crossbind: app.shortcutItems[0] is no quick action, as { type: 'new-note', title: 'New note' } is.");
        expect(() => checkedShortcutItems([{ ...newNote, url: 'x' }], 'app.shortcutItems')).toThrow('crossbind: app.shortcutItems[0] takes type, title, subtitle, icon; url is none of them.');
        for (const type of ['', 'new note', '.new', 'new"note', 42]) {
            expect(() => checkedShortcutItems([{ ...newNote, type }], 'app.shortcutItems')).toThrow("crossbind: app.shortcutItems[0].type takes letters, digits, ., _ and -, as 'new-note' does;");
        }
        expect(() => checkedShortcutItems([{ type: 'new-note' }], 'app.shortcutItems')).toThrow('crossbind: app.shortcutItems[0].title is no text, which the system shows.');
        expect(() => checkedShortcutItems([{ ...newNote, subtitle: 'a\nb' }], 'app.shortcutItems')).toThrow('crossbind: app.shortcutItems[0].subtitle "a\\nb" holds a control character, as a line break; give it on one line.');
        expect(() => checkedShortcutItems([{ ...newNote, icon: 'pencil' }], 'app.shortcutItems')).toThrow("crossbind: app.shortcutItems[0].icon is one of iOS's own icons, add, alarm,");
        expect(() => checkedShortcutItems([newNote, newNote], 'app.shortcutItems')).toThrow('crossbind: app.shortcutItems lists the quick action com.example.app.new-note twice.');
    });

    test('give each type one owner, and stop the build when two claim one, naming both', () => {
        const app = config({ shortcutItems: [newNote] }, [{ name: 'scanner', app: { shortcutItems: [{ type: 'scan', title: 'Scan', subtitle: null, icon: null }] } }]);
        expect(shortcutItemOwners(app).map(({ type, extension }) => [type, extension])).toEqual([['com.example.app.new-note', null], ['scan', 'scanner']]);
        expect(shortcutItemOwners(config())).toEqual([]);
        expect(() => shortcutItemOwners(config({ shortcutItems: [{ type: 'scan', title: 'Scan' }] }, [{ name: 'scanner', app: { shortcutItems: [{ type: 'scan', title: 'Scan' }] } }])))
            .toThrow('crossbind: app.shortcutItems and the extension scanner both claim the quick action scan, whose taps one alone gets.');
    });

    test("are an iOS app's Info.plist items, an icon by UIApplicationShortcutIconType's name", () => {
        expect(iosShortcutItems([{ ...newNote, subtitle: null, icon: null }, { type: 'search', title: 'Search', subtitle: 'Find a note', icon: 'markLocation' }])).toEqual([
            { UIApplicationShortcutItemType: 'com.example.app.new-note', UIApplicationShortcutItemTitle: 'New note' },
            {
                UIApplicationShortcutItemType: 'search', UIApplicationShortcutItemTitle: 'Search', UIApplicationShortcutItemSubtitle: 'Find a note',
                UIApplicationShortcutItemIconType: 'UIApplicationShortcutIconTypeMarkLocation',
            },
        ]);
    });
});
