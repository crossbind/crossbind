import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

const state = { config: { paths: {} } };
vi.mock('../src/state/index.js', () => ({ default: state }));
// docker, which runs jsign and makensis in the windows image.
const spawnSync = vi.fn();
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));
const pullDockerImage = vi.fn();
vi.mock('../src/utils/pullDockerImage.js', async (importOriginal) => ({
    ...await importOriginal(), default: pullDockerImage, getDockerImage: () => 'crossbind/windows:test',
}));
vi.mock('../src/utils/getOsUserAndGroupId.js', () => ({ default: () => '1000:1000' }));

const {
    inWindowsImage, jsignScript, signWindows, windowsSigning,
} = await import('../src/actions/windowsSigning.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-windows-signing-'));
const keystore = path.join(root, 'key.p12');
const certfile = path.join(root, 'chain.p7b');
fs.writeFileSync(keystore, 'key');
fs.writeFileSync(certfile, 'chain');
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
    state.config.paths = { base: root };
    spawnSync.mockReset();
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
});

describe('the key that signs a Windows app', () => {
    test('is none without a store type, so the app is not signed', () => {
        expect(windowsSigning({})).toBeNull();
    });

    test('is a cloud key named by the environment, or a key file the container reads mounted', () => {
        expect(windowsSigning({
            CROSSBIND_WINDOWS_SIGNING_STORETYPE: 'trustedsigning',
            CROSSBIND_WINDOWS_SIGNING_KEYSTORE: 'weu.codesigning.azure.net',
            CROSSBIND_WINDOWS_SIGNING_ALIAS: 'account/profile',
            CROSSBIND_WINDOWS_SIGNING_STOREPASS: 'token',
        })).toEqual({
            names: ['CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'CROSSBIND_WINDOWS_SIGNING_KEYSTORE', 'CROSSBIND_WINDOWS_SIGNING_ALIAS', 'CROSSBIND_WINDOWS_SIGNING_STOREPASS'],
            files: {},
        });
        expect(windowsSigning({
            CROSSBIND_WINDOWS_SIGNING_STORETYPE: 'PKCS12', CROSSBIND_WINDOWS_SIGNING_KEYSTORE: keystore, CROSSBIND_WINDOWS_SIGNING_CERTFILE: certfile,
        }).files).toEqual({ keystore, certfile });
    });

    test('stops the build for a key without a store type, a hardware token, or a key file that is not there', () => {
        expect(() => windowsSigning({ CROSSBIND_WINDOWS_SIGNING_STOREPASS: 'pass' }))
            .toThrow('CROSSBIND_WINDOWS_SIGNING_STOREPASS is set without CROSSBIND_WINDOWS_SIGNING_STORETYPE');
        expect(() => windowsSigning({ CROSSBIND_WINDOWS_SIGNING_STORETYPE: 'YUBIKEY' }))
            .toThrow("is a hardware token, which crossbind's windows container does not reach");
        expect(() => windowsSigning({ CROSSBIND_WINDOWS_SIGNING_STORETYPE: 'PKSC12' }))
            .toThrow('CROSSBIND_WINDOWS_SIGNING_STORETYPE PKSC12 is no store type jsign takes: PKCS12, JKS, JCEKS, AWS');
        expect(() => windowsSigning({ CROSSBIND_WINDOWS_SIGNING_STORETYPE: 'PKCS12' }))
            .toThrow('CROSSBIND_WINDOWS_SIGNING_KEYSTORE names nothing, which is no file.');
        expect(() => windowsSigning({ CROSSBIND_WINDOWS_SIGNING_STORETYPE: 'TRUSTEDSIGNING', CROSSBIND_WINDOWS_SIGNING_CERTFILE: path.join(root, 'missing.p7b') }))
            .toThrow('which is no file');
    });
});

// The container's paths are POSIX ones, as run() makes them; a Windows host makes them with backslashes.
describe.skipIf(process.platform === 'win32')('the windows image', () => {
    const signing = {
        names: ['CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'CROSSBIND_WINDOWS_SIGNING_KEYSTORE', 'CROSSBIND_WINDOWS_SIGNING_STOREPASS'],
        files: { keystore },
    };

    test('runs a command on the project, with the key file mounted read-only and the other variables passed by name', () => {
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_STOREPASS', 'a-secret-password');
        signWindows([path.join(root, 'dist/demo-win32-x64/demo.exe')], signing);
        vi.unstubAllEnvs();

        // The password reaches docker by name, from the environment it inherits.
        expect(JSON.stringify(spawnSync.mock.calls[0])).not.toContain('a-secret-password');
        expect(spawnSync.mock.calls[0][2].env).toBeUndefined();

        expect(pullDockerImage).toHaveBeenCalledWith('windows');
        expect(spawnSync).toHaveBeenCalledWith('docker', [
            'run', '--rm', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--user', '1000:1000', '-v', `${root}:/tmp/crossbind/live`,
            '-v', `${keystore}:/run/crossbind/signing/keystore:ro`, '-e', 'CROSSBIND_WINDOWS_SIGNING_KEYSTORE=/run/crossbind/signing/keystore',
            '-e', 'CROSSBIND_WINDOWS_SIGNING_STORETYPE', '-e', 'CROSSBIND_WINDOWS_SIGNING_STOREPASS',
            '-e', 'LC_ALL=C.UTF-8',
            '-w', '/tmp/crossbind/live/dist/demo-win32-x64',
            'crossbind/windows:test',
            'sh', jsignScript(), '/tmp/crossbind/live/dist/demo-win32-x64/demo.exe',
        ], expect.anything());
        expect(fs.existsSync(jsignScript())).toBe(true);
    });

    test('runs without a key as well, and stops the build with the end of what failed', () => {
        spawnSync.mockReturnValue({ status: 1, stdout: 'Section: ""\n', stderr: 'Error: resolving dist/demo.exe\n' });

        expect(() => inWindowsImage(['makensis', 'installer.nsi'], path.join(root, 'dist')))
            .toThrow('crossbind: makensis failed in the windows image with exit code 1:\nSection: ""\nError: resolving dist/demo.exe');
        expect(spawnSync.mock.calls[0][1].filter((arg) => arg.startsWith('CROSSBIND_'))).toEqual([]);
        expect(() => signWindows([path.join(root, 'dist/demo.exe')], signing)).toThrow('crossbind: jsign failed in the windows image');
    });
});

// jsign.sh runs in the image's POSIX shell; here a stand-in jsign prints what it is given.
describe.skipIf(process.platform === 'win32')("the image's signing script", () => {
    test('passes each variable as one argument, and the passwords by name alone', async () => {
        const { execFileSync } = await vi.importActual('node:child_process');
        const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-jsign-'));
        fs.writeFileSync(path.join(bin, 'jsign'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
        const secret = 'a pass with $HOME, * and "quotes"';
        try {
            const out = execFileSync('sh', [jsignScript(), 'C:\\no such.exe'], {
                encoding: 'utf8',
                env: {
                    PATH: `${bin}:${process.env.PATH}`,
                    CROSSBIND_WINDOWS_SIGNING_STORETYPE: 'PKCS12',
                    CROSSBIND_WINDOWS_SIGNING_KEYSTORE: '/run/crossbind/signing/keystore',
                    CROSSBIND_WINDOWS_SIGNING_ALIAS: 'crossbind e2e',
                    CROSSBIND_WINDOWS_SIGNING_STOREPASS: secret,
                },
            });
            expect(out.split('\n').slice(0, -1)).toEqual([
                '--quiet', '--storetype', 'PKCS12', '--keystore', '/run/crossbind/signing/keystore', '--alias', 'crossbind e2e',
                '--storepass', 'env:CROSSBIND_WINDOWS_SIGNING_STOREPASS', '--tsmode', 'RFC3161', '--tsaurl', 'http://timestamp.digicert.com',
                'C:\\no such.exe',
            ]);
        } finally {
            fs.rmSync(bin, { recursive: true, force: true });
        }
    });

    test('signs the uninstaller and the setup program as NSIS writes them, when crossbind defines SIGNER', () => {
        const script = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'installers', 'nsis', 'installer.nsi'), 'utf8');
        expect(script).toContain('!ifdef SIGNER\n  !uninstfinalize \'sh "${SIGNER}" "%1"\' = 0\n  !finalize \'sh "${SIGNER}" "%1"\' = 0\n!endif');
    });
});
