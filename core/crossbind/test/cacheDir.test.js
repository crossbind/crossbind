import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import cacheDir from '../src/utils/cacheDir.js';

let home;
beforeEach(() => {
    home = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-cache-dir-')));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
});

const crossbind = (...parts) => upath.join(home, '.crossbind', ...parts);
const write = (file) => {
    fs.mkdirSync(upath.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
};
const EARLIER_CACHES = ['cargo', 'conan', 'conan-local', 'hermes', 'remote-index', 'rust-sysroot', 'sysroots', 'android/gradle'];
const KEPT = [
    'android/home/debug.keystore', 'credentials.json', 'docker-compile.lock', 'google-play', 'keys/android-upload.p12',
    'release.jks', 'secrets/demo-store/sign-in', 'vcpkg/store/x',
];

describe("crossbind's cache", () => {
    test('is a folder of ~/.crossbind/cache, which a machine new to crossbind does not have yet', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(upath.toUnix(cacheDir('cargo'))).toBe(crossbind('cache', 'cargo'));
        expect(fs.existsSync(crossbind())).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    test('takes the place of the caches earlier releases kept in ~/.crossbind, which it deletes, and keeps all else', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        [...EARLIER_CACHES.map((name) => `${name}/x`), ...KEPT].forEach((file) => write(crossbind(file)));

        expect(upath.toUnix(cacheDir('hermes'))).toBe(crossbind('cache', 'hermes'));
        expect(EARLIER_CACHES.filter((name) => fs.existsSync(crossbind(name)))).toEqual([]);
        expect(KEPT.filter((file) => !fs.existsSync(crossbind(file)))).toEqual([]);
        expect(warn.mock.calls.map(([line]) => upath.toUnix(line))).toEqual([
            `crossbind: deleted ${EARLIER_CACHES.join(', ')} in ${crossbind()}, the caches of earlier releases: builds download what they need again, into ${crossbind('cache')}.`,
        ]);
    });

    test('deletes nothing once ~/.crossbind/cache is there', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        write(crossbind('cache', 'cargo', 'x'));
        write(crossbind('hermes', 'x'));

        cacheDir('cargo');

        expect(fs.existsSync(crossbind('hermes', 'x'))).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    test('names an earlier cache it cannot delete, and goes on', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        write(crossbind('cargo', 'x'));
        write(crossbind('hermes', 'x'));
        const rm = fs.rmSync;
        vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
            if (upath.toUnix(target) === crossbind('hermes')) throw Object.assign(new Error('EACCES: permission denied, rmdir'), { code: 'EACCES' });
            return rm(target, options);
        });

        expect(upath.toUnix(cacheDir('cargo'))).toBe(crossbind('cache', 'cargo'));
        expect(fs.existsSync(crossbind('cargo'))).toBe(false);
        expect(warn.mock.calls.map(([line]) => upath.toUnix(line))).toEqual([
            `crossbind: ${crossbind('hermes')} could not be deleted (EACCES): delete it, as it is a cache of earlier releases.`,
            `crossbind: deleted cargo in ${crossbind()}, the caches of earlier releases: builds download what they need again, into ${crossbind('cache')}.`,
        ]);
    });

    test('says nothing of an earlier cache another build deleted first', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        write(crossbind('conan', 'store', 'x'));
        const rm = fs.rmSync;
        vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
            rm(target, options);
            throw Object.assign(new Error('ENOENT: no such file or directory, rmdir'), { code: 'ENOENT' });
        });

        cacheDir('conan');

        expect(fs.existsSync(crossbind('conan'))).toBe(false);
        expect(warn.mock.calls.map(([line]) => upath.toUnix(line))).toEqual([
            `crossbind: deleted conan in ${crossbind()}, the caches of earlier releases: builds download what they need again, into ${crossbind('cache')}.`,
        ]);
    });
});
