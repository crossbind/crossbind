import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import replaceFile from '../src/utils/replaceFile.js';

let work;

beforeEach(() => {
    work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-replace-')));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('replaceFile', () => {
    // macOS keeps a loaded binary's signature per inode, so a rebuilt addon copied over the old one gets its loader killed.
    // A second link to the old file shows whether it was written: inode numbers cannot, as Linux reuses a freed one.
    test('gives the copy a new file instead of writing over the one in place', () => {
        const source = upath.join(work, 'built.node');
        const destination = upath.join(work, 'dist.node');
        const loaded = upath.join(work, 'loaded.node');
        fs.writeFileSync(source, 'rebuilt');
        fs.writeFileSync(destination, 'loaded before');
        fs.linkSync(destination, loaded);

        replaceFile(source, destination);

        expect(fs.readFileSync(destination, 'utf8')).toBe('rebuilt');
        expect(fs.readFileSync(loaded, 'utf8')).toBe('loaded before');
    });

    test('copies to a destination that does not exist yet', () => {
        const source = upath.join(work, 'built.node');
        fs.writeFileSync(source, 'first build');

        replaceFile(source, upath.join(work, 'dist.node'));

        expect(fs.readFileSync(upath.join(work, 'dist.node'), 'utf8')).toBe('first build');
    });
});
