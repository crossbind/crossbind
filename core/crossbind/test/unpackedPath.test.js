import { describe, test, expect } from 'vitest';
import unpackedPath from '../../embind-napi/js/unpackedPath.js';

describe('unpackedPath', () => {
    test('a packaged Electron app reads its data beside the asar archive', () => {
        expect(unpackedPath('/Applications/App.app/Contents/Resources/app.asar/dist/data', true))
            .toBe('/Applications/App.app/Contents/Resources/app.asar.unpacked/dist/data');
    });

    test('a Windows path maps the same way', () => {
        expect(unpackedPath('C:\\App\\resources\\app.asar\\node_modules\\pkg\\dist\\data', true))
            .toBe('C:\\App\\resources\\app.asar.unpacked\\node_modules\\pkg\\dist\\data');
    });

    test.each([
        ['outside an archive', '/home/me/app/dist/data'],
        ['already unpacked', '/opt/App/resources/app.asar.unpacked/dist/data'],
        ['in a directory whose name only starts like an archive', '/srv/app.asarx/dist/data'],
    ])('a path %s stays', (_, file) => {
        expect(unpackedPath(file, true)).toBe(file);
    });

    test('outside Electron no path changes', () => {
        const file = '/opt/App/resources/app.asar/dist/data';

        expect(unpackedPath(file, false)).toBe(file);
    });
});
