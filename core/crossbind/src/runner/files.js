import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Shared by the client (utils/remoteClient.js) and the runner (server.js). The runner reaches the toolchain
// image as this folder alone, mounted or copied in, so nothing here may import from outside it.

export const sha256Of = (data) => crypto.createHash('sha256').update(data).digest('hex');

// `rel` is relative to the root being walked, so a root that itself sits in node_modules (an installed port) still counts.
export function isExcluded(rel, rules) {
    if (rel.split('/').some((segment) => rules.dirs.includes(segment))) return true;
    return rules.extensions.includes(path.posix.extname(rel));
}

// Segment by segment: `*` matches any one segment, `*.a` any segment with that ending.
export function matchesPattern(rel, pattern) {
    const parts = rel.split('/');
    const wanted = pattern.split('/');
    return parts.length === wanted.length && wanted.every((want, i) => want === '*'
        || (want.startsWith('*.') ? parts[i].endsWith(want.slice(1)) : want === parts[i]));
}

// A build tree such as a cargo target folder stays on the runner: a sync walk skips it, so it is neither
// uploaded nor deleted, and an output walk returns only the artifacts its `keep` patterns name.
function isServerOnly(base, rel, rules) {
    const serverOnly = rules.serverOnly;
    if (!serverOnly?.names.includes(path.posix.basename(rel))) return false;
    return fs.existsSync(path.join(base, path.posix.dirname(rel), serverOnly.marker));
}

// Every file below the roots that the rules keep, keyed by its path relative to base, and every folder:
// the host creates folders before a step writes into them, empty ones included.
export function walk(base, roots, rules, { outputs = false } = {}) {
    const files = new Map();
    const dirs = [];
    const visit = (rel, inRoot, serverOnlyRoot) => {
        let stat;
        try {
            stat = fs.statSync(path.join(base, rel));
        } catch {
            return;
        }
        if (stat.isFile()) {
            const kept = serverOnlyRoot === null
                || rules.serverOnly.keep.some((pattern) => matchesPattern(rel.slice(serverOnlyRoot.length + 1), pattern));
            if (kept) files.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs, mode: stat.mode & 0o777 });
            return;
        }
        if (!stat.isDirectory()) return;
        let insideServerOnly = serverOnlyRoot;
        if (insideServerOnly === null && isServerOnly(base, rel, rules)) {
            if (!outputs) return;
            insideServerOnly = rel;
        }
        if (insideServerOnly === null) dirs.push(rel);
        for (const name of fs.readdirSync(path.join(base, rel)).sort()) {
            const childInRoot = inRoot ? `${inRoot}/${name}` : name;
            if (!isExcluded(childInRoot, rules)) visit(rel === '.' ? name : `${rel}/${name}`, childInRoot, insideServerOnly);
        }
    };
    roots.forEach((root) => visit(root, '', null));
    return { files, dirs };
}

export const snapshot = (base, roots, rules, options) => walk(base, roots, rules, options).files;

// Hashes reused while size and mtime are unchanged; `index` is updated in place and pruned to `files`.
export function hashIndex(base, files, index) {
    const hashes = new Map();
    for (const [rel, meta] of files) {
        const cached = index.get(rel);
        const sha256 = cached && cached.size === meta.size && cached.mtimeMs === meta.mtimeMs
            ? cached.sha256
            : sha256Of(fs.readFileSync(path.join(base, rel)));
        index.set(rel, { size: meta.size, mtimeMs: meta.mtimeMs, sha256 });
        hashes.set(rel, sha256);
    }
    [...index.keys()].filter((rel) => !files.has(rel)).forEach((rel) => index.delete(rel));
    return hashes;
}

// A `*` segment stands for every folder at that level, so `b/*/p` names each conan package folder that exists.
export function expandRoots(base, roots) {
    const step = (partials, segment) => partials.flatMap((partial) => {
        if (segment !== '*') return [partial ? `${partial}/${segment}` : segment];
        const dir = path.join(base, partial);
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => (partial ? `${partial}/${entry.name}` : entry.name))
            .sort();
    });
    return roots.flatMap((root) => root.split('/').reduce(step, ['']));
}

// The store units a machine already holds (a crate version, a conan package folder). They never change once
// written, so the runner sends only the units missing there.
export function presentUnits(base, outputRoots) {
    return expandRoots(base, outputRoots.filter((root) => root.includes('*'))).filter((unit) => {
        try {
            return fs.readdirSync(path.join(base, unit)).length > 0;
        } catch {
            return false;
        }
    });
}

export function planSync(current, manifest) {
    const write = Object.entries(manifest).filter(([rel, entry]) => current.get(rel) !== entry.sha256).map(([rel]) => rel);
    const remove = [...current.keys()].filter((rel) => !(rel in manifest));
    return { write, remove };
}

// Written files get the current time as mtime, so make and ninja rebuild what depends on them.
export function applySync(base, plan, manifest, blobPathOf) {
    plan.remove.forEach((rel) => fs.rmSync(path.join(base, rel), { force: true }));
    plan.write.forEach((rel) => {
        const dest = path.join(base, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.rmSync(dest, { force: true });
        fs.copyFileSync(blobPathOf(manifest[rel].sha256), dest);
        fs.chmodSync(dest, manifest[rel].mode ?? 0o644);
    });
}

export function diffSnapshots(before, after) {
    const changed = [...after].filter(([rel, meta]) => {
        const old = before.get(rel);
        return !old || old.size !== meta.size || old.mtimeMs !== meta.mtimeMs;
    }).map(([rel]) => rel);
    const removed = [...before.keys()].filter((rel) => !after.has(rel));
    return { changed, removed };
}

// The runner names files by container path; only a path inside one of the step's mounts maps back,
// so the runner cannot make the client write anywhere else.
export function hostPathOf(mounts, containerPath) {
    const isClean = path.posix.normalize(containerPath) === containerPath;
    const mount = isClean && mounts.find((m) => containerPath.startsWith(`${m.container}/`));
    if (!mount) throw new Error(`crossbind: the remote runner returned ${containerPath}, outside the mounts it was given.`);
    const rel = containerPath.slice(mount.container.length + 1);
    return { mount, rel, file: path.join(mount.host, rel) };
}
