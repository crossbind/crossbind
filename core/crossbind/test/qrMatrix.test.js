import { describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { halfBlocks, qrMatrix } from '../src/utils/qrMatrix.js';
import { LINK, VERSIONS } from './qrMatrices.js';

// crossbind's own QR encoder, held to the matrices macOS's own QR reader read back: qrReadBack.mjs reads every version
// and mask back where macOS is, and writes their SHA-256 to qrMatrices.js, which this test holds on every system.

const hashOf = (modules) => crypto.createHash('sha256').update(modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join('')).join('\n')).digest('hex');
// LINK in a terminal's own colours, as a phone's camera read it off a terminal.
const DRAWING = [
    '                                     ',
    '  █▀▀▀▀▀█ ▀▀▀▄█  ▀▄█▀▄██▄▀  █▀▀▀▀▀█  ',
    '  █ ███ █ ▄ ▀██▀▄▄▀▄▄▀▀▀▄▄▄ █ ███ █  ',
    '  █ ▀▀▀ █ ███▀▄▄▀ ▄█▀█▀▄▀ ▄ █ ▀▀▀ █  ',
    '  ▀▀▀▀▀▀▀ █ ▀ █ █▄█▄█ ▀▄█▄█ ▀▀▀▀▀▀▀  ',
    '  █ ▄▄█ ▀▀▀ ▄▄ █▄▄█▀▄▀ ▀▀▄ █▀▀▀█▄ █  ',
    '   ▀  ▄ ▀█▄█▄█▀ ▄▀ █▄ █▄ ▀▀█▄  ▀ ▀▄  ',
    '  ▄▀▀  █▀█▄ █▀▄█▀▀▄▄▀█ ▄▀   ▀█▀█▄ ▀  ',
    '  ▀█ ▄▀█▀ ▀▀ ███▄ ▀▄█  █▀█▄████  ▀   ',
    '  ▀█▀█▀▀▀▀█  █ ▄ █▀█  ▀█▀█ ▄▀ ▀▄█▀▄  ',
    '  █▄▄ ▄ ▀ █▀ ▄▄▀▄▀  ▀ ▄▄▄▀██ █ ▀ ▀▄  ',
    '  ▄▀  █▀▀█▀▄█▀█ ▄▀▀ ▄▀▄█▀█▀▄▀█▀▀▄█▀  ',
    '    ▀▀ ▀▀▀█▀██ ▀ █▄█ ▄ ▄▄█ ▄▄▀▄█▀▀   ',
    '  ▀▀▀▀ ▀▀ ██ ██ ▄▄ ▀▄ ▀█▀ █▀▀▀█▀▄ █  ',
    '  █▀▀▀▀▀█ ▀ █▄▀▄▀▀▀█▄▄▄▄▀ █ ▀ █▀ █   ',
    '  █ ███ █ ▀▄▄▀▄ ▀▀▄ ▀▄▀▀▀ ▀▀███▀ ▀   ',
    '  █ ▀▀▀ █  ▄█▀█▀▀ ▀██ ▀█▄▀▄▀█▀▀▀     ',
    '  ▀▀▀▀▀▀▀ ▀▀▀▀▀▀ ▀ ▀  ▀▀  ▀▀▀   ▀ ▀  ',
    '                                     ',
];

describe("crossbind's QR encoder", () => {
    test("gives each of versions 1 to 6, with each of the eight masks, the matrix macOS's reader read back", () => {
        const given = VERSIONS.map(({ version, text }) => ({
            version, text, sha256: [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => hashOf(qrMatrix(text, { version, mask }).modules)),
        }));
        expect(VERSIONS.map(({ version, sha256 }) => [version, sha256.length])).toEqual([[1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8]]);
        expect(given).toEqual(VERSIONS);
    });

    test("chooses version 4 for a session's link, 33 modules a side, which the terminal draws in 37 columns and 19 lines of half blocks", () => {
        const {
            version, mask, size, modules,
        } = qrMatrix(LINK.text);
        expect({
            version, mask, size, sha256: hashOf(modules),
        }).toEqual({
            version: 4, mask: LINK.mask, size: 33, sha256: LINK.sha256,
        });
        expect(halfBlocks(modules)).toEqual(DRAWING);
    });

    test('holds 106 bytes at most, and refuses a longer text with its words, counting its bytes', () => {
        expect(qrMatrix('x'.repeat(106)).version).toBe(6);
        expect(() => qrMatrix('x'.repeat(107))).toThrow('a QR code of version 1 to 6 holds 106 bytes at most, and this text has 107');
        expect(() => qrMatrix('ü'.repeat(54))).toThrow('this text has 108');
    });

    test("imports nothing and names no API of Node's, so that a web page draws the same matrix", () => {
        const source = fs.readFileSync(new URL('../src/utils/qrMatrix.js', import.meta.url), 'utf8');
        expect(source).not.toMatch(/^\s*import\s|\brequire\(|\bprocess\b|\bBuffer\b|node:/m);
    });
});
