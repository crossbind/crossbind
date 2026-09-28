import fs from 'node:fs';
import path from 'node:path';
import { getContentHash, getFileHash } from './hash.js';
import { collectRustSources } from './inputStamp.js';
import resolveEmbindRustRoot from './resolveEmbindRust.js';

// Every cargo staticlib bundles the embind-rs it was built from. An archive from another one links stale glue, and next
// to an archive built after it every embind_rs symbol is defined twice, so a prebuilt records the one it came from.
export const EMBIND_RS_FINGERPRINT_FILE = 'crossbind-embind-rs.fingerprint';

// Paths count relative to the crate, so an archive built from the same embind-rs elsewhere matches.
export function getEmbindRsFingerprint() {
    const crate = `${resolveEmbindRustRoot()}/crate`;
    const files = [...collectRustSources([crate]), `${crate}/Cargo.toml`];
    return getContentHash(files.map((file) => `${path.relative(crate, file)}:${getFileHash(file)}`).sort().join('\n'));
}

export function isEmbindRsFingerprintStale(prebuiltDir, fingerprint) {
    const file = `${prebuiltDir}/${EMBIND_RS_FINGERPRINT_FILE}`;
    return !fs.existsSync(file) || fs.readFileSync(file, { encoding: 'utf8' }) !== fingerprint;
}

export function writeEmbindRsFingerprint(prebuiltDir, fingerprint) {
    fs.mkdirSync(prebuiltDir, { recursive: true });
    fs.writeFileSync(`${prebuiltDir}/${EMBIND_RS_FINGERPRINT_FILE}`, fingerprint);
}
