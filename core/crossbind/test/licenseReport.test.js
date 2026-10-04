import { describe, test, expect } from 'vitest';
import {
    isCopyleft, validateSpdx, formatNoticesMarkdown, formatCycloneDxSbom,
} from '../src/utils/licenseReport.js';

describe('validateSpdx', () => {
    test.each([
        'MIT',
        'LGPL-2.1-or-later',
        'curl',
        'libtiff',
        'blessing',
        '(IJG AND BSD-3-Clause AND Zlib)',
        'MPL-1.1 OR GPL-2.0-or-later OR LGPL-2.1-or-later',
    ])('accepts valid SPDX "%s"', (expression) => {
        expect(validateSpdx(expression).isValid).toBe(true);
    });

    test.each(['LGPL', 'Public Domain', 'MPL tri-license', ''])('rejects invalid "%s"', (expression) => {
        expect(validateSpdx(expression).isValid).toBe(false);
    });

    test('reports a missing field', () => {
        const result = validateSpdx(undefined);

        expect(result.isValid).toBe(false);
        expect(result.error).toMatch(/missing/i);
    });
});

describe('isCopyleft', () => {
    test.each(['LGPL-2.1-or-later', 'GPL-3.0-only', 'MPL-1.1 OR GPL-2.0-or-later OR LGPL-2.1-or-later', 'EPL-2.0'])(
        'flags %s',
        (expression) => expect(isCopyleft(expression)).toBe(true),
    );

    test.each(['MIT', 'Apache-2.0', 'Zlib', 'blessing', 'BSD-3-Clause', undefined])(
        'does not flag %s',
        (expression) => expect(isCopyleft(expression)).toBe(false),
    );
});

describe('formatNoticesMarkdown', () => {
    const row = (overrides = {}) => ({
        name: 'z',
        npmName: '@crossbind/port-zlib-wasm',
        version: '2.0.0',
        nativeVersion: '1.3.2',
        license: 'Zlib',
        sourceUrl: 'https://zlib.net/zlib-1.3.2.tar.gz',
        licenseText: 'zlib License text here',
        isCopyleft: false,
        ...overrides,
    });

    test('renders a section per dependency, sorted by name, with metadata', () => {
        const markdown = formatNoticesMarkdown([row({ name: 'z' }), row({ name: 'geos', license: 'LGPL-2.1-or-later', isCopyleft: true })]);

        expect(markdown.indexOf('## geos')).toBeLessThan(markdown.indexOf('## z'));
        expect(markdown).toContain('LGPL-2.1-or-later');
        expect(markdown).toContain('@crossbind/port-zlib-wasm@2.0.0');
        expect(markdown).toContain('native version: 1.3.2');
        expect(markdown).toContain('https://zlib.net/zlib-1.3.2.tar.gz');
        expect(markdown).toContain('zlib License text here');
    });

    test('tolerates missing fields', () => {
        const markdown = formatNoticesMarkdown([row({ license: null, sourceUrl: null, licenseText: null, nativeVersion: null })]);

        expect(markdown).toContain('## z');
        expect(markdown).not.toContain('null');
    });

    test('renders sha256, election and notes when present', () => {
        const markdown = formatNoticesMarkdown([row({
            sha256: 'abc123',
            licenseDeclared: 'BSD-3-Clause OR GPL-2.0-only',
            licenseSelected: 'BSD-3-Clause',
            licenseNotes: 'library only',
            license: 'BSD-3-Clause',
        })]);

        expect(markdown).toContain('(sha256: abc123)');
        expect(markdown).toContain('license election: BSD-3-Clause (declared: BSD-3-Clause OR GPL-2.0-only)');
        expect(markdown).toContain('note: library only');
    });

    test('flags OR expressions without an election', () => {
        const markdown = formatNoticesMarkdown([row({ license: 'MPL-1.1 OR GPL-2.0-or-later', licenseSelected: null })]);

        expect(markdown).toContain('no license election recorded');
    });

    test('a license text with a fence of its own stays inside its block', () => {
        const markdown = formatNoticesMarkdown([row({ licenseText: 'text\n```\n## Injected section\n```' })]);

        expect(markdown).toContain('````\ntext\n```\n## Injected section\n```\n````');
    });
});

describe('formatCycloneDxSbom', () => {
    const row = (overrides = {}) => ({
        name: 'z',
        nativeVersion: '1.3.2',
        license: 'Zlib',
        sha256: 'abc123',
        sourceUrl: 'https://zlib.net/zlib-1.3.2.tar.gz',
        ...overrides,
    });

    test('emits deterministic CycloneDX with purl, hash, license expression', () => {
        const sbom = JSON.parse(formatCycloneDxSbom([row()], { name: '@crossbind/port-zlib-wasi', version: '2.0.0' }));

        expect(sbom.bomFormat).toBe('CycloneDX');
        expect(sbom.metadata.component.name).toBe('@crossbind/port-zlib-wasi');
        expect(sbom.metadata.timestamp).toBeUndefined();
        expect(sbom.serialNumber).toBeUndefined();
        const [component] = sbom.components;
        expect(component.purl).toBe('pkg:generic/z@1.3.2');
        expect(component.licenses).toEqual([{ expression: 'Zlib' }]);
        expect(component.hashes).toEqual([{ alg: 'SHA-256', content: 'abc123' }]);
    });

    test('sorts components and tolerates missing fields', () => {
        const sbom = JSON.parse(formatCycloneDxSbom([
            row({ name: 'z' }),
            row({ name: 'geos', sha256: null, sourceUrl: null, nativeVersion: null, license: null }),
        ], {}));

        expect(sbom.components.map((c) => c.name)).toEqual(['geos', 'z']);
        expect(sbom.components[0].hashes).toBeUndefined();
        expect(sbom.components[0].purl).toBeUndefined();
    });

    test('a row that knows its package URL keeps it', () => {
        const sbom = JSON.parse(formatCycloneDxSbom([row({ name: 'zlib', purl: 'pkg:conan/zlib@1.3.2' })], {}));

        expect(sbom.components[0].purl).toBe('pkg:conan/zlib@1.3.2');
    });
});
