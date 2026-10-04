import path from 'node:path';

// A project's own build leaves the addon beside the loader. A package that publishes one addon per
// platform ships it in <package>-<platform>-<arch>, an optional dependency whose main is the addon.
export default function addonLocation({ dir, fileName, packageName, exists, resolve }) {
    const beside = path.join(dir, fileName);
    if (exists(beside) || !packageName) return beside;
    try {
        return resolve(packageName);
    } catch {
        return beside;
    }
}
