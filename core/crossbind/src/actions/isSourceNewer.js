import fs from 'node:fs';
import p from 'node:path';
import state from '../state/index.js';
import { nativeSourceStampChanged } from '../utils/nativeSourceStamp.js';

function newestMtimeInDir(dir) {
    let newest = 0;
    if (!fs.existsSync(dir)) return newest;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = p.join(dir, entry.name);
        if (entry.isDirectory()) {
            const m = newestMtimeInDir(full);
            if (m > newest) newest = m;
        } else if (entry.isFile()) {
            const m = fs.statSync(full).mtimeMs;
            if (m > newest) newest = m;
        }
    }
    return newest;
}

// "Did any native source change after this artifact was produced?" - artifact is a file
// (bundler plugins: the built js) or a directory (CLI lib cache: the staged prebuilt dir).
export function isNativeSourceNewerThan(artifactPath) {
    if (!fs.existsSync(artifactPath)) return false;
    if (nativeSourceStampChanged(artifactPath, state.config.paths.native)) return true;
    const stat = fs.statSync(artifactPath);
    const artifactMtime = stat.isDirectory() ? newestMtimeInDir(artifactPath) : stat.mtimeMs;
    for (const dir of state.config.paths.native) {
        if (newestMtimeInDir(dir) > artifactMtime) return true;
    }
    return false;
}

export default function isSourceNewer(target) {
    return isNativeSourceNewerThan(`${state.config.paths.build}/${target.jsName}`);
}
