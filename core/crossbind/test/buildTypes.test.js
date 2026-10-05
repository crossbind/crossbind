import { describe, test, expect } from 'vitest';
import { withPackageTypes } from '../src/actions/buildTypes.js';

const dts = './dist/types/index.d.ts';

describe('withPackageTypes', () => {
    test('maps every header import to the generated declarations', () => {
        expect(withPackageTypes({ name: 'pkg' }, dts)).toEqual({ name: 'pkg', types: dts, typesVersions: { '*': { '*.h': [dts] } } });
    });

    // A package publishes typed entries of its own beside the header imports, such as node/napi.
    test('keeps the other paths a package maps its types for', () => {
        const manifest = { typesVersions: { '*': { 'node/napi': ['./node/napi.d.ts'], '*.h': ['./old.d.ts'] } } };

        expect(withPackageTypes(manifest, dts).typesVersions).toEqual({ '*': { 'node/napi': ['./node/napi.d.ts'], '*.h': [dts] } });
    });
});
