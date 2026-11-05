import fs from 'node:fs';
import path from 'node:path';
import { downloadFile, verifyIntegrity } from '../utils/downloadAndExtractFile.js';

// The Ubuntu 22.04 packages a Linux extension lists beside crossbind's sysroot: each downloaded once into the build's
// folder from Launchpad, as the sysroot's own are, checked against its SHA-256 and unpacked into a sysroot of the
// extension's own for the target, whose headers its sources include and whose libraries the host links against. Its
// users' systems load the libraries at run time, as the app's Debian package's Depends asks for them.

const DEBIAN_ARCH = { x64: 'amd64', arm64: 'arm64' };
const MULTIARCH = { x64: 'x86_64-linux-gnu', arm64: 'aarch64-linux-gnu' };

export const packageUrl = (file) => `https://launchpad.net/ubuntu/+archive/primary/+files/${file}`;

// The packages of the target's architecture among the lines an extension lists.
export function packagesFor(target, lines) {
    return lines.map((line) => line.split(' ')).filter(([arch]) => arch === DEBIAN_ARCH[target.arch]).map(([, file, sha256]) => ({ file, sha256 }));
}

// What a sysroot gives the target: the folders its sources include, usr/include and each folder in it, as a library's
// headers sit in one of its own, and the folder the host links from.
export function sysrootDirs(target, root) {
    const include = path.join(root, 'usr', 'include');
    const nested = fs.existsSync(include)
        ? fs.readdirSync(include, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(include, entry.name))
        : [];
    return { includes: [include, ...nested], libDir: path.join(root, 'usr', 'lib', MULTIARCH[target.arch]) };
}

// Unpacks each extension's packages for the target, with unpack(deb, folder), which crossbind's Linux image runs.
export async function unpackPackages(target, compiled, { cache, workDir, unpack }) {
    const sysroots = [];
    for (const { name, packages } of compiled.filter((part) => part.packages.length > 0)) {
        const own = packagesFor(target, packages);
        if (own.length === 0) throw new Error(`crossbind: the extension ${name} lists Linux packages, but none of ${DEBIAN_ARCH[target.arch]}, which an ${target.arch} app takes.`);
        const root = path.join(workDir, 'sysroot', name);
        fs.rmSync(root, { recursive: true, force: true });
        fs.mkdirSync(root, { recursive: true });
        for (const { file, sha256 } of own) {
            const url = packageUrl(file);
            const deb = await downloadFile(url, cache);
            verifyIntegrity(deb, url, sha256);
            unpack(deb, root);
        }
        sysroots.push({ name, ...sysrootDirs(target, root) });
    }
    return sysroots;
}
