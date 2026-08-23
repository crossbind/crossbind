import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import withDirLock from './dirLock.js';
import fetchOciLayer from './ociArtifact.js';
import { cargoRunner } from './runCargo.js';
import { isMtWasm } from './rustMt.js';
import PIN from './rustSysrootPin.js';

// The second consumption channel for the Rust sysroots. A containerized build gets them as an image
// layer; a host build (RUNNER=LOCAL) reads that SAME layer straight out of the registry over plain
// HTTPS. Not a repackaged copy hosted somewhere else - the same object, so the two channels cannot
// drift, and there is no second artifact to publish, verify or forget to delete.
//
// Everything hangs off one pinned index digest. Verify before unpacking, never let the archive
// choose where its files land, and key the cache by digest so two versions coexist.

const SCHEMA = 1;

export function sysrootRoot() {
    return path.join(os.homedir(), '.crossbind', 'rust-sysroot');
}

// The rlibs carry the producing compiler's metadata hash: a sysroot is only consumable by the
// exact rustc that built it, so the manifest is checked against the host before anything links.
export function hostRustc() {
    const probe = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
    if (probe.status !== 0) {
        throw new Error('crossbind: rustc not found on PATH - install Rust (https://rustup.rs) to build Rust packages.');
    }
    const read = (key) => probe.stdout.match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1]?.trim();
    return { version: read('release'), commit: read('commit-hash') };
}

export function assertManifest(manifest, host = hostRustc()) {
    if (manifest?.schema !== SCHEMA) {
        throw new Error(`crossbind: rust sysroot manifest schema ${manifest?.schema ?? '(missing)'} is not supported (expected ${SCHEMA}).`);
    }
    for (const variant of ['st', 'mt']) {
        if (!manifest.variants?.[variant]) {
            throw new Error(`crossbind: rust sysroot artifact is missing the '${variant}' variant.`);
        }
    }
    if (manifest.rustc !== host.version || manifest.rustcCommit !== host.commit) {
        throw new Error(
            'crossbind: the rust sysroot artifact was built by a different compiler than the one on PATH.\n'
            + `  artifact: rustc ${manifest.rustc} (${String(manifest.rustcCommit).slice(0, 12)})\n`
            + `  host:     rustc ${host.version} (${String(host.commit).slice(0, 12)})\n`
            + 'Prebuilt rlibs are only consumable by the exact compiler that produced them - install the pinned toolchain.',
        );
    }
    return manifest;
}

function readManifest(dir) {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
}

// The archive is an image filesystem export, so the tree sits at opt/crossbind/rust/<version>.
function findSysrootTree(extracted) {
    const versions = path.join(extracted, 'opt', 'crossbind', 'rust');
    const entries = fs.existsSync(versions) ? fs.readdirSync(versions) : [];
    const found = entries
        .map((version) => path.join(versions, version))
        .find((dir) => fs.existsSync(path.join(dir, 'manifest.json')));
    if (!found) {
        throw new Error('crossbind: the rust sysroot archive contains no opt/crossbind/rust/<version>/manifest.json.');
    }
    return found;
}

// An archive is untrusted input even when its digest checks out: the digest says "these are the
// bytes that were published", not "these bytes are harmless". Entries are listed first and anything
// that could write outside the staging directory is refused before a single file is created.
function extractTo(archive, work) {
    const list = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (list.status !== 0) {
        throw new Error(`crossbind: cannot read the sysroot archive: ${(list.stderr || '').trim() || `tar exited ${list.status}`}`);
    }
    const escaping = list.stdout.split('\n').map((e) => e.trim()).filter(Boolean)
        .filter((entry) => entry.startsWith('/') || entry.split('/').includes('..'));
    if (escaping.length) {
        throw new Error(`crossbind: the sysroot archive contains entries that escape the extraction directory: ${escaping.slice(0, 3).join(', ')}`);
    }
    fs.mkdirSync(work, { recursive: true });
    const tar = spawnSync('tar', ['-xzf', archive, '-C', work], { encoding: 'utf8' });
    if (tar.error) throw new Error(`crossbind: cannot run tar to extract ${archive}: ${tar.error.message}`);
    if (tar.status !== 0) {
        throw new Error(`crossbind: extracting the rust sysroot layer failed: ${(tar.stderr || '').trim() || `tar exited ${tar.status}`}`);
    }
}

// The architecture whose leaf to pull. The trees hold wasm rlibs either way, but they were produced
// by a host-arch rustc and the manifest records which - so take the leaf built for this machine.
const hostArch = () => (process.arch === 'arm64' ? 'arm64' : 'amd64');

// Returns the directory holding {st,mt,manifest.json}, fetched once per pinned index digest.
export default async function ensureRustSysroot({
    image, index, root = sysrootRoot(), host, arch = hostArch(),
}) {
    if (!image || !index) throw new Error('crossbind: a rust sysroot must be pinned by image and index digest.');
    const check = (manifest) => assertManifest(manifest, host ?? hostRustc());
    const dest = path.join(root, index.replace(':', '-'));
    if (fs.existsSync(path.join(dest, 'manifest.json'))) {
        check(readManifest(dest));
        return dest;
    }

    fs.mkdirSync(root, { recursive: true });
    return withDirLock(`${dest}.lock`, async () => {
        // Another build may have finished it while this one waited for the lock.
        if (fs.existsSync(path.join(dest, 'manifest.json'))) {
            check(readManifest(dest));
            return dest;
        }
        const work = fs.mkdtempSync(path.join(root, '.staging-'));
        try {
            const archive = path.join(work, 'layer.tar.gz');
            await fetchOciLayer({ image, index, arch, dest: archive });
            const extracted = path.join(work, 'extract');
            extractTo(archive, extracted);
            const tree = findSysrootTree(extracted);
            check(readManifest(tree));
            // Atomic: a reader either sees no directory at all or a complete, verified one.
            fs.renameSync(tree, dest);
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
        return dest;
    });
}

// The directory rustc's --sysroot is pointed at for a given runtime.
export function sysrootPath(dir, variant) {
    const target = path.join(dir, variant);
    if (!fs.existsSync(target)) {
        throw new Error(`crossbind: the rust sysroot at ${dir} has no '${variant}' variant.`);
    }
    return target;
}

// Resolved once per process. The download has to happen in an async step, but every consumer of
// the result - createLib, buildCargo, the bundler plugins - is synchronous, and threading a
// promise through them would mean making createLib and four plugins async for a case that only
// arises on RUNNER=LOCAL. So: prepare here, read synchronously below.
let resolved = null;

// Called from buildDependencies, the one async step every build path awaits before the sync work
// starts. Only downloads when a target will actually consume it.
export async function prepareRustSysroot(targets, log = console.log) {
    if (resolved || !PIN) return resolved;
    if (!targets.some((target) => isMtWasm(target) && cargoRunner(target) === 'LOCAL')) return null;
    try {
        resolved = await ensureRustSysroot({ image: PIN.image, index: PIN.index });
    } catch (e) {
        // A host on a different rustc, or a release that cannot be reached: mt still builds, the
        // slow way. Refusing here would take away a build that works today.
        log(`crossbind: prebuilt rust sysroot unavailable, falling back to the nightly std rebuild - ${e.message}`);
    }
    return resolved;
}

// What cargoBuildInvocation takes for `sysroot`: true where the image carries the trees, an
// absolute path where a downloaded artifact answers, false where mt must rebuild std on nightly.
// st needs nothing - rustup's stock std is already correct for it.
export function sysrootFor(target) {
    if (cargoRunner(target) !== 'LOCAL') return true;
    if (!isMtWasm(target)) return false;
    return resolved ?? false;
}
