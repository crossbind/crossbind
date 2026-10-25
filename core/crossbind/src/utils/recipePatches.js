import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getContentHash } from './hash.js';

const patchPath = (file) => (file instanceof URL ? fileURLToPath(file) : file);

// Inside the tree, which every extraction replaces whole: a tree says it is patched only once its own patches went in,
// so neither one a patch failed on nor one a stopped run left behind passes, whatever stamp an earlier tree had.
const stampOf = (buildPath) => path.join(buildPath, 'source', '.crossbind-patches');

export function recipePatchesFingerprint(patches) {
    if (!patches?.length) return null;
    return getContentHash(JSON.stringify(patches.map(({ file }) => fs.readFileSync(patchPath(file), 'utf8'))));
}

// downloadAndExtractFile keeps a tree whose archive still matches, so a tree patched under another set
// would keep its old patches or miss the new ones: it is extracted again instead.
export function refreshPatchedSource(buildPath, patches) {
    const stamp = stampOf(buildPath);
    const recorded = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8') : '';
    if (recorded !== (recipePatchesFingerprint(patches) ?? '')) {
        fs.rmSync(path.join(buildPath, 'source'), { recursive: true, force: true });
    }
}

export function writePatchedSourceStamp(buildPath, patches) {
    const fingerprint = recipePatchesFingerprint(patches);
    if (fingerprint) fs.writeFileSync(stampOf(buildPath), fingerprint);
    else fs.rmSync(stampOf(buildPath), { force: true });
}

// git apply is atomic and refuses a hunk whose context does not match, so a source the patch no longer
// fits stops the build instead of shipping unpatched. It works on the files alone: a repository named in the
// environment, as a git hook passes on, would make it skip every path, and one the downloaded tree carries could run
// its filters on the host, so GIT_DIR names none. autocrlf, which Git for Windows sets, would give the patched files
// CRLF endings.
export function applyRecipePatches(sourcePath, patches) {
    const env = {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
        GIT_DIR: `${sourcePath}.no-repository`,
    };
    for (const { file } of patches ?? []) {
        const patch = patchPath(file);
        try {
            execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', '--whitespace=nowarn', '--', patch], {
                cwd: sourcePath,
                stdio: ['ignore', 'pipe', 'pipe'],
                env,
            });
        } catch (error) {
            if (error.code === 'ENOENT') throw new Error(`crossbind: applying ${path.basename(patch)} needs git on the PATH.`, { cause: error });
            throw new Error(
                `crossbind: ${path.basename(patch)} does not apply to the extracted source. A recipe's patches are diffs against the release it pins: `
                + `drop the patch once a release includes it.\n${String(error.stderr ?? error.message).trim()}`,
                { cause: error },
            );
        }
    }
}
