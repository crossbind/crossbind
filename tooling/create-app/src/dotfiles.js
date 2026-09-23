import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// npm leaves every .gitignore and .npmignore out of a published tarball, so a template also
// carries a copy under these names, which the scaffolder restores. The originals must stay:
// npm applies their rules while packing, which keeps a sample's untracked build output out.
const PACKED_NAMES = [
    ['.gitignore', '_gitignore'],
    ['.npmignore', '_npmignore'],
];

async function forEachPresent(dir, pairs, operation) {
    for (const [from, to] of pairs) {
        const file = path.join(dir, from);
        if (fs.existsSync(file)) await operation(file, path.join(dir, to));
    }
}

export const packDotfiles = (dir) => forEachPresent(dir, PACKED_NAMES, fsp.copyFile);

export const unpackDotfiles = (dir) => forEachPresent(dir, PACKED_NAMES.map(([name, packed]) => [packed, name]), fsp.rename);
