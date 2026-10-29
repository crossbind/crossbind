import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { removeSecretFiles, secretFile } from '../src/utils/secretFile.js';

afterAll(removeSecretFiles);

describe('a secret the environment holds as its text', () => {
    test('goes with its folder once crossbind is done, and a later one makes a folder anew', () => {
        const key = secretFile('AuthKey.p8', 'key text\n');
        removeSecretFiles();
        expect(fs.existsSync(path.dirname(key))).toBe(false);
        expect(fs.readFileSync(secretFile('AuthKey.p8', 'key text\n'), 'utf8')).toBe('key text\n');
    });

    test('is written to a file of a folder of its own, as the tools that take it read files', () => {
        const key = secretFile('AuthKey.p8', 'key text\n');
        const keystore = secretFile('upload.keystore', Buffer.from([0x30, 0x82]));
        expect(path.dirname(key)).toBe(path.dirname(keystore));
        expect(path.basename(path.dirname(key))).toMatch(/^crossbind-secrets-/);
        expect(fs.readFileSync(key, 'utf8')).toBe('key text\n');
        expect([...fs.readFileSync(keystore)]).toEqual([0x30, 0x82]);
    });

    test.skipIf(process.platform === 'win32')('is a file only its user reads, in a folder only its user opens', () => {
        const key = secretFile('AuthKey.p8', 'key text\n');
        expect(fs.statSync(key).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.dirname(key)).mode & 0o777).toBe(0o700);
    });
});
