import fs from 'node:fs';
import path from 'node:path';

const LICENSES_DIR = 'licenses';

// The texts of vendored copies live in the upstream source tree, which an installed package does
// not have, so the build ships them in dist for the notices to read later.
export function copyBundledLicenses(entries, sourceDir, outputDir) {
    (entries ?? []).forEach((entry) => {
        (entry.files ?? []).forEach((file) => {
            const from = path.join(sourceDir, file);
            if (!fs.existsSync(from)) {
                throw new Error(`crossbind: ${file}, the license of the vendored ${entry.name}, is not in the source.`);
            }
            const to = path.join(outputDir, LICENSES_DIR, entry.name, file);
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to);
        });
    });
}

export function shippedBundledLicense(packageDirs, entryName, file) {
    return packageDirs
        .map((dir) => path.join(dir, 'dist', LICENSES_DIR, entryName, file))
        .find((candidate) => fs.existsSync(candidate)) ?? null;
}
