import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import NDK_VERSION from '../ndk.cjs';
import {
    state, buildDependencies, getDependenciesStamp, getTargetParams,
    computeInputStamp, collectRustSources, collectRustBridgeFiles,
} from './crossbind.js';

const buildType = (process.argv[2] || 'Release').toLowerCase();
const archs = (process.argv[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
const appNdk = process.argv[4] || '';

// crossbind's Android libraries link the libc++_shared.so of the NDK its images build with, and the app ships the one of
// the NDK it builds with: an older one lacks symbols they need, and the app would not start.
const isOlderVersion = (version, than) => {
    const [a, b] = [version, than].map((value) => value.split('.').map(Number));
    const differs = a.findIndex((part, i) => part !== (b[i] ?? 0));
    return differs !== -1 && a[differs] < (b[differs] ?? 0);
};
if (!appNdk || isOlderVersion(appNdk, NDK_VERSION)) {
    console.error(`crossbind: this app builds with ${appNdk ? `NDK ${appNdk}` : "the Android Gradle plugin's default NDK"}; crossbind's Android libraries need NDK ${NDK_VERSION} or newer: set ndkVersion in android/build.gradle, as "plugins": ["crossbind"] does for an Expo app.`);
    process.exit(1);
}

await buildDependencies({
    targetParams: getTargetParams({
        platform: ['android'],
        ...(archs.length > 0 ? { arch: archs } : {}),
        runtime: ['mt'],
        buildType: [buildType],
    }, true),
});

// App-local Rust surfaces feed the configure-time super-staticlib (build_android.js), so their
// membership AND content must bust the configure too: a NEW bare-crate import used to link a
// super without its bridge until a manual .cxx wipe, and a body edit to an app-local .rs changes
// only the source its bridge includes. embind-rs is the cargo-side runtime dep.
function appRustStamp() {
    const embindRsCrate = path.join(path.dirname(fs.realpathSync(
        createRequire(import.meta.url).resolve('@crossbind/core-embind-rust/package.json'),
    )), 'crate');
    return computeInputStamp([], [], [
        ...collectRustSources([state.config.paths.project, ...state.config.paths.native, embindRsCrate]),
        ...collectRustBridgeFiles(state.config.paths.cache),
    ], 'app-rust');
}

// CMakeLists registers this file as CMAKE_CONFIGURE_DEPENDS: when the consumed
// rebuilt-dependency set changes, ninja re-runs the CMake configure on its own.
const stamp = `${getDependenciesStamp()}:${appRustStamp()}`;
const stampFile = `${state.config.paths.cache}/deps-stamp`;
fs.mkdirSync(state.config.paths.cache, { recursive: true });
// Only on change: a fresh mtime would make ninja re-run the configure every build.
if (!fs.existsSync(stampFile) || fs.readFileSync(stampFile, 'utf8') !== stamp) {
    fs.writeFileSync(stampFile, stamp);
}
console.log(`CROSSBIND_DEPS_STAMP=${stamp}`);
