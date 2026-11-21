import fs from 'node:fs';
import upath from 'upath';

// A web build as one ustar archive, which crossbind app preview --cloud streams to crossbind cloud
// (tooling/cloud/worker/snapshots.js): each regular file a header, its bytes and their padding, then the archive's end.
// Each file is read as the archive is sent, never the build whole.

const BLOCK = 512;
// The paths crossbind cloud keeps a snapshot's files at: plain names between slashes, none of them . or .., and none
// under __crossbind/, whose paths the crossbind app answers itself.
const PLAIN_PATH = /^([A-Za-z0-9_@.+-]+\/)*[A-Za-z0-9_@.+-]+$/;
const OWN_PATHS = '__crossbind/';
// A header holds a path of 100 characters, or one cut at a slash into a prefix of 155 and a name of 100.
const NAME_LENGTH = 100;
const PREFIX_LENGTH = 155;

const padding = (size) => (BLOCK - (size % BLOCK)) % BLOCK;

// [prefix, name] of a path as a header holds it, or null for a path no header holds.
function headerParts(path) {
    if (path.length <= NAME_LENGTH) return ['', path];
    for (let at = path.indexOf('/'); at !== -1 && at <= PREFIX_LENGTH; at = path.indexOf('/', at + 1)) {
        if (path.length - at - 1 <= NAME_LENGTH) return [path.slice(0, at), path.slice(at + 1)];
    }
    return null;
}

export const isSnapshotPath = (path) => PLAIN_PATH.test(path) && !path.startsWith(OWN_PATHS)
    && path.split('/').every((name) => name !== '.' && name !== '..') && headerParts(path) !== null;

// The header of a regular file of `size` bytes at `path`, as ustar writes it.
export function ustarHeader(path, size) {
    const [prefix, name] = headerParts(path);
    const block = Buffer.alloc(BLOCK);
    [[0, name], [100, '0000644\0'], [108, '0000000\0'], [116, '0000000\0'], [124, `${size.toString(8).padStart(11, '0')}\0`], [136, '00000000000\0'],
        [148, '        '], [156, '0'], [257, 'ustar\0'], [263, '00'], [345, prefix]].forEach(([at, text]) => block.write(text, at, 'ascii'));
    const sum = block.reduce((total, byte) => total + byte, 0);
    block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
    return block;
}

// The files of the web build in `dir`, by their paths in it, sorted: each a regular file at a path crossbind cloud takes,
// or the words that stop the upload before anything is sent.
export function webBuildFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
        const file = upath.join(entry.parentPath, entry.name);
        const path = upath.relative(dir, file);
        if (entry.isDirectory()) continue;
        if (!entry.isFile()) throw new Error(`crossbind: the web build's ${path} is not a file, and a snapshot holds files alone.`);
        if (!isSnapshotPath(path)) {
            throw new Error(`crossbind: the web build's ${JSON.stringify(path)} is at a path crossbind cloud keeps no snapshot's file at: letters, digits and _@.+- between slashes, none under ${OWN_PATHS}, ${NAME_LENGTH + PREFIX_LENGTH} characters at most. Rename it in the project.`);
        }
        files.push({ path, file, size: fs.statSync(file).size });
    }
    return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export const archiveLength = (files) => files.reduce((length, { size }) => length + BLOCK + size + padding(size), 2 * BLOCK);

// The archive of `files` as a stream of archiveLength(files) bytes, each file read as it is sent.
export function archiveStream(files) {
    return ReadableStream.from((async function* archive() {
        for (const { path, file, size } of files) {
            yield ustarHeader(path, size);
            yield* fs.createReadStream(file);
            if (padding(size) > 0) yield Buffer.alloc(padding(size));
        }
        yield Buffer.alloc(2 * BLOCK);
    }()));
}
