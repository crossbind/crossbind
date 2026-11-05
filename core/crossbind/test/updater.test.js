import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    afterAll, afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    UPDATER_KEY, appUpdater, checkUpdate, makeUpdate, newUpdaterKey, signedText, updaterSigning,
} from '../../../extensions/updater/src/update.js';

const URL = 'https://example.com/updates/demo-{platform}-{arch}.update.json';
// The DER before an Ed25519 public key's 32 bytes.
const PUBLIC_DER = Buffer.from('302a300506032b6570032100', 'hex');
// SHA-512 of "abc", FIPS 180-2's example.
const ABC_SHA512 = 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f';

const roots = [];
// ditto, which zips a macOS app.
const run = vi.fn();
afterAll(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
beforeEach(() => {
    run.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const publicKeyOf = (base64) => crypto.createPublicKey({ key: Buffer.concat([PUBLIC_DER, Buffer.from(base64, 'base64')]), format: 'der', type: 'spki' });

function folder() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-update-'));
    roots.push(root);
    return root;
}

// The api of a build of an app whose app.updater checks updates with publicKey, where a publisher's build made these changes.
const apiOf = ({
    platform = 'linux', publicKey, version = '1.2.0', changes = null,
} = {}) => ({
    platform,
    run,
    project: { name: 'demo' },
    publisherChanges: changes,
    config: { app: publicKey ? { updater: { url: URL, publicKey } } : {} },
    app: { id: 'dev.crossbind.demo', version },
});

// Whether the key checks the signature in a manifest beside an app, as the host of the app with this id does.
function holds(root, name, target, file, publicKey, id = 'dev.crossbind.demo') {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    const text = signedText(id, target, manifest.version, path.join(root, file));
    return crypto.verify(null, Buffer.from(text), publicKeyOf(publicKey), Buffer.from(manifest.signature, 'base64'));
}

describe("a desktop app's update key", () => {
    test('is a pair whose private half signs what the public half checks', () => {
        const { publicKey, privateKey } = newUpdaterKey();
        expect(Buffer.from(publicKey, 'base64')).toHaveLength(32);
        expect(Buffer.from(privateKey, 'base64')).toHaveLength(32);

        const signing = updaterSigning(apiOf({ publicKey }), { [UPDATER_KEY]: privateKey });

        expect(crypto.verify(null, Buffer.from('text'), publicKeyOf(publicKey), crypto.sign(null, Buffer.from('text'), signing.privateKey))).toBe(true);
        expect(signing.version).toBe('1.2.0');
    });

    test('signs nothing without CROSSBIND_UPDATER_PRIVATE_KEY', () => {
        expect(updaterSigning(apiOf({ publicKey: newUpdaterKey().publicKey }), {})).toBeNull();
    });

    test('names app.without where it leaves out the installer an update comes from', () => {
        const { publicKey } = newUpdaterKey();
        const api = apiOf({ publicKey });
        const leaving = { ...api, config: { app: { ...api.config.app, without: ['tar-gz'] } } };
        expect(() => checkUpdate(leaving, { installers: ['deb', 'updater'] })).toThrow('which app.without leaves out: take tar-gz out of it, or remove app.updater.');
    });

    test("signs nothing where a publisher's build removed app.updater", () => {
        const { privateKey } = newUpdaterKey();
        const env = { [UPDATER_KEY]: privateKey };
        expect(updaterSigning(apiOf({ changes: { app: { updater: null } } }), env)).toBeNull();
        expect(updaterSigning(apiOf({ changes: { app: null } }), env)).toBeNull();
        expect(() => updaterSigning(apiOf({ changes: { app: { name: 'Store' } } }), env)).toThrow('crossbind.config.js has no app.updater');
    });

    test('is refused without app.updater, when it is no key, and when app.updater.publicKey is not its public half', () => {
        const { publicKey, privateKey } = newUpdaterKey();
        expect(() => updaterSigning(apiOf(), { [UPDATER_KEY]: privateKey })).toThrow('crossbind.config.js has no app.updater');
        expect(() => updaterSigning(apiOf({ publicKey }), { [UPDATER_KEY]: Buffer.from('short').toString('base64') })).toThrow('is no Ed25519 private key');
        expect(() => updaterSigning(apiOf({ publicKey }), { [UPDATER_KEY]: newUpdaterKey().privateKey })).toThrow('is not the private key of app.updater.publicKey');
    });
});

describe("a desktop app's update", () => {
    test("is signed over its app's id, its platform and arch, its version and its SHA-512", () => {
        const root = folder();
        fs.writeFileSync(path.join(root, 'file'), 'abc');
        expect(signedText('com.example.app', 'linux-x64', '1.2.0', path.join(root, 'file')))
            .toBe(`crossbind update\ncom.example.app\nlinux-x64\n1.2.0\n${ABC_SHA512}\n`);
    });

    test("is the archive of a Linux app's tar-gz installer or the setup program of a Windows app's nsis one, beside a manifest the host checks it by", () => {
        const { publicKey, privateKey } = newUpdaterKey();
        const root = folder();
        vi.stubEnv(UPDATER_KEY, privateKey);
        fs.writeFileSync(path.join(root, 'demo-linux-x64.tar.gz'), 'a Linux app');
        fs.writeFileSync(path.join(root, 'demo-win32-arm64-setup.exe'), 'MZ');
        const installer = (name, file) => ({ name, files: [path.join(root, file)] });
        const linux = apiOf({ publicKey });
        const windows = apiOf({ publicKey, platform: 'windows' });

        const made = makeUpdate(linux, { app: path.join(root, 'demo-linux-x64'), arch: 'x64', made: [installer('deb', 'demo-linux-x64.deb'), installer('tar-gz', 'demo-linux-x64.tar.gz')] });
        makeUpdate(windows, { app: path.join(root, 'demo-win32-arm64'), arch: 'arm64', made: [installer('zip', 'demo-win32-arm64.zip'), installer('nsis', 'demo-win32-arm64-setup.exe')] });
        expect(() => makeUpdate(linux, { app: path.join(root, 'demo-linux-x64'), arch: 'x64', made: [{ name: 'tar-gz', files: [] }] }))
            .toThrow(`crossbind: the tar-gz installer made no file of ${path.join(root, 'demo-linux-x64')} for its update.`);

        expect(made).toEqual([path.join(root, 'demo-linux-x64.tar.gz'), path.join(root, 'demo-linux-x64.update.json')]);
        expect(JSON.parse(fs.readFileSync(path.join(root, 'demo-linux-x64.update.json'), 'utf8')))
            .toEqual({ version: '1.2.0', file: 'demo-linux-x64.tar.gz', signature: expect.any(String) });
        expect(holds(root, 'demo-linux-x64.update.json', 'linux-x64', 'demo-linux-x64.tar.gz', publicKey)).toBe(true);
        expect(holds(root, 'demo-win32-arm64.update.json', 'win32-arm64', 'demo-win32-arm64-setup.exe', publicKey)).toBe(true);
        // Another platform's update does not pass for this one, nor another app's that the same key signed.
        expect(holds(root, 'demo-win32-arm64.update.json', 'win32-x64', 'demo-win32-arm64-setup.exe', publicKey)).toBe(false);
        expect(holds(root, 'demo-linux-x64.update.json', 'linux-x64', 'demo-linux-x64.tar.gz', publicKey, 'dev.crossbind.other')).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    test("is a macOS app zipped with ditto, which keeps its signature and Apple's ticket", () => {
        const { publicKey, privateKey } = newUpdaterKey();
        const root = folder();
        vi.stubEnv(UPDATER_KEY, privateKey);
        run.mockImplementation((command) => fs.writeFileSync(command.at(-1), 'a zipped app'));

        makeUpdate(apiOf({ publicKey, platform: 'macos', version: '2.0.0-beta.1' }), { app: path.join(root, 'demo.app'), arch: 'arm64', made: [] });

        expect(run).toHaveBeenCalledWith(['ditto', '-c', '-k', '--keepParent', path.join(root, 'demo.app'), path.join(root, 'demo-darwin-arm64.app.zip')], { cwd: root });
        expect(JSON.parse(fs.readFileSync(path.join(root, 'demo-darwin-arm64.update.json'), 'utf8')))
            .toEqual({ version: '2.0.0-beta.1', file: 'demo-darwin-arm64.app.zip', signature: expect.any(String) });
        expect(holds(root, 'demo-darwin-arm64.update.json', 'darwin-arm64', 'demo-darwin-arm64.app.zip', publicKey)).toBe(true);
    });

    test('is not written without a key', () => {
        const { publicKey } = newUpdaterKey();
        const root = folder();
        fs.writeFileSync(path.join(root, 'demo-linux-x64.tar.gz'), 'a Linux app');

        expect(makeUpdate(apiOf({ publicKey, platform: 'macos' }), { app: path.join(root, 'demo.app'), arch: 'arm64', made: [] })).toEqual([]);
        expect(makeUpdate(apiOf({ publicKey }), { app: path.join(root, 'demo-linux-x64'), arch: 'x64', made: [] })).toEqual([]);

        expect(fs.readdirSync(root)).toEqual(['demo-linux-x64.tar.gz']);
        expect(run).not.toHaveBeenCalled();
    });

    test('stops a build whose installers leave out the one a Linux or Windows app updates itself from, saying who left it out', () => {
        const { publicKey } = newUpdaterKey();
        expect(() => checkUpdate(apiOf({ publicKey }), { installers: ['deb', 'updater'] })).toThrow('which app.installers leaves out: list tar-gz in it, or remove app.updater.');
        expect(() => checkUpdate(apiOf({ publicKey, platform: 'windows' }), { installers: ['zip'] })).toThrow('a Windows app with app.updater updates itself from what its nsis installer makes');
        expect(() => checkUpdate(apiOf({ publicKey, changes: { app: { installers: ['deb'] } } }), { installers: ['deb'] })).toThrow("which the publisher's build leaves out of app.installers");
        expect(() => checkUpdate(apiOf({ publicKey }), { installers: ['deb', 'tar-gz'] })).not.toThrow();
        expect(() => checkUpdate(apiOf({ publicKey, platform: 'macos' }), { installers: [] })).not.toThrow();
        expect(() => checkUpdate(apiOf(), { installers: [] })).not.toThrow();
    });
});

describe("a desktop app's updater", () => {
    // The api of an app with this app section and package.json's version, named demo-app or as it says.
    const config = (app = {}, version = '1.2.3', name = 'demo-app') => ({ config: { app }, project: { name }, app: { version } });
    const publicKey = Buffer.alloc(32, 7).toString('base64');
    const url = 'https://example.com/updates/demo-app-{platform}-{arch}.update.json';

    test('is none without app.updater', () => {
        expect(appUpdater(config())).toBeNull();
    });

    test("takes where the updates are and the key that checks them, with package.json's version", () => {
        expect(appUpdater(config({ updater: { url, publicKey } }, '1.2.3-beta.4'))).toEqual({ url, publicKey, version: '1.2.3-beta.4' });
    });

    test('takes an https address, or http on this machine alone', () => {
        for (const local of ['http://localhost:8080/u.json', 'http://127.0.0.1/u.json', 'http://[::1]/u.json']) {
            expect(appUpdater(config({ updater: { url: local, publicKey } })).url).toBe(local);
        }
        for (const bad of ['http://example.com/u.json', 'ftp://example.com/u.json', 'example.com/u.json', 'https://example.com/a b.json', 'https://example.com/"u".json', 42]) {
            expect(() => appUpdater(config({ updater: { url: bad, publicKey } }))).toThrow('is no https address');
        }
    });

    test("takes a manifest's address, beside which its file is, as the host can take it", () => {
        for (const bad of ['https://example.com', 'https://example.com?x=1', 'https://example.com/updates/', 'https://example.com/güncelleme.json']) {
            expect(() => appUpdater(config({ updater: { url: bad, publicKey } }))).toThrow('is no https address of a manifest');
        }
    });

    test('refuses a key of small order, whose signatures anyone can forge, whatever the sign of x', () => {
        const identity = Buffer.alloc(32);
        identity[0] = 1;
        identity[31] = 0x80;
        for (const key of [Buffer.alloc(32), identity]) {
            expect(() => appUpdater(config({ updater: { url, publicKey: key.toString('base64') } }))).toThrow('anyone can forge signatures for');
        }
    });

    test('takes the Ed25519 public key `crossbind app updater-key` prints, as it prints it', () => {
        for (const bad of [Buffer.alloc(31).toString('base64'), `${publicKey} `, publicKey.replace(/=$/, ''), undefined]) {
            expect(() => appUpdater(config({ updater: { url, publicKey: bad } }))).toThrow('is no Ed25519 public key');
        }
    });

    test('refuses an option it does not take', () => {
        expect(() => appUpdater(config({ updater: { url, publicKey, interval: 60 } }))).toThrow('interval is none of them');
        expect(() => appUpdater(config({ updater: url }))).toThrow('is no object of url and publicKey');
        expect(() => appUpdater(config({ updater: null }))).toThrow('is no object of url and publicKey');
    });

    test('needs a semver version in package.json to tell a newer one by', () => {
        for (const version of ['1.2', '1.2.3.4', '1.2.3-', '1.2.3-a..b', '1.2.3+', 'v1.2.3']) {
            expect(() => appUpdater(config({ updater: { url, publicKey } }, version))).toThrow('is no semver version');
        }
    });

    test('needs a general.name an app can fetch its update files by', () => {
        expect(() => appUpdater(config({ updater: { url, publicKey } }, '1.2.3', 'my app'))).toThrow('general.name "my app" names');
        expect(() => appUpdater(config({ updater: { url, publicKey } }, '1.2.3', '.hidden'))).toThrow('not starting with a dot');
    });
});
