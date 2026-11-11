import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
    state, getCmakeParameters, getParentPath, getAllBridges, buildAppRustCrates,
} from 'crossbind';
import RNEmbind from '@crossbind/core-embind-jsi/crossbind.config.mjs';
import RNCrossbindPluginReactNative from '../crossbind.config.mjs';
import resolveBuildTarget from './resolveBuildTarget.js';

const arch = process.argv[2];
const buildType = process.argv[3] || 'Release';
const outFile = process.argv[4];

if (!arch || !outFile) {
    throw new Error('Usage: node build_android.js <abi> <buildType> <paramsOutFile>');
}

const buildTarget = resolveBuildTarget(arch, buildType);

const projectPath = getParentPath(RNCrossbindPluginReactNative.paths.config);
const RNEmbindProjectPath = getParentPath(RNEmbind.paths.config);
// This plugin declares @crossbind/core-embind-rust, so its own require resolves it in every
// layout (workspace link or a consumer install) - same direction rule as core-embind-jsi.
const RNEmbindRustPath = path.dirname(fs.realpathSync(
    createRequire(import.meta.url).resolve('@crossbind/core-embind-rust/package.json'),
));

const bridges = getAllBridges();
const options = {
    name: 'react-native-crossbind',
    buildSource: true,
    nativeGlob: [
        `${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`,
        ...bridges,
        `${projectPath}/cpp/src/JSI_module.cpp`,
        `${RNEmbindProjectPath}/cpp/src/emscripten/bind.cpp`,
        `${RNEmbindRustPath}/adapters/jsi.cpp`,
    ],
    headerDirs: [
        `${projectPath}/cpp/src`,
        `${RNEmbindProjectPath}/cpp/src`,
        `${RNEmbindRustPath}/include`,
    ],
};
const params = getCmakeParameters(buildTarget, options);

// App-local Rust surfaces (imported .rs files): cargo-build their synthesized crates for this
// ABI and hand the staticlibs to CMake, which links them whole-archive (init-array survival).
const rustLibs = buildAppRustCrates(buildTarget, state.config.paths.cache, state.config.packages.cargo);
if (rustLibs.length > 0) params.push(`-DCROSSBIND_RUST_APP_LIBS=${rustLibs.join(';')}`);

// Written to a file (one parameter per line), not stdout: crossbind logging shares
// stdout, so CMake parsing the process output would break on any log line.
fs.writeFileSync(outFile, params.join('\n'));
