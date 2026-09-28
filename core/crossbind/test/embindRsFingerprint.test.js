import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = { dir: null };
vi.mock('../src/utils/resolveEmbindRust.js', () => ({ default: () => root.dir }));

const { getEmbindRsFingerprint, isEmbindRsFingerprintStale, writeEmbindRsFingerprint } = await import('../src/utils/embindRsFingerprint.js');

let work;

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-embind-rs-'));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

function crateAt(dir) {
    fs.mkdirSync(`${dir}/crate/src`, { recursive: true });
    fs.writeFileSync(`${dir}/crate/Cargo.toml`, '[package]\nname = "embind-rs"\n');
    fs.writeFileSync(`${dir}/crate/src/lib.rs`, 'pub fn a() {}\n');
    return dir;
}

describe('embind-rs fingerprint', () => {
    // A published cargo archive was built on another machine, so its stamp must not depend on where the crate sits.
    test('is the same for one crate at two paths', () => {
        root.dir = crateAt(`${work}/a`);
        const first = getEmbindRsFingerprint();
        root.dir = crateAt(`${work}/b`);

        expect(getEmbindRsFingerprint()).toBe(first);
    });

    test('changes with a source of the crate', () => {
        root.dir = crateAt(`${work}/a`);
        const before = getEmbindRsFingerprint();
        fs.writeFileSync(`${root.dir}/crate/src/lib.rs`, 'pub fn b() {}\n');

        expect(getEmbindRsFingerprint()).not.toBe(before);
    });

    test('counts a prebuilt without a stamp, or with another one, as stale', () => {
        const prebuilt = `${work}/prebuilt/wasm-wasm32-st-release`;
        expect(isEmbindRsFingerprintStale(prebuilt, 'current')).toBe(true);

        writeEmbindRsFingerprint(prebuilt, 'older');
        expect(isEmbindRsFingerprintStale(prebuilt, 'current')).toBe(true);

        writeEmbindRsFingerprint(prebuilt, 'current');
        expect(isEmbindRsFingerprintStale(prebuilt, 'current')).toBe(false);
    });
});
