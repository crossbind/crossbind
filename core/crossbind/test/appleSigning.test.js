import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// security, ditto, xcrun and sleep, which see the keychain, reach Apple and wait.
const spawnSync = vi.fn();
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));

const { appStoreKey, appleSigning, notarizeApp } = await import('../src/actions/appleSigning.js');

const DEVELOPER_ID = 'Developer ID Application: Ada Lovelace (ABCDE12345)';
const HASH = '89ABCDEF0123456789ABCDEF0123456789ABCDEF';
const RENEWED = 'FEDCBA9876543210FEDCBA9876543210FEDCBA98';
const IDENTITIES = [
    '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Ada Lovelace (FGHIJ67890)"',
    `  2) ${HASH} "${DEVELOPER_ID}"`,
    '     2 valid identities found',
].join('\n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-apple-'));
const key = path.join(dir, 'AuthKey_ABC123.p8');
fs.writeFileSync(key, 'key');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const notary = { CROSSBIND_APPLE_API_KEY: key, CROSSBIND_APPLE_API_KEY_ID: 'ABC123', CROSSBIND_APPLE_API_ISSUER: 'issuer-uuid' };
const done = (stdout = '') => ({ status: 0, stdout, stderr: '' });

beforeEach(() => {
    spawnSync.mockReset();
    spawnSync.mockImplementation((command) => done(command === 'security' ? IDENTITIES : ''));
});

describe('the identity and key that sign and notarize a macOS app', () => {
    test('are none without an identity, so the app is signed ad hoc, even with the key, which iOS uploads take too', () => {
        expect(appleSigning({})).toBeNull();
        expect(appleSigning(notary)).toBeNull();
        expect(spawnSync).not.toHaveBeenCalled();
    });

    test("sign with the hash of an identity the keychain holds, named by name or hash, and notarize with all of the key", () => {
        expect(appleSigning({ CROSSBIND_APPLE_SIGNING_IDENTITY: DEVELOPER_ID })).toEqual({ identity: HASH, notary: null });
        expect(appleSigning({ CROSSBIND_APPLE_SIGNING_IDENTITY: HASH.toLowerCase(), ...notary })).toEqual({
            identity: HASH, notary: { key, keyId: 'ABC123', issuer: 'issuer-uuid' },
        });
        expect(spawnSync).toHaveBeenCalledWith('security', ['find-identity', '-v', '-p', 'codesigning'], expect.anything());
    });

    test('stop the build for a name two identities share, as after a renewal, which a hash tells apart', () => {
        spawnSync.mockImplementation(() => done([`  1) ${HASH} "${DEVELOPER_ID}"`, `  2) ${RENEWED} "${DEVELOPER_ID}"`, `  3) ${HASH} "${DEVELOPER_ID}"`].join('\n')));
        expect(() => appleSigning({ CROSSBIND_APPLE_SIGNING_IDENTITY: DEVELOPER_ID }))
            .toThrow(`which 2 identities in the keychain are: ${HASH} "${DEVELOPER_ID}", ${RENEWED} "${DEVELOPER_ID}". Set it to one of their hashes.`);
        expect(appleSigning({ CROSSBIND_APPLE_SIGNING_IDENTITY: RENEWED })).toEqual({ identity: RENEWED, notary: null });
    });

    test('stop the build for an identity the keychain lacks, or part of a key', () => {
        expect(() => appleSigning({ CROSSBIND_APPLE_SIGNING_IDENTITY: 'Developer ID Application: Someone Else' }))
            .toThrow('which no valid code signing identity in the keychain is');
        expect(() => appleSigning({ CROSSBIND_APPLE_SIGNING_IDENTITY: DEVELOPER_ID, CROSSBIND_APPLE_API_KEY: key }))
            .toThrow('CROSSBIND_APPLE_API_KEY is set, but CROSSBIND_APPLE_API_KEY_ID and CROSSBIND_APPLE_API_ISSUER are not');
    });

    test('notarize only what a Developer ID Application identity signs, with a key file that exists', () => {
        expect(() => appleSigning({ CROSSBIND_APPLE_SIGNING_IDENTITY: 'Apple Development: Ada Lovelace', ...notary }))
            .toThrow('which "Apple Development: Ada Lovelace (FGHIJ67890)" is not');
        expect(() => appleSigning({ CROSSBIND_APPLE_SIGNING_IDENTITY: DEVELOPER_ID, ...notary, CROSSBIND_APPLE_API_KEY: path.join(dir, 'missing.p8') }))
            .toThrow('which is no file');
    });
});

describe('the App Store Connect API key', () => {
    test('takes its ID from the name App Store Connect gives its file, AuthKey_<key id>.p8, where the environment names none', () => {
        const named = path.join(dir, 'AuthKey_2X9R4HXF34.p8');
        fs.writeFileSync(named, 'key');
        expect(appStoreKey({ CROSSBIND_APPLE_API_KEY: named, CROSSBIND_APPLE_API_ISSUER: 'issuer-uuid' }))
            .toEqual({ key: named, keyId: '2X9R4HXF34', issuer: 'issuer-uuid' });
        expect(appStoreKey({ CROSSBIND_APPLE_API_KEY: named, CROSSBIND_APPLE_API_KEY_ID: 'Q1W2E3R4T5', CROSSBIND_APPLE_API_ISSUER: 'issuer-uuid' }).keyId)
            .toBe('Q1W2E3R4T5');
        expect(() => appStoreKey({ CROSSBIND_APPLE_API_KEY: named }))
            .toThrow('crossbind: CROSSBIND_APPLE_API_KEY is set, but CROSSBIND_APPLE_API_ISSUER is not: an App Store Connect API key takes all three.');
    });

    test('names its ID among what is missing where its file has another name', () => {
        expect(() => appStoreKey({ CROSSBIND_APPLE_API_KEY: key, CROSSBIND_APPLE_API_ISSUER: 'issuer-uuid' }))
            .toThrow('CROSSBIND_APPLE_API_KEY_ID is not: an App Store Connect API key takes all three, the ID unless its file keeps the name App Store Connect gives it, AuthKey_<key id>.p8.');
    });
});

describe("Apple's notarization of a macOS app", () => {
    const signed = { key, keyId: 'ABC123', issuer: 'issuer-uuid' };
    const credentials = ['--key', key, '--key-id', 'ABC123', '--issuer', 'issuer-uuid'];
    const calls = () => spawnSync.mock.calls.map(([command, args]) => [command, ...args]);
    // What notarytool, then stapler, answer.
    function apple({ submit = { status: 0, verdict: { id: 'submission-id', status: 'Accepted' } }, staples = [0] } = {}) {
        const stapled = [...staples];
        spawnSync.mockImplementation((command, args) => {
            if (args[1] === 'submit') return { status: submit.status, stdout: submit.stdout ?? JSON.stringify(submit.verdict), stderr: submit.stderr ?? '' };
            if (args[1] === 'log') return done('{"issues":[{"message":"The binary is not signed with a valid Developer ID certificate."}]}');
            if (args[0] === 'stapler') return { status: stapled.shift(), stdout: '', stderr: 'Error 65' };
            return done();
        });
    }

    let log;
    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => log.mockRestore());

    test('sends the app as a zip, waits for the verdict and staples the ticket to the app', () => {
        apple();

        notarizeApp('/dist/Demo.app', signed);

        const zip = calls()[0][5];
        expect(zip).toMatch(/crossbind-notary-[^/\\]+[/\\]Demo\.app\.zip$/);
        expect(calls()).toEqual([
            ['ditto', '-c', '-k', '--keepParent', '/dist/Demo.app', zip],
            ['xcrun', 'notarytool', 'submit', zip, ...credentials, '--wait', '--timeout', '2h', '--output-format', 'json'],
            ['xcrun', 'stapler', 'staple', '/dist/Demo.app'],
        ]);
        expect(fs.existsSync(path.dirname(zip))).toBe(false);
        expect(log).toHaveBeenCalledWith('crossbind: Apple is notarizing Demo.app, which takes a few minutes.');
    });

    test("stops the build with Apple's log when it does not accept the app, whatever notarytool's exit code", () => {
        apple({ submit: { status: 1, verdict: { id: 'submission-id', status: 'Invalid', message: 'Processing complete' } } });

        expect(() => notarizeApp('/dist/Demo.app', signed)).toThrow(/did not notarize Demo\.app \(Invalid: Processing complete\)\. Its log:\n.*not signed with a valid Developer ID/);
        expect(calls()).toContainEqual(['xcrun', 'notarytool', 'log', 'submission-id', ...credentials]);
        expect(calls().some(([, tool]) => tool === 'stapler')).toBe(false);
    });

    test("stops the build with notarytool's own words when it gives no verdict", () => {
        apple({ submit: { status: 1, stdout: '', stderr: 'Error: HTTP status code: 401. Unauthenticated.' } });

        expect(() => notarizeApp('/dist/Demo.app', signed)).toThrow('xcrun notarytool failed with exit code 1:\nError: HTTP status code: 401. Unauthenticated.');
    });

    test('staples again while the ticket reaches Apple\'s servers, three times at most', () => {
        apple({ staples: [65, 65, 0] });
        notarizeApp('/dist/Demo.app', signed);
        expect(calls().filter(([, tool]) => tool === 'stapler')).toHaveLength(3);
        expect(calls().filter(([command]) => command === 'sleep')).toEqual([['sleep', '15'], ['sleep', '15']]);

        spawnSync.mockClear();
        apple({ staples: [65, 65, 65] });
        expect(() => notarizeApp('/dist/Demo.app', signed)).toThrow('xcrun stapler failed with exit code 65:\nError 65');
    });
});
