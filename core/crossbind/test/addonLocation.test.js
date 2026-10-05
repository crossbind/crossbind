import { describe, test, expect } from 'vitest';
import path from 'node:path';
import addonLocation from '../../embind-napi/js/addonLocation.js';

const dir = '/app/node_modules/@crossbind/port-zlib-standalone-napi/dist';
const fileName = 'zlib-node.linux-x64.node';
const packageName = '@crossbind/port-zlib-standalone-napi-linux-x64';
const installed = `/app/node_modules/${packageName}/${fileName}`;
const beside = path.join(dir, fileName);

describe('addonLocation', () => {
    test('loads the addon built next to the loader', () => {
        const exists = (file) => file === beside;

        expect(addonLocation({ dir, fileName, packageName, exists, resolve: () => installed })).toBe(beside);
    });

    test('loads the addon from the package of its platform when the loader has none beside it', () => {
        expect(addonLocation({
            dir, fileName, packageName, exists: () => false, resolve: (name) => (name === packageName ? installed : null),
        })).toBe(installed);
    });

    test('names the addon beside the loader when no platform package is installed', () => {
        const resolve = () => { throw new Error('Cannot find module'); };

        expect(addonLocation({ dir, fileName, packageName, exists: () => false, resolve })).toBe(beside);
    });

    test('looks for no package when the project publishes none', () => {
        const resolve = () => { throw new Error('should not look for a package'); };

        expect(addonLocation({ dir, fileName, packageName: null, exists: () => false, resolve })).toBe(beside);
    });
});
