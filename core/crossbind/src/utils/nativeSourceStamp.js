import fs from 'node:fs';
import path from 'node:path';
import { getContentHash } from './hash.js';

// Names matter as well as dates: removing or renaming a source must invalidate its archive.
export function nativeSourceStamp(directories = []) {
    const entries = [];
    const visit = (file) => {
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        if (!stat) { entries.push([file, 'missing']); return; }
        if (stat.isDirectory()) {
            entries.push([file, 'directory']);
            for (const entry of fs.readdirSync(file, { withFileTypes: true })) {
                // Match the source walk's treatment of links and avoid cycles.
                if (entry.isFile() || entry.isDirectory()) visit(path.join(file, entry.name));
            }
        } else if (stat.isFile()) entries.push([file, stat.size, stat.mtimeMs]);
    };
    directories.forEach(visit);
    return getContentHash(JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b))));
}

const stampFile = (artifact) => `${artifact}.sources`;

export function nativeSourceStampChanged(artifact, directories = []) {
    // No local sources: prebuilt ports retain their existing upstream fingerprint contract.
    if (!directories.length) return false;
    const file = stampFile(artifact);
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== nativeSourceStamp(directories);
}

export function writeNativeSourceStamp(artifact, directories = []) {
    if (!directories.length) return;
    fs.mkdirSync(path.dirname(stampFile(artifact)), { recursive: true });
    fs.writeFileSync(stampFile(artifact), nativeSourceStamp(directories));
}
