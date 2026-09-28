import fs from 'node:fs';
import upath from 'upath';
import findFiles from './findFiles.js';
import { getContentHash, getFileHash } from './hash.js';

const EXCLUDED_DIRS = ['node_modules', '.crossbind', 'android', 'ios', 'build', 'dist', '.git'];

export function collectInputFiles(roots, exts, extraFiles = []) {
    // A single-entry brace set ({js}) is not brace-expanded by glob; use a plain suffix then.
    const pattern = exts.length === 1 ? `**/*.${exts[0]}` : `**/*.{${exts.join(',')}}`;
    const files = new Set();
    [...new Set(roots)].forEach((root) => {
        findFiles(pattern, {
            cwd: root,
            ignore: EXCLUDED_DIRS.map((dir) => `**/${dir}/**`),
        }).forEach((file) => files.add(file));
        const packageJson = upath.join(root, 'package.json');
        if (fs.existsSync(packageJson)) files.add(packageJson);
    });
    extraFiles.forEach((file) => files.add(upath.normalize(file)));
    return [...files].filter((file) => fs.existsSync(file)).sort();
}

// A cargo target dir holds build-script output, which changes on every build.
const RUST_EXCLUDED_DIRS = [...EXCLUDED_DIRS, 'target'];

// An app-local .rs file reaches its generated bridge through #[path], so the bridge text stays
// the same across a body edit: the sources themselves have to be stamped.
export function collectRustSources(roots) {
    const files = new Set();
    [...new Set(roots)].forEach((root) => {
        findFiles('**/*.rs', {
            cwd: root,
            ignore: RUST_EXCLUDED_DIRS.map((dir) => `**/${dir}/**`),
        }).forEach((file) => files.add(file));
    });
    return [...files].sort();
}

export function collectRustBridgeFiles(cacheDir) {
    return [
        ...findFiles('rust-bridges/*/{Cargo.toml,src/lib.rs}', { cwd: cacheDir }),
        ...findFiles('rust-crates/*.rs', { cwd: cacheDir }),
    ].sort();
}

export function computeInputStamp(roots, exts, extraFiles, salt) {
    const lines = collectInputFiles(roots, exts, extraFiles).map((file) => `${file}:${getFileHash(file)}`);
    lines.push(salt);
    return getContentHash(lines.join('\n'));
}
