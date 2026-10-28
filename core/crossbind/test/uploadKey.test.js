import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let home;
vi.mock('node:os', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, default: { ...real, homedir: () => home } };
});
// docker runs keytool, which makes the keystore it is asked for, or opens one with the password it was made with.
const calls = [];
let keystorePassword = 'kept-for-the-old-key';
const spawnSync = vi.fn((program, args, options) => {
    calls.push({ program, args, env: options.env });
    const keystore = args.at(args.indexOf('-keystore') + 1)?.replace('/keys', args[args.indexOf('-v') + 1].split(':/keys')[0]);
    if (args.includes('-genkeypair')) fs.writeFileSync(keystore, 'pkcs12');
    const isOpen = !args.includes('-list') || options.env.CROSSBIND_ANDROID_KEYSTORE_PASSWORD === keystorePassword;
    return isOpen ? { status: 0, stdout: '', stderr: '' } : { status: 1, stdout: 'keytool error: java.io.IOException: keystore password was incorrect', stderr: '' };
});
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));
vi.mock('../src/utils/pullDockerImage.js', () => ({ default: vi.fn(), getDockerImage: () => 'android-app-image' }));
vi.mock('../src/utils/getOsUserAndGroupId.js', () => ({ default: () => '1000:1000' }));
vi.mock('../src/state/index.js', () => ({ default: { config: { paths: {}, system: {} } } }));
const keychain = { kept: new Map(), has: true };
vi.mock('../src/utils/keychain.js', () => ({
    hasKeychain: () => keychain.has,
    storeSecret: (key, secret) => keychain.has && Boolean(keychain.kept.set(key, secret)),
    readSecret: (key) => keychain.kept.get(key) ?? null,
}));
const terminal = { isThere: true, lines: [], hidden: [] };
vi.mock('../src/utils/ask.js', () => ({
    hasTerminal: () => terminal.isThere,
    askLine: async () => terminal.lines.shift(),
    askHidden: async () => terminal.hidden.shift(),
}));

const { makeUploadKey, showUploadKeyPassword, uploadKeyFile, useUploadKey } = await import('../src/actions/uploadKey.js');

let printed;
const systemConfig = () => JSON.parse(fs.readFileSync(path.join(home, '.crossbind.json'), 'utf8'));
const keytool = () => calls.find(({ program }) => program === 'docker');

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-upload-key-'));
    calls.length = 0;
    keychain.kept.clear();
    keychain.has = true;
    Object.assign(terminal, { isThere: true, lines: [], hidden: [] });
    printed = [];
    vi.spyOn(console, 'log').mockImplementation((line) => printed.push(line));
    vi.spyOn(console, 'error').mockImplementation((line) => printed.push(line));
    vi.stubEnv('CROSSBIND_ANDROID_KEYSTORE_PASSWORD', '');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
});

describe("a machine's upload key", () => {
    test('is made by keytool in the android-app image, with no network, its folder alone, and the password by name', async () => {
        terminal.lines = ['1'];
        await makeUploadKey();

        const file = uploadKeyFile();
        const { args, env } = keytool();
        expect(file).toBe(path.join(home, '.crossbind', 'keys', 'android-upload.p12'));
        expect(args).toContain('--network');
        expect(args[args.indexOf('--network') + 1]).toBe('none');
        expect(args).toEqual(expect.arrayContaining(['-v', `${path.dirname(file)}:/keys`, '-e', 'CROSSBIND_ANDROID_KEYSTORE_PASSWORD', 'android-app-image']));
        expect(args.slice(args.indexOf('keytool'))).toEqual(['keytool', '-genkeypair', '-keystore', '/keys/android-upload.p12', '-storetype', 'PKCS12',
            '-alias', 'upload', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Android upload key',
            '-storepass:env', 'CROSSBIND_ANDROID_KEYSTORE_PASSWORD']);
        const password = env.CROSSBIND_ANDROID_KEYSTORE_PASSWORD;
        expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/);
        expect(args.join(' ')).not.toContain(password);
        if (process.platform !== 'win32') {
            expect(fs.statSync(file).mode & 0o777).toBe(0o600);
            expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
        }
        expect(keychain.kept.get(file)).toBe(password);
        expect(systemConfig()).toMatchObject({ ANDROID_KEYSTORE: file, ANDROID_KEY_ALIAS: 'upload' });
        expect(printed.filter((line) => line.includes(password))).toHaveLength(1);
        expect(printed.join('\n')).toContain('Google keeps only the key\'s certificate');
    });

    test('takes the password the user types, once it passes the rules and is typed twice the same', async () => {
        terminal.lines = ['2'];
        terminal.hidden = ['short', 'another good phrase', 'another good fraze', 'another good phrase', 'another good phrase'];
        await makeUploadKey();

        expect(keytool().env.CROSSBIND_ANDROID_KEYSTORE_PASSWORD).toBe('another good phrase');
        const said = printed.join('\n');
        expect(said).toContain('15 characters or more');
        expect(said).toContain('it has 5 characters and needs at least 15');
        expect(said).toContain('The two did not match.');
        expect(said).not.toContain('another good phrase');
    });

    test('takes its own password alone with --no-keychain, and keeps it nowhere', async () => {
        terminal.hidden = ['a long enough phrase', 'a long enough phrase'];
        await makeUploadKey({ isKeychain: false });

        expect(terminal.lines).toEqual([]);
        expect(keychain.kept.size).toBe(0);
        expect(printed.join('\n')).toContain('builds ask for its password, as no keychain keeps it');
    });

    test('takes its password from the environment without a terminal, held to the same rules', async () => {
        terminal.isThere = false;
        vi.stubEnv('CROSSBIND_ANDROID_KEYSTORE_PASSWORD', 'tiny');
        await expect(makeUploadKey()).rejects.toThrow('CROSSBIND_ANDROID_KEYSTORE_PASSWORD cannot lock an upload key: it has 4 characters');
        vi.stubEnv('CROSSBIND_ANDROID_KEYSTORE_PASSWORD', '');
        await expect(makeUploadKey()).rejects.toThrow('an upload key needs a password: run this on a terminal, which asks for one, or set CROSSBIND_ANDROID_KEYSTORE_PASSWORD');
        expect(calls).toHaveLength(0);
    });

    test('is never made over a key the machine has, or over a file there', async () => {
        fs.writeFileSync(path.join(home, '.crossbind.json'), JSON.stringify({ ANDROID_KEYSTORE: '/keys/old.p12' }));
        await expect(makeUploadKey()).rejects.toThrow("this machine's upload key is /keys/old.p12, and crossbind never makes another over it");
        fs.rmSync(path.join(home, '.crossbind.json'));
        fs.mkdirSync(path.dirname(uploadKeyFile()), { recursive: true });
        fs.writeFileSync(uploadKeyFile(), 'old');
        await expect(makeUploadKey()).rejects.toThrow(`${uploadKeyFile()} is there already, and crossbind never replaces an upload key`);
        expect(calls).toHaveLength(0);
    });

    test('can be one the user has, which opens with its password before the machine keeps it', async () => {
        const own = path.join(home, 'my-upload.jks');
        fs.writeFileSync(own, 'jks');
        terminal.hidden = ['wrong password'];
        await expect(useUploadKey(own, { alias: 'mykey' })).rejects.toThrow(`${own} did not open with that password and the alias mykey`);
        expect(fs.existsSync(path.join(home, '.crossbind.json'))).toBe(false);

        terminal.hidden = [keystorePassword];
        await useUploadKey(own, { alias: 'mykey' });
        const { args } = calls.at(-1);
        expect(args).toEqual(expect.arrayContaining(['-v', `${home}:/keys:ro`]));
        expect(args.slice(args.indexOf('keytool'))).toEqual(['keytool', '-list', '-keystore', '/keys/my-upload.jks', '-alias', 'mykey',
            '-storepass:env', 'CROSSBIND_ANDROID_KEYSTORE_PASSWORD']);
        expect(keychain.kept.get(own)).toBe(keystorePassword);
        expect(systemConfig()).toMatchObject({ ANDROID_KEYSTORE: own, ANDROID_KEY_ALIAS: 'mykey' });
    });

    test("shows the password the keychain keeps, for another machine or CI", async () => {
        expect(() => showUploadKeyPassword()).toThrow("this machine has no upload key: crossbind app upload-key makes one");
        terminal.lines = ['1'];
        await makeUploadKey();
        printed = [];
        showUploadKeyPassword();
        expect(printed).toEqual([keychain.kept.get(uploadKeyFile())]);
    });
});
