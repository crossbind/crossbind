import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    isExcluded, matchesPattern, walk, snapshot, hashIndex, expandRoots, presentUnits, planSync, diffSnapshots, hostPathOf, isDeclaredOutput,
} from '../src/runner/files.js';
import { REMOTE_EXCLUDE_RULES } from '../src/utils/remoteRunner.js';

describe('runner file sync', () => {
    let base;

    const write = (rel, content) => {
        fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
        fs.writeFileSync(path.join(base, rel), content);
    };

    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runner-files-'));
    });

    afterEach(() => {
        fs.rmSync(base, { recursive: true, force: true });
    });

    test('excludes dependency folders and JavaScript sources, keeps native inputs', () => {
        expect(isExcluded('app/node_modules/x/y.h', REMOTE_EXCLUDE_RULES)).toBe(true);
        expect(isExcluded('.git/HEAD', REMOTE_EXCLUDE_RULES)).toBe(true);
        expect(isExcluded('app/src/main.jsx', REMOTE_EXCLUDE_RULES)).toBe(true);
        expect(isExcluded('app/src/native/native.cpp', REMOTE_EXCLUDE_RULES)).toBe(false);
        expect(isExcluded('app/.crossbind/build/Source-Release/CMakeCache.txt', REMOTE_EXCLUDE_RULES)).toBe(false);
    });

    test('keeps credential files such as .env and .npmrc on the machine', () => {
        expect(isExcluded('pkg/.env', REMOTE_EXCLUDE_RULES)).toBe(true);
        expect(isExcluded('pkg/.env.local', REMOTE_EXCLUDE_RULES)).toBe(true);
        expect(isExcluded('pkg/.npmrc', REMOTE_EXCLUDE_RULES)).toBe(true);
        expect(isExcluded('pkg/environment.h', REMOTE_EXCLUDE_RULES)).toBe(false);
    });

    test.skipIf(process.platform === 'win32')('follows a link that stays inside the base and skips one that leads out, which a local container would see dangle', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-outside-'));
        fs.writeFileSync(path.join(outside, 'id_rsa'), 'key');
        write('src/real.h', 'inside');
        fs.symlinkSync(path.join(base, 'src/real.h'), path.join(base, 'src/alias.h'));
        fs.symlinkSync(path.join(outside, 'id_rsa'), path.join(base, 'src/key'));
        fs.symlinkSync(outside, path.join(base, 'src/ssh'));

        const files = snapshot(base, ['src'], REMOTE_EXCLUDE_RULES);

        expect([...files.keys()].sort()).toEqual(['src/alias.h', 'src/real.h']);
        fs.rmSync(outside, { recursive: true, force: true });
    });

    test.skipIf(process.platform === 'win32')('does not loop through a link back to a folder it is already inside', () => {
        write('src/a/x.h', 'x');
        fs.symlinkSync(path.join(base, 'src'), path.join(base, 'src/a/up'));

        expect([...snapshot(base, ['src'], REMOTE_EXCLUDE_RULES).keys()]).toEqual(['src/a/x.h']);
    });

    test('keeps native files and drops JavaScript and dependency folders below a root', () => {
        write('app/src/native/a.cpp', 'int a;');
        write('app/src/main.js', 'x');
        write('app/src/node_modules/dep/d.h', 'x');

        expect([...snapshot(base, ['app/src'], REMOTE_EXCLUDE_RULES).keys()]).toEqual(['app/src/native/a.cpp']);
    });

    test('walks a root that is itself inside node_modules, as an installed port is', () => {
        write('app/node_modules/@crossbind/port-zlib/dist/include/zlib.h', 'x');
        write('app/node_modules/@crossbind/port-zlib/dist/index.js', 'x');

        const files = snapshot(base, ['app/node_modules/@crossbind/port-zlib/dist'], REMOTE_EXCLUDE_RULES);

        expect([...files.keys()]).toEqual(['app/node_modules/@crossbind/port-zlib/dist/include/zlib.h']);
    });

    test('lists every folder below the roots, empty ones too, so the runner can recreate them', () => {
        write('app/.crossbind/build/interface/native.i', 'x');
        fs.mkdirSync(path.join(base, 'app/.crossbind/build/bridge'), { recursive: true });
        fs.mkdirSync(path.join(base, 'app/.crossbind/node_modules/x'), { recursive: true });

        const { dirs } = walk(base, ['app/.crossbind'], REMOTE_EXCLUDE_RULES);

        expect(dirs).toEqual(['app/.crossbind', 'app/.crossbind/build', 'app/.crossbind/build/bridge', 'app/.crossbind/build/interface']);
    });

    test('leaves a cargo target folder out of a sync walk, but not a folder that only shares its name', () => {
        write('app/crate/Cargo.toml', '[package]');
        write('app/crate/target/wasm32/release/libcrate.a', 'a');
        write('app/src/target/keep.cpp', 'x');

        expect([...snapshot(base, ['app'], REMOTE_EXCLUDE_RULES).keys()]).toEqual(['app/crate/Cargo.toml', 'app/src/target/keep.cpp']);
    });

    test('returns only the kept artifacts of a cargo target folder from an output walk', () => {
        write('crate/Cargo.toml', '[package]');
        write('crate/target/wasm32/release/libcrate.a', 'a');
        write('crate/target/wasm32/release/deps/libdep.rlib', 'r');
        write('crate/target/release/.fingerprint/x', 'f');

        const files = snapshot(base, ['crate'], { ...REMOTE_EXCLUDE_RULES, extensions: [] }, { outputs: true });

        expect([...files.keys()]).toEqual(['crate/Cargo.toml', 'crate/target/wasm32/release/libcrate.a']);
    });

    test('matches artifact patterns segment by segment', () => {
        expect(matchesPattern('wasm32-unknown-emscripten/release/libapp.a', '*/release/*.a')).toBe(true);
        expect(matchesPattern('wasm32-unknown-emscripten/release/deps/libx.rlib', '*/release/*.a')).toBe(false);
        expect(matchesPattern('wasm32-unknown-emscripten/debug/libapp.a', '*/release/*.a')).toBe(false);
    });

    test('expands a `*` segment against the folders that exist, as conan package folders need', () => {
        ['b/fmt1/p/lib/libfmt.a', 'b/fmt1/b/obj.o', 'b/zlib2/p/include/zlib.h', 'p/png3/p/lib/libpng.a'].forEach((rel) => write(rel, 'x'));

        expect(expandRoots(base, ['b/*/p', 'p/*/p', 'missing/*/p', 'plain'])).toEqual(['b/fmt1/p', 'b/zlib2/p', 'p/png3/p', 'plain']);
    });

    test('reports the store units already here, so the runner sends only the ones this machine lacks', () => {
        write('registry/src/index/semver-1.0.0/src/lib.rs', 'x');
        fs.mkdirSync(path.join(base, 'registry/src/index/empty-0.1.0'), { recursive: true });
        write('registry/cache/index/semver-1.0.0.crate', 'x');

        expect(presentUnits(base, ['registry/src/*/*', 'git/checkouts/*/*', 'plain'])).toEqual(['registry/src/index/semver-1.0.0']);
    });

    test('hashes a file once while its size and mtime stay the same, and forgets files that are gone', () => {
        write('a.cpp', 'int a;');
        write('b.cpp', 'int b;');
        const index = new Map();
        hashIndex(base, snapshot(base, ['.'], REMOTE_EXCLUDE_RULES), index);
        index.get('a.cpp').sha256 = 'cached';
        fs.rmSync(path.join(base, 'b.cpp'));

        const hashes = hashIndex(base, snapshot(base, ['.'], REMOTE_EXCLUDE_RULES), index);

        expect(hashes.get('a.cpp')).toBe('cached');
        expect(index.has('b.cpp')).toBe(false);
    });
});

describe('sync planning', () => {
    test('writes new and changed files and removes the files the client no longer has', () => {
        const current = new Map([['a.cpp', 'h1'], ['b.h', 'h2'], ['gone.cpp', 'h3']]);
        const manifest = { 'a.cpp': { sha256: 'h1', mode: 0o644 }, 'b.h': { sha256: 'h2-new', mode: 0o644 }, 'c.cpp': { sha256: 'h4', mode: 0o644 } };

        const plan = planSync(current, manifest);

        expect(plan.write.sort()).toEqual(['b.h', 'c.cpp']);
        expect(plan.remove).toEqual(['gone.cpp']);
    });

    test('reports created, modified and removed outputs between two snapshots', () => {
        const before = new Map([['keep.o', { size: 10, mtimeMs: 1 }], ['edit.o', { size: 10, mtimeMs: 1 }], ['old.o', { size: 5, mtimeMs: 1 }]]);
        const after = new Map([['keep.o', { size: 10, mtimeMs: 1 }], ['edit.o', { size: 12, mtimeMs: 2 }], ['new.o', { size: 7, mtimeMs: 2 }]]);

        const diff = diffSnapshots(before, after);

        expect(diff.changed.sort()).toEqual(['edit.o', 'new.o']);
        expect(diff.removed).toEqual(['old.o']);
    });
});

describe('hostPathOf', () => {
    const mounts = [
        { host: '/Users/me/app', container: '/tmp/crossbind/live' },
        { host: '/Users/me/.crossbind/cargo', container: '/var/cache/crossbind/cargo' },
    ];

    test('maps a container path back through the mount that holds it', () => {
        expect(hostPathOf(mounts, '/var/cache/crossbind/cargo/registry/src/x/lib.rs'))
            .toEqual({ mount: mounts[1], rel: 'registry/src/x/lib.rs', file: path.join('/Users/me/.crossbind/cargo', 'registry/src/x/lib.rs') });
    });

    test('refuses a path no mount holds, so a runner cannot write anywhere else on the machine', () => {
        expect(() => hostPathOf(mounts, '/etc/passwd')).toThrow(/outside the mounts/);
        expect(() => hostPathOf(mounts, '/tmp/crossbind/live/../../etc/passwd')).toThrow(/outside the mounts/);
    });

    test('refuses a backslash or NUL, which Windows would read as a separator and climb out with', () => {
        expect(() => hostPathOf(mounts, '/tmp/crossbind/live/out/..\\..\\..\\Users\\me\\x.bat')).toThrow(/outside the mounts/);
        expect(() => hostPathOf(mounts, '/tmp/crossbind/live/out/a\0b')).toThrow(/outside the mounts/);
    });

    test.runIf(process.platform === 'win32')('refuses a colon on Windows, where it names a drive or a stream', () => {
        expect(() => hostPathOf(mounts, '/tmp/crossbind/live/out/x.o:hidden')).toThrow(/outside the mounts/);
    });
});

describe('isDeclaredOutput', () => {
    test('accepts a file below an output root of the step and nothing else, a git hook least of all', () => {
        const roots = ['app/.crossbind', 'ports/x/crate/Cargo.lock'];

        expect(isDeclaredOutput('app/.crossbind/build/x.o', roots)).toBe(true);
        expect(isDeclaredOutput('ports/x/crate/Cargo.lock', roots)).toBe(true);
        expect(isDeclaredOutput('app/package.json', roots)).toBe(false);
        expect(isDeclaredOutput('.git/hooks/pre-commit', roots)).toBe(false);
        expect(isDeclaredOutput('app/.crossbind-old/x.o', roots)).toBe(false);
    });

    test('accepts a file of a store unit this machine lacks and refuses one of a unit it already holds', () => {
        const roots = ['registry/src/*/*'];
        const unit = 'registry/src/index.crates.io-1949cf8c6b5b557f/semver-1.0.26';

        expect(isDeclaredOutput(`${unit}/src/lib.rs`, roots, [])).toBe(true);
        expect(isDeclaredOutput(`${unit}/src/lib.rs`, roots, [unit])).toBe(false);
        expect(isDeclaredOutput('registry/cache/index/semver-1.0.26.crate', roots, [])).toBe(false);
    });
});
