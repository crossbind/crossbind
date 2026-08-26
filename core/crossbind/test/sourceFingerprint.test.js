import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    SOURCE_FINGERPRINT_FILE,
    staleTargetDirectories,
    getSourceFingerprint,
    isSourceFingerprintStale,
    writeSourceFingerprint,
} from '../src/utils/sourceFingerprint.js';

// buildLib caches a prebuilt lib on existence alone. Before this stamp, `check:native --update`
// followed by a build produced binaries of the previous upstream release while the manifest,
// provenance and licence metadata already claimed the new one.
const configFor = (nativeVersion, sha256) => ({ package: { nativeVersion }, build: { sha256 } });

let libdir;

beforeEach(() => {
    libdir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-sourcefp-'));
});

afterEach(() => {
    fs.rmSync(libdir, { recursive: true, force: true });
});

describe('getSourceFingerprint', () => {
    test('returns null when the recipe pins neither a version nor a source hash', () => {
        expect(getSourceFingerprint({ package: {}, build: {} })).toBe(null);
        expect(getSourceFingerprint(undefined)).toBe(null);
    });

    test('changes when the upstream version changes', () => {
        const before = getSourceFingerprint(configFor('4.0.1', 'a'.repeat(64)));
        const after = getSourceFingerprint(configFor('4.0.2', 'a'.repeat(64)));
        expect(before).not.toBe(after);
    });

    test('changes when only the recipe source hash changes', () => {
        const before = getSourceFingerprint(configFor('4.0.2', 'a'.repeat(64)));
        const after = getSourceFingerprint(configFor('4.0.2', 'b'.repeat(64)));
        expect(before).not.toBe(after);
    });
});

describe('isSourceFingerprintStale', () => {
    test('treats a prebuilt directory with no stamp as stale', () => {
        const fingerprint = getSourceFingerprint(configFor('4.0.2', 'a'.repeat(64)));
        expect(isSourceFingerprintStale(libdir, fingerprint)).toBe(true);
    });

    test('accepts a stamp written from the same recipe', () => {
        const fingerprint = getSourceFingerprint(configFor('4.0.2', 'a'.repeat(64)));
        writeSourceFingerprint(libdir, fingerprint);
        expect(isSourceFingerprintStale(libdir, fingerprint)).toBe(false);
    });

    test('rejects a stamp written from the previous upstream version', () => {
        writeSourceFingerprint(libdir, getSourceFingerprint(configFor('4.0.1', 'a'.repeat(64))));
        const current = getSourceFingerprint(configFor('4.0.2', 'b'.repeat(64)));
        expect(isSourceFingerprintStale(libdir, current)).toBe(true);
    });

    test('leaves local-source packages on the existence-only behaviour', () => {
        expect(isSourceFingerprintStale(libdir, null)).toBe(false);
    });
});

describe('writeSourceFingerprint', () => {
    test('creates the prebuilt directory and stores the stamp', () => {
        const nested = path.join(libdir, 'prebuilt', 'wasm-wasm32-st-release');
        const fingerprint = getSourceFingerprint(configFor('4.0.2', 'a'.repeat(64)));
        writeSourceFingerprint(nested, fingerprint);
        expect(fs.readFileSync(path.join(nested, SOURCE_FINGERPRINT_FILE), 'utf8')).toBe(fingerprint);
    });

    test('writes nothing when the recipe pins no source', () => {
        writeSourceFingerprint(libdir, null);
        expect(fs.existsSync(path.join(libdir, SOURCE_FINGERPRINT_FILE))).toBe(false);
    });
});

describe('staleTargetDirectories', () => {
    const dirs = () => staleTargetDirectories({
        buildPath: '/pkg/.crossbind/build',
        outputPath: '/pkg/dist',
        targetPath: 'android-x86_64-mt-release',
    });

    test('drops the configure output of the previous upstream release', () => {
        expect(dirs()).toContain('/pkg/.crossbind/build/Source-Release/android-x86_64-mt-release');
    });

    // sqlite3 failed here: 'make install' cannot chmod a man page it did not create.
    test('drops the staged install tree, release and debug alike', () => {
        expect(dirs()).toContain('/pkg/.crossbind/build/Source-Release/prebuilt/android-x86_64-mt-release');
        expect(dirs()).toContain('/pkg/.crossbind/build/Source-Debug/prebuilt/android-x86_64-mt-release');
    });

    // geos failed here: a read-only geos-config blocks the copy into dist.
    test('drops the published output of the target', () => {
        expect(dirs()).toContain('/pkg/dist/prebuilt/android-x86_64-mt-release');
    });

    test('names only that target, never the shared source or another target', () => {
        for (const d of dirs()) {
            expect(d).toContain('android-x86_64-mt-release');
            expect(d.endsWith('/build/source')).toBe(false);
        }
    });
});
