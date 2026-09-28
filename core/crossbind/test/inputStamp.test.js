import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import {
    collectInputFiles, collectRustBridgeFiles, collectRustSources, computeInputStamp,
} from '../src/utils/inputStamp.js';

describe('inputStamp', () => {
    let root;

    // collectInputFiles returns upath-normalized paths (glob posix output), so
    // expectations normalize the same way for Windows.
    const write = (rel, content = '') => {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return upath.normalize(file);
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-stamp-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    describe('collectInputFiles', () => {
        test('collects matching extensions plus package.json, sorted', () => {
            const a = write('src/a.js');
            const h = write('cpp/native.h');
            const pkg = write('package.json', '{}');
            write('README.md');

            const files = collectInputFiles([root], ['js', 'h']);

            expect(files).toEqual([h, pkg, a].sort());
        });

        test('excludes node_modules, dist and other build dirs', () => {
            const kept = write('src/a.js');
            write('node_modules/dep/index.js');
            write('dist/out.js');
            write('android/x.js');
            write('.crossbind/build/y.js');

            const files = collectInputFiles([root], ['js']);

            expect(files).toEqual([kept]);
        });

        test('includes existing extra files and drops missing ones', () => {
            const extra = write('notes/config.special');

            const files = collectInputFiles([root], ['js'], [extra, path.join(root, 'missing.txt')]);

            expect(files).toEqual([extra]);
        });

        test('deduplicates overlapping roots', () => {
            const a = write('src/a.js');

            expect(collectInputFiles([root, root], ['js'])).toEqual([a]);
        });
    });

    describe('computeInputStamp', () => {
        test('is stable for identical inputs and changes with content', () => {
            write('src/a.js', 'one');

            const first = computeInputStamp([root], ['js'], [], 'platform:android');
            const second = computeInputStamp([root], ['js'], [], 'platform:android');
            write('src/a.js', 'two');
            const third = computeInputStamp([root], ['js'], [], 'platform:android');

            expect(second).toBe(first);
            expect(third).not.toBe(first);
        });

        test('changes with the salt', () => {
            write('src/a.js');

            expect(computeInputStamp([root], ['js'], [], 'platform:android'))
                .not.toBe(computeInputStamp([root], ['js'], [], 'platform:ios'));
        });

        test('changes when a new matching file appears', () => {
            write('src/a.js');
            const before = computeInputStamp([root], ['js'], [], 's');
            write('src/b.js');

            expect(computeInputStamp([root], ['js'], [], 's')).not.toBe(before);
        });
    });

    describe('Rust inputs', () => {
        test('collectRustSources finds .rs files and skips cargo target and build dirs', () => {
            const surface = write('src/native/counter.rs');
            const nested = write('src/native/geo/mod.rs');
            write('target/release/build/x/out/generated.rs');
            write('crate/target/debug/build/y/out/generated.rs');
            write('node_modules/dep/src/lib.rs');
            write('.crossbind/rust-bridges/counter/src/lib.rs');
            write('ios/Pods/x.rs');

            expect(collectRustSources([root, root])).toEqual([nested, surface].sort());
        });

        test('collectRustBridgeFiles lists the generated bridge crates and cargo: markers', () => {
            const manifest = write('.crossbind/rust-bridges/counter/Cargo.toml');
            const lib = write('.crossbind/rust-bridges/counter/src/lib.rs');
            const marker = write('.crossbind/rust-crates/uuid.rs');
            write('.crossbind/rust-bridges/counter/target/release/libcounter.a');
            write('.crossbind/rust-crates/types/uuid.d.ts');

            expect(collectRustBridgeFiles(path.join(root, '.crossbind'))).toEqual([manifest, lib, marker].sort());
        });

        test('collectRustBridgeFiles is empty before any bridge exists', () => {
            expect(collectRustBridgeFiles(path.join(root, '.crossbind'))).toEqual([]);
        });
    });
});
