import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { state, getData, getDependenciesStamp } from './crossbind.js';
import resolveBuildTarget from './resolveBuildTarget.js';

const arch = process.argv[2] || 'arm64-v8a';
const buildType = process.argv[3] || 'Release';

const buildTarget = resolveBuildTarget(arch, buildType);

// The plugin's own library assets: AGP merges them into the APK with proper task
// ordering, so no cross-project mergeAssets coupling is needed. Final APK path is
// identical (assets/crossbind/…).
const assetPath = fileURLToPath(new URL('../android/src/main/assets/crossbind', import.meta.url));
const stampPath = `${assetPath}/.crossbind-assets-stamp`;
const stamp = getDependenciesStamp();

// Pre-task versions copied into the app project; drop any leftovers so stale data
// cannot shadow the library-provided assets.
fs.rmSync(`${state.config.paths.project}/android/app/src/main/assets/crossbind`, { recursive: true, force: true });

// Copies below are existsSync-guarded, so data from a source-rebuilt dependency
// (e.g. an overridden PROJ's proj.db) would stay stale forever: wipe and recopy
// whenever the consumed rebuilt-dependency set changes.
const previousStamp = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8') : null;
if (previousStamp !== null && previousStamp !== stamp) {
    fs.rmSync(assetPath, { recursive: true, force: true });
}

if (!fs.existsSync(assetPath)) {
    fs.mkdirSync(assetPath, { recursive: true });
}
Object.entries(getData('data', buildTarget)).forEach(([key, value]) => {
    if (fs.existsSync(key)) {
        const dAssetPath = `${assetPath}/${value}`;
        if (!fs.existsSync(dAssetPath)) {
            fs.mkdirSync(dAssetPath, { recursive: true });
            fs.cpSync(key, dAssetPath, { recursive: true });
        }
    }
});
fs.writeFileSync(stampPath, stamp);
