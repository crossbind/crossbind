import { describe, expect, test } from 'vitest';
import {
    appLinkParts, checkedFileTypes, checkedLinks, fileTypeOwners, iosDocumentTypes, linkOwners, macDocumentTypes,
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
