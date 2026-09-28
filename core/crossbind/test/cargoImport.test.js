import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    parseCargoImport, cargoMarkerName, parseCargoMarkerName, findCargoModuleImports,
} from '../src/utils/cargoImport.js';

const h = vi.hoisted(() => ({ config: null }));
vi.mock('../src/state/index.js', () => ({ default: { get config() { return h.config; } } }));

describe('cargo import specifiers', () => {
    test('a bare crate import has no module path', () => {
        expect(parseCargoImport('cargo:uuid')).toEqual({ crateName: 'uuid', modulePath: [] });
    });

    test('a module path follows the crate after a slash', () => {
        expect(parseCargoImport('cargo:xxhash-rust/xxh3')).toEqual({ crateName: 'xxhash-rust', modulePath: ['xxh3'] });
        expect(parseCargoImport('cargo:a/b/c_d')).toEqual({ crateName: 'a', modulePath: ['b', 'c_d'] });
    });

    test('refuses a module segment that is not a Rust identifier', () => {
        for (const bad of ['cargo:x/..', 'cargo:x/../y', 'cargo:x/', 'cargo:x/1abc', 'cargo:x/a-b', 'cargo:x/a.b']) {
            expect(() => parseCargoImport(bad), bad).toThrow(/Rust module/);
        }
    });

    test('marker names round-trip, and a bare crate keeps its plain name', () => {
        expect(cargoMarkerName({ crateName: 'uuid', modulePath: [] })).toBe('uuid');
        expect(cargoMarkerName({ crateName: 'xxhash-rust', modulePath: ['xxh3'] })).toBe('xxhash-rust.xxh3');
        expect(parseCargoMarkerName('xxhash-rust.xxh3')).toEqual({ crateName: 'xxhash-rust', modulePath: ['xxh3'] });
        expect(parseCargoMarkerName('uuid')).toEqual({ crateName: 'uuid', modulePath: [] });
    });

    test('finds module imports in source text and leaves bare crates and other schemes aside', () => {
        const src = [
            "import { xxh364 } from 'cargo:xxhash-rust/xxh3';",
            'import { Uuid } from "cargo:uuid";',
            'const m = await import(`cargo:regex/bytes`);',
            "import x from 'npm:cargo/thing';",
        ].join('\n');
        expect(findCargoModuleImports(src)).toEqual([
            { crateName: 'xxhash-rust', modulePath: ['xxh3'] },
            { crateName: 'regex', modulePath: ['bytes'] },
        ]);
    });
});

describe('getDependFilePath for cargo imports', () => {
    let cache;

    beforeEach(() => {
        cache = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cargo-import-'));
        h.config = { cargoDependencies: { 'xxhash-rust': '0.8' }, paths: { cache } };
    });

    afterEach(() => {
        fs.rmSync(cache, { recursive: true, force: true });
    });

    test('a module import resolves to its own marker', async () => {
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');
        const marker = getDependFilePath('cargo:xxhash-rust/xxh3');
        expect(marker).toBe(path.join(cache, 'rust-crates', 'xxhash-rust.xxh3.rs'));
        expect(fs.existsSync(marker)).toBe(true);
    });

    test('a module of an undeclared crate is refused like the crate itself', async () => {
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');
        expect(() => getDependFilePath('cargo:uuid/fmt')).toThrow(/add 'uuid' to cargoDependencies/);
    });

    test('a module path that could leave the marker directory is refused', async () => {
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');
        expect(() => getDependFilePath('cargo:xxhash-rust/../../escape')).toThrow(/Rust module/);
    });
});
