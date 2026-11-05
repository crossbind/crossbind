import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: {} };
vi.mock('../src/state/index.js', () => ({ default: state }));
// ditto, which zips a macOS app.
const run = vi.fn();
vi.mock('../src/actions/run.js', () => ({ default: run }));

const {
    default: writeUpdate, UPDATER_KEY, newUpdaterKey, signedText, updaterSigning,
} = await import('../src/actions/appUpdate.js');

const URL = 'https://example.com/updates/demo-{platform}-{arch}.update.json';
// The DER before an Ed25519 public key's 32 bytes.
const PUBLIC_DER = Buffer.from('302a300506032b6570032100', 'hex');
// SHA-512 of "abc", FIPS 180-2's example.
const ABC_SHA512 = 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f';

const roots = [];
afterAll(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
beforeEach(() => {
    run.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const publicKeyOf = (base64) => crypto.createPublicKey({ key: Buffer.concat([PUBLIC_DER, Buffer.from(base64, 'base64')]), format: 'der', type: 'spki' });

// A project whose app.updater checks updates with publicKey, and the folder its apps are in.
function project(publicKey, version = '1.2.0') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-update-'));
    roots.push(root);
    Object.assign(state.config, { general: { name: 'demo' }, app: publicKey ? { updater: { url: URL, publicKey } } : {}, package: { version } });
    return root;
}

// Whether the key of app.updater.publicKey checks the signature in a manifest beside an app, as the host of the app
// with this id does.
function holds(root, name, target, file, id = 'dev.crossbind.demo') {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    const text = signedText(id, target, manifest.version, path.join(root, file));
    return crypto.verify(null, Buffer.from(text), publicKeyOf(state.config.app.updater.publicKey), Buffer.from(manifest.signature, 'base64'));
}

describe("a desktop app's update key", () => {
    test('is a pair whose private half signs what the public half checks', () => {
        const { publicKey, privateKey } = newUpdaterKey();
        expect(Buffer.from(publicKey, 'base64')).toHaveLength(32);
        expect(Buffer.from(privateKey, 'base64')).toHaveLength(32);
        project(publicKey);

        const signing = updaterSigning({ [UPDATER_KEY]: privateKey });

        expect(crypto.verify(null, Buffer.from('text'), publicKeyOf(publicKey), crypto.sign(null, Buffer.from('text'), signing.privateKey))).toBe(true);
        expect(signing.version).toBe('1.2.0');
    });

    test('signs nothing without CROSSBIND_UPDATER_PRIVATE_KEY', () => {
        project(newUpdaterKey().publicKey);
        expect(updaterSigning({})).toBeNull();
    });

    test("signs nothing where a publish's changes to the config removed app.updater for its build", () => {
        const { privateKey } = newUpdaterKey();
        project();
        expect(updaterSigning({ [UPDATER_KEY]: privateKey, CROSSBIND_CONFIG_CHANGES: '{"app":{"updater":null}}' })).toBeNull();
        expect(updaterSigning({ [UPDATER_KEY]: privateKey, CROSSBIND_CONFIG_CHANGES: '{"app":null}' })).toBeNull();
        expect(() => updaterSigning({ [UPDATER_KEY]: privateKey, CROSSBIND_CONFIG_CHANGES: '{"app":{"name":"Store"}}' })).toThrow('crossbind.config.js has no app.updater');
    });

    test('is refused without app.updater, when it is no key, and when app.updater.publicKey is not its public half', () => {
        const { publicKey, privateKey } = newUpdaterKey();
        project();
        expect(() => updaterSigning({ [UPDATER_KEY]: privateKey })).toThrow('crossbind.config.js has no app.updater');
        project(publicKey);
        expect(() => updaterSigning({ [UPDATER_KEY]: Buffer.from('short').toString('base64') })).toThrow('is no Ed25519 private key');
        expect(() => updaterSigning({ [UPDATER_KEY]: newUpdaterKey().privateKey })).toThrow('is not the private key of app.updater.publicKey');
    });
});

describe("a desktop app's update", () => {
    test("is signed over its app's id, its platform and arch, its version and its SHA-512", () => {
        const root = project();
        fs.writeFileSync(path.join(root, 'file'), 'abc');
        expect(signedText('com.example.app', 'linux-x64', '1.2.0', path.join(root, 'file')))
            .toBe(`crossbind update\ncom.example.app\nlinux-x64\n1.2.0\n${ABC_SHA512}\n`);
    });

    test("is the archive of a Linux app's tar-gz installer or the setup program of a Windows app's nsis one, beside a manifest the host checks it by", () => {
        const { publicKey, privateKey } = newUpdaterKey();
        const root = project(publicKey);
        vi.stubEnv(UPDATER_KEY, privateKey);
        fs.writeFileSync(path.join(root, 'demo-linux-x64.tar.gz'), 'a Linux app');
        fs.writeFileSync(path.join(root, 'demo-win32-arm64-setup.exe'), 'MZ');
        const made = (name, file) => ({ name, files: [path.join(root, file)] });

        writeUpdate(path.join(root, 'demo-linux-x64'), { platform: 'linux', arch: 'x64' }, [made('deb', 'demo-linux-x64.deb'), made('tar-gz', 'demo-linux-x64.tar.gz')]);
        writeUpdate(path.join(root, 'demo-win32-arm64'), { platform: 'win32', arch: 'arm64' }, [made('zip', 'demo-win32-arm64.zip'), made('nsis', 'demo-win32-arm64-setup.exe')]);
        expect(() => writeUpdate(path.join(root, 'demo-linux-x64'), { platform: 'linux', arch: 'x64' }, [{ name: 'tar-gz', files: [] }]))
            .toThrow(`crossbind: the tar-gz installer made no file of ${path.join(root, 'demo-linux-x64')} for its update.`);

        expect(JSON.parse(fs.readFileSync(path.join(root, 'demo-linux-x64.update.json'), 'utf8')))
            .toEqual({ version: '1.2.0', file: 'demo-linux-x64.tar.gz', signature: expect.any(String) });
        expect(holds(root, 'demo-linux-x64.update.json', 'linux-x64', 'demo-linux-x64.tar.gz')).toBe(true);
        expect(holds(root, 'demo-win32-arm64.update.json', 'win32-arm64', 'demo-win32-arm64-setup.exe')).toBe(true);
        // Another platform's update does not pass for this one, nor another app's that the same key signed.
        expect(holds(root, 'demo-win32-arm64.update.json', 'win32-x64', 'demo-win32-arm64-setup.exe')).toBe(false);
        expect(holds(root, 'demo-linux-x64.update.json', 'linux-x64', 'demo-linux-x64.tar.gz', 'dev.crossbind.other')).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    test("is a macOS app zipped with ditto, which keeps its signature and Apple's ticket", () => {
        const { publicKey, privateKey } = newUpdaterKey();
        const root = project(publicKey, '2.0.0-beta.1');
        vi.stubEnv(UPDATER_KEY, privateKey);
        run.mockImplementation((_, command) => fs.writeFileSync(command.at(-1), 'a zipped app'));
        const target = { platform: 'darwin', arch: 'arm64' };

        writeUpdate(path.join(root, 'demo.app'), target);

        expect(run).toHaveBeenCalledWith(null, ['ditto', '-c', '-k', '--keepParent', path.join(root, 'demo.app'), path.join(root, 'demo-darwin-arm64.app.zip')], null, target);
        expect(JSON.parse(fs.readFileSync(path.join(root, 'demo-darwin-arm64.update.json'), 'utf8')))
            .toEqual({ version: '2.0.0-beta.1', file: 'demo-darwin-arm64.app.zip', signature: expect.any(String) });
        expect(holds(root, 'demo-darwin-arm64.update.json', 'darwin-arm64', 'demo-darwin-arm64.app.zip')).toBe(true);
    });

    test('is not written without a key', () => {
        const root = project(newUpdaterKey().publicKey);
        fs.writeFileSync(path.join(root, 'demo-linux-x64.tar.gz'), 'a Linux app');

        writeUpdate(path.join(root, 'demo.app'), { platform: 'darwin', arch: 'arm64' });
        writeUpdate(path.join(root, 'demo-linux-x64'), { platform: 'linux', arch: 'x64' });

        expect(fs.readdirSync(root)).toEqual(['demo-linux-x64.tar.gz']);
        expect(run).not.toHaveBeenCalled();
    });
});
