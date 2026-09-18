import fs from 'node:fs';

// A bridge's .deps sidecar lists the bridges of the headers defining the types its declarations use. They link into the
// same module, since embind registers each class and enum once, in the bridge of the header that defines it.
export function withDependencyBridges(files) {
    const listed = new Set(files);
    const added = [];
    for (const file of files) {
        const sidecar = `${file}.deps`;
        if (!fs.existsSync(sidecar)) continue;
        for (const dependency of fs.readFileSync(sidecar, 'utf8').split('\n').filter(Boolean)) {
            if (listed.has(dependency) || !fs.existsSync(dependency)) continue;
            listed.add(dependency);
            added.push(dependency);
        }
    }
    return [...files, ...added];
}
