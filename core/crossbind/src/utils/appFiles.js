import fs from 'node:fs';
import path from 'node:path';

// The first link a file or folder holds, by its path inside root, or none: an app carries no link, which could reach any
// file of the machine it is built on.
export function linkIn(full, root) {
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) return path.relative(root, full);
    if (!stat.isDirectory()) return null;
    for (const entry of fs.readdirSync(full)) {
        const found = linkIn(path.join(full, entry), root);
        if (found) return found;
    }
    return null;
}

// Whether a path leads out of root, as a relative one of .. does.
export const isOutside = (relative) => relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

const LINKED = 'an app carries no link, which could reach any file of the machine it is built on';

// A file or folder a list of the files an app carries names, relative to root as it is written there, which whose names:
// inside root, as the system reaches it through any link on the way, and holding no link.
export function carriedPath(where, root, file, whose) {
    const full = path.resolve(root, String(file));
    const relative = path.relative(root, full);
    if (typeof file !== 'string' || path.isAbsolute(file) || isOutside(relative) || relative === '') {
        throw new Error(`crossbind: ${where} names ${JSON.stringify(file)}, which is no path inside the ${whose} folder.`);
    }
    if (!fs.existsSync(full)) throw new Error(`crossbind: ${where} names ${file}, which is no file or folder of the ${whose}.`);
    const real = path.relative(fs.realpathSync(root), fs.realpathSync(full));
    if (isOutside(real) || real === '') throw new Error(`crossbind: ${where} names ${file}, which a link leads out of the ${whose} folder: ${LINKED}.`);
    const link = linkIn(full, root);
    if (link) throw new Error(`crossbind: ${where} names ${file}, which holds the link ${link}: ${LINKED}.`);
    return relative;
}

// Each file the lists name, those in their folders too, by its full path: what a build fingerprints by its size and
// time, as a large model would take long to read at each build.
export function carriedFilesOf(extensions, app) {
    const filesOf = (full) => (fs.statSync(full).isDirectory()
        ? fs.readdirSync(full).flatMap((entry) => filesOf(path.join(full, entry)))
        : [full]);
    return [...extensions.flatMap(({ root, paths }) => paths.map((file) => path.join(root, file))), ...app.paths.map((file) => path.join(app.root, file))]
        .flatMap(filesOf);
}

// What an app carries beside its page: each extension's files in ext/<name>/ and the app's own in files/, each in the
// place it had in its folder, as clones where the file system makes them, as each part of a phone's app copies them.
export function copyCarriedFiles(resources, extensions, app) {
    const copy = (root, file, to) => {
        const target = path.join(to, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.cpSync(path.join(root, file), target, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
    };
    extensions.forEach(({ name, root, paths }) => paths.forEach((file) => copy(root, file, path.join(resources, 'ext', name))));
    app.paths.forEach((file) => copy(app.root, file, path.join(resources, 'files')));
}
