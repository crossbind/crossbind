import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
    state, createLib, getParentPath, buildDependencies,
    createXCFramework, getAllBridges, getTargetParams, getFilteredBuildTargets,
    buildAppRustCrates,
} from 'crossbind';
import RNEmbind from '@crossbind/core-embind-jsi/crossbind.config.mjs';
import RNCrossbindPluginReactNative from '../crossbind.config.mjs';
import { isIosLibsFresh, saveIosLibsStamp } from './iosLibCache.js';

const buildType = process.argv[2] || 'Release';

const targetParamsIPhoneOS = getTargetParams({ platform: ['ios'], arch: ['iphoneos'], runtime: ['mt'] }, true);
const targetParamsIPhoneSimulator = getTargetParams({ platform: ['ios'], arch: ['iphonesimulator'], runtime: ['mt'] }, true);
let buildTargetReleaseIPhoneOS = getFilteredBuildTargets(targetParamsIPhoneOS, { buildType: 'release' })?.[0];
let buildTargetDebugIPhoneOS = getFilteredBuildTargets(targetParamsIPhoneOS, { buildType: 'debug' })?.[0];
let buildTargetReleaseIPhoneSimulator = getFilteredBuildTargets(targetParamsIPhoneSimulator, { buildType: 'release' })?.[0];
let buildTargetDebugIPhoneSimulator = getFilteredBuildTargets(targetParamsIPhoneSimulator, { buildType: 'debug' })?.[0];

if ((!buildTargetReleaseIPhoneOS && !buildTargetDebugIPhoneOS) || (!buildTargetReleaseIPhoneSimulator && !buildTargetDebugIPhoneSimulator)) {
    throw new Error('No build targets found');
}

if (!buildTargetDebugIPhoneOS) {
    buildTargetDebugIPhoneOS = buildTargetReleaseIPhoneOS;
} else if (!buildTargetReleaseIPhoneOS) {
    buildTargetReleaseIPhoneOS = buildTargetDebugIPhoneOS;
}

if (!buildTargetDebugIPhoneSimulator) {
    buildTargetDebugIPhoneSimulator = buildTargetReleaseIPhoneSimulator;
} else if (!buildTargetReleaseIPhoneSimulator) {
    buildTargetReleaseIPhoneSimulator = buildTargetDebugIPhoneSimulator;
}

const buildTargetIPhoneOS = buildType === 'Release' ? buildTargetReleaseIPhoneOS : buildTargetDebugIPhoneOS;
const buildTargetIPhoneSimulator = buildType === 'Release' ? buildTargetReleaseIPhoneSimulator : buildTargetDebugIPhoneSimulator;

const projectPath = getParentPath(RNCrossbindPluginReactNative.paths.config);
const RNEmbindProjectPath = getParentPath(RNEmbind.paths.config);
// embind-rust is the Rust producer's mobile adapter, a sibling of embind-jsi in core/; its
// jsi adapter compiles alongside bind.cpp so Rust-registered classes reach JS on mobile too.
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
        `${RNEmbindProjectPath}/cpp/src/emscripten/bind.cpp`,
        `${RNEmbindRustPath}/adapters/jsi.cpp`,
        `${state.config.paths.project}/node_modules/react-native/ReactCommon/jsi/jsi/jsi.cpp`,
    ],
    headerGlob: [
        `${RNEmbindProjectPath}/cpp/src/**/*.h`,
    ],
    headerDirs: [
        `${RNEmbindProjectPath}/cpp/src`,
        `${RNEmbindRustPath}/include`,
        `${state.config.paths.project}/node_modules/react-native/ReactCommon/jsi`,
    ],
};

const iosTargetParams = {
    platform: ['ios'],
    arch: [buildTargetIPhoneOS.arch, buildTargetIPhoneSimulator.arch],
    runtime: [buildTargetIPhoneOS.runtime],
    buildType: [buildTargetIPhoneOS.buildType],
};

await buildDependencies({ targetParams: iosTargetParams });

// The podspec vendors every xcframework in conan/, so it holds the app's Conan libraries and nothing else.
// A package that only another platform's recipes require was never staged for iOS and has none.
const conanDir = path.join(projectPath, 'conan');
fs.rmSync(conanDir, { recursive: true, force: true });
state.config.allDependencies.filter((d) => d.general.conan).forEach((d) => d.export.libName.forEach((name) => {
    const xcframework = `${d.paths.project}/${name}.xcframework`;
    if (fs.existsSync(xcframework)) fs.cpSync(xcframework, path.join(conanDir, `${name}.xcframework`), { recursive: true });
}));

const cacheKeyArgs = [buildType, projectPath, [projectPath, RNEmbindProjectPath, RNEmbindRustPath]];
if (isIosLibsFresh(...cacheKeyArgs)) {
    console.log(`crossbind: iOS libs (${buildType}) up to date — skipping native build.`);
} else {
    // We only reach this branch when the stamp says the libs are stale (a bridge/embind
    // source changed) or missing, so force the recompile: createLib otherwise skips when the
    // output lib dir already exists, which would repackage the xcframework from stale objects.
    createLib(buildTargetIPhoneOS, 'Full', { ...options, force: true });
    createLib(buildTargetIPhoneSimulator, 'Full', { ...options, force: true });

    // App-local Rust surfaces (imported .rs files): cargo-build their synthesized crates and
    // merge the staticlibs into react-native-crossbind.a - that archive is already force_loaded by
    // the podspec, so the crates' init-array registrations survive the app link.
    for (const target of [buildTargetIPhoneOS, buildTargetIPhoneSimulator]) {
        const rustLibs = buildAppRustCrates(target, state.config.paths.cache, state.config.cargoDependencies ?? {});
        if (rustLibs.length === 0) continue;
        const libFile = `${state.config.paths.build}/Full-${buildType}/prebuilt/${target.path}/lib/libreact-native-crossbind.a`;
        const merged = `${libFile}.merged`;
        const libtool = spawnSync('libtool', ['-static', '-o', merged, libFile, ...rustLibs], { stdio: 'inherit' });
        if (libtool.status !== 0) throw new Error(`crossbind: libtool merge failed for ${libFile}`);
        fs.renameSync(merged, libFile);
    }

    const overrideConfig = {
        paths: {
            project: projectPath,
            output: `${state.config.paths.build}/Full-${buildType}`,
        },
        export: {
            libName: ['react-native-crossbind'],
        },
        targetParams: iosTargetParams,
    };
    createXCFramework(overrideConfig);
    saveIosLibsStamp(...cacheKeyArgs);
}
