import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { packageUrl, packagesFor, sysrootDirs, unpackPackages } from '../src/actions/linuxPackages.js';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
const tempRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-packages-'));
    roots.push(root);
    return root;
};

const SHA = '971297916405f1f184ec0ee5f18734b448a80b45813fe40ff2e00b77609689e7';
const FILE = 'libzstd-dev_1.4.8+dfsg-3build1_amd64.deb';

describe("a Linux extension's packages", () => {
    test("come from Launchpad, those of the target's architecture alone", () => {
        expect(packageUrl(FILE)).toBe(`https://launchpad.net/ubuntu/+archive/primary/+files/${FILE}`);
        const lines = [`amd64 ${FILE} ${SHA}`, `arm64 libzstd-dev_1.4.8+dfsg-3build1_arm64.deb ${SHA}`];
        expect(packagesFor({ arch: 'x64' }, lines)).toEqual([{ file: FILE, sha256: SHA }]);
        expect(packagesFor({ arch: 'arm64' }, lines)).toEqual([{ file: 'libzstd-dev_1.4.8+dfsg-3build1_arm64.deb', sha256: SHA }]);
    });

    test("unpack into the extension's own sysroot, checked against their SHA-256, whose headers and libraries the build takes", async () => {
        const root = tempRoot();
        const cache = path.join(root, 'cache');
        fs.mkdirSync(cache);
        // The cache holds the file already, which no download replaces.
        fs.writeFileSync(path.join(cache, FILE), 'deb');
        const sha256 = crypto.createHash('sha256').update('deb').digest('hex');
        const unpacked = [];
        const unpack = (deb, folder) => {
            unpacked.push([deb, folder]);
            fs.mkdirSync(path.join(folder, 'usr', 'include', 'zstd-extra'), { recursive: true });
        };
        const workDir = path.join(root, 'work');
        const compiled = [{ name: 'probe', packages: [`amd64 ${FILE} ${sha256}`] }, { name: 'none', packages: [] }];
        const sysroots = await unpackPackages({ arch: 'x64' }, compiled, { cache, workDir, unpack });
        const own = path.join(workDir, 'sysroot', 'probe');
        // downloadFile names a file of its folder with a slash, on Windows too.
        expect(unpacked).toEqual([[`${cache}/${FILE}`, own]]);
        expect(sysroots).toEqual([{ name: 'probe', ...sysrootDirs({ arch: 'x64' }, own) }]);
        expect(sysroots[0].includes).toEqual([path.join(own, 'usr', 'include'), path.join(own, 'usr', 'include', 'zstd-extra')]);
        expect(sysroots[0].libDir).toBe(path.join(own, 'usr', 'lib', 'x86_64-linux-gnu'));
        await expect(unpackPackages({ arch: 'arm64' }, compiled, { cache, workDir, unpack }))
            .rejects.toThrow('crossbind: the extension probe lists Linux packages, but none of arm64, which an arm64 app takes.');
        await expect(unpackPackages({ arch: 'x64' }, [{ name: 'probe', packages: [`amd64 ${FILE} ${SHA}`] }], { cache, workDir, unpack }))
            .rejects.toThrow('crossbind: source integrity check failed');
    });
});
