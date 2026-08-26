import fs from 'node:fs';
import { getContentHash } from './hash.js';

// The prebuilt-lib cache in buildLib is existence-only, so a nativeVersion or recipe-sha256 bump
// would otherwise be served from the previous build - shipping the old upstream under the new
// version, with provenance and licence metadata already claiming the new one.
export const SOURCE_FINGERPRINT_FILE = 'crossbind-source.fingerprint';

export function getSourceFingerprint(config) {
    const nativeVersion = config?.package?.nativeVersion || null;
    const sha256 = config?.build?.sha256 || null;
    // Packages that build from local sources pin neither; they keep the existence-only behaviour.
    if (!nativeVersion && !sha256) return null;
    return getContentHash(JSON.stringify({ nativeVersion, sha256 }));
}

export function isSourceFingerprintStale(libdir, fingerprint) {
    if (!fingerprint) return false;
    const file = `${libdir}/${SOURCE_FINGERPRINT_FILE}`;
    return !fs.existsSync(file) || fs.readFileSync(file, { encoding: 'utf8' }) !== fingerprint;
}

export function writeSourceFingerprint(libdir, fingerprint) {
    if (!fingerprint) return;
    fs.mkdirSync(libdir, { recursive: true });
    fs.writeFileSync(`${libdir}/${SOURCE_FINGERPRINT_FILE}`, fingerprint);
}

// A changed upstream release leaves the previous configure output and install tree behind. Reusing
// them makes `make install` fail where it cannot chmod a file it did not create, and would leave
// files of the old version in the output next to the new ones.
export function staleTargetDirectories({ buildPath, outputPath, targetPath }) {
    return [
        `${buildPath}/Source-Release/${targetPath}`,
        `${buildPath}/Source-Release/prebuilt/${targetPath}`,
        `${buildPath}/Source-Debug/${targetPath}`,
        `${buildPath}/Source-Debug/prebuilt/${targetPath}`,
        `${outputPath}/prebuilt/${targetPath}`,
    ];
}
