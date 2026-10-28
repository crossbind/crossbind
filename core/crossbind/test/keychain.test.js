import { beforeEach, describe, expect, test, vi } from 'vitest';

const calls = [];
// A keychain that keeps the last password written, unless `failure` stands in for every answer.
let kept = null;
let failure = null;
const written = (program, options) => options.env?.CROSSBIND_KEYCHAIN_SECRET
    ?? (program === 'security' ? options.input?.match(/-w "((?:[^"\\]|\\.)*)"/)?.[1].replace(/\\(.)/g, '$1') : options.input);
const spawnSync = vi.fn((program, args, options = {}) => {
    calls.push({ program, args, options });
    if (failure) return failure;
    const secret = written(program, options);
    if (secret != null) {
        kept = secret;
        return { status: 0, stdout: '', stderr: '' };
    }
    if (kept === null) return { status: 44, stdout: '', stderr: 'The specified item could not be found in the keychain.' };
    return { status: 0, stdout: program === 'security' ? `${kept}\n` : kept, stderr: '' };
});
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));

const { readSecret, storeSecret } = await import('../src/utils/keychain.js');

const KEY = '/home/u/.crossbind/keys/android-upload.p12';
const SECRET = 'a "quoted" \\ secret';
// No secret reaches a command line, where any process of the machine can read it.
const argvHasNoSecret = () => calls.every(({ args }) => !args.join(' ').includes(SECRET));

beforeEach(() => {
    calls.length = 0;
    kept = null;
    failure = null;
});

describe("the keychain of an upload key's password", () => {
    test("on macOS is the login keychain, written through security's stdin", () => {
        expect(readSecret(KEY, { platform: 'darwin' })).toBe(null);
        expect(storeSecret(KEY, SECRET, { platform: 'darwin' })).toBe(true);
        const write = calls.find(({ args }) => args[0] === '-i');
        expect(write.program).toBe('security');
        expect(write.options.input).toBe(`add-generic-password -U -s "crossbind upload key" -a "${KEY}" -w "a \\"quoted\\" \\\\ secret"\n`);
        expect(readSecret(KEY, { platform: 'darwin' })).toBe(SECRET);
        expect(calls.at(-1).args).toEqual(['find-generic-password', '-s', 'crossbind upload key', '-a', KEY, '-w']);
        expect(argvHasNoSecret()).toBe(true);
    });

    test('counts a password kept only once it reads back, as security -i fails without an exit code', () => {
        spawnSync.mockImplementationOnce((program, args, options) => {
            calls.push({ program, args, options });
            return { status: 0, stdout: '', stderr: '' };
        });
        expect(storeSecret(KEY, SECRET, { platform: 'darwin' })).toBe(false);
    });

    test("on Linux is the Secret Service, through secret-tool's stdin", () => {
        expect(storeSecret(KEY, SECRET, { platform: 'linux' })).toBe(true);
        expect(calls[0].program).toBe('secret-tool');
        expect(calls[0].args).toEqual(['store', '--label', 'crossbind upload key', 'service', 'crossbind upload key', 'account', KEY]);
        expect(calls[0].options.input).toBe(SECRET);
        expect(readSecret(KEY, { platform: 'linux' })).toBe(SECRET);
        expect(calls.at(-1).args).toEqual(['lookup', 'service', 'crossbind upload key', 'account', KEY]);
        expect(argvHasNoSecret()).toBe(true);
    });

    test('on Linux without secret-tool or its service keeps nothing, so a build asks', () => {
        failure = { status: null, error: Object.assign(new Error('spawnSync secret-tool ENOENT'), { code: 'ENOENT' }) };
        expect(storeSecret(KEY, SECRET, { platform: 'linux' })).toBe(false);
        expect(readSecret(KEY, { platform: 'linux' })).toBe(null);
        failure = { status: 1, stdout: '', stderr: 'Cannot autolaunch D-Bus without X11 $DISPLAY' };
        expect(storeSecret(KEY, SECRET, { platform: 'linux' })).toBe(false);
    });

    test("on Windows is the user's DPAPI, beside the key, with the password in the environment", () => {
        expect(storeSecret(KEY, SECRET, { platform: 'win32' })).toBe(true);
        expect(calls[0].program).toBe('powershell.exe');
        expect(calls[0].args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command']);
        expect(calls[0].args[3]).toContain("Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security')");
        expect(calls[0].options.env).toMatchObject({ CROSSBIND_KEYCHAIN_SECRET: SECRET, CROSSBIND_KEYCHAIN_FILE: `${KEY}.dpapi` });
        expect(readSecret(KEY, { platform: 'win32' })).toBe(SECRET);
        expect(calls.at(-1).options.env.CROSSBIND_KEYCHAIN_FILE).toBe(`${KEY}.dpapi`);
        expect(calls.at(-1).options.env.CROSSBIND_KEYCHAIN_SECRET).toBe(undefined);
        expect(argvHasNoSecret()).toBe(true);
    });

    test('keeps another secret under a service of its own, as the Google sign-in Play takes uploads with', () => {
        expect(storeSecret(KEY, SECRET, { platform: 'darwin', service: 'crossbind google play' })).toBe(true);
        expect(calls[0].options.input).toContain('-s "crossbind google play" -a');
        expect(calls.at(-1).args).toEqual(['find-generic-password', '-s', 'crossbind google play', '-a', KEY, '-w']);
        expect(storeSecret(KEY, SECRET, { platform: 'linux', service: 'crossbind google play' })).toBe(true);
        expect(calls.at(-2).args).toEqual(['store', '--label', 'crossbind google play', 'service', 'crossbind google play', 'account', KEY]);
        expect(calls.at(-1).args).toEqual(['lookup', 'service', 'crossbind google play', 'account', KEY]);
    });
});
