import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The caches earlier releases kept in ~/.crossbind itself.
const EARLIER_CACHES = ['cargo', 'conan', 'conan-local', 'hermes', 'remote-index', 'rust-sysroot', 'sysroots', path.join('android', 'gradle')];

function deleteEarlierCache(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
    } catch (error) {
        if (!fs.existsSync(dir)) return true;
        console.warn(`crossbind: ${dir} could not be deleted (${error.code}): delete it, as it is a cache of earlier releases.`);
        return false;
    }
    return true;
}

// What crossbind downloads or builds again, which can go whenever no build runs. Until the folder is there, the caches
// earlier releases kept in ~/.crossbind itself are deleted, and builds download what they need again.
export default function cacheDir(name) {
    const home = path.join(os.homedir(), '.crossbind');
    const root = path.join(home, 'cache');
    if (!fs.existsSync(root)) {
        const deleted = EARLIER_CACHES.filter((cache) => fs.existsSync(path.join(home, cache)) && deleteEarlierCache(path.join(home, cache)));
        if (deleted.length > 0) console.warn(`crossbind: deleted ${deleted.join(', ')} in ${home}, the caches of earlier releases: builds download what they need again, into ${root}.`);
    }
    return path.join(root, name);
}
