import fs from 'node:fs';
import loadJson from '../utils/loadJson.js';
import writeJson from '../utils/writeJson.js';
import { TARGETS, targetPathOf, nodeAddonNamesOf, nativeCommandNamesOf } from '../utils/targets.js';
import { findCargoModuleImportsIn, writeCargoMarker } from '../utils/cargoImport.js';
import { exportWasiSdkPath } from '../utils/wasiToolchain.js';
import loadConfig, { assertBinarySelection } from './loadConfig.js';
import refreshConanDependencies from './refreshConanDependencies.js';

const cacheDir = `${process.cwd()}/.crossbind`;

const state = {
    targets: TARGETS.map((target) => ({ ...target })),
    config: null,
    cache: {
        hashes: {},
        interfaces: {},
        bridges: {},
    },
};

await initProcessState();

async function initProcessState() {
    state.cache = loadCacheState();
    state.config = await loadConfig();
    assertBinarySelection(state.config);
    refreshConanDependencies(state.config);
    exportWasiSdkPath(state.config.system);
    // Same idea for the docker image overrides: pullDockerImage.js resolves them from the
    // environment alone, so it stays free of a state import (and of the cycle that would create).
    Object.entries({
        DOCKER_REGISTRY_MIRROR: 'CROSSBIND_REGISTRY_MIRROR',
        DOCKER_IMAGE_WEB: 'CROSSBIND_IMAGE_WEB',
        DOCKER_IMAGE_ANDROID: 'CROSSBIND_IMAGE_ANDROID',
        DOCKER_IMAGE_LINUX: 'CROSSBIND_IMAGE_LINUX',
        DOCKER_IMAGE_WINDOWS: 'CROSSBIND_IMAGE_WINDOWS',
    }).forEach(([key, envKey]) => {
        if (state.config.system[key] && !process.env[envKey]) {
            process.env[envKey] = state.config.system[key];
        }
    });

    state.targets.forEach((target) => {
        target.path = targetPathOf(target);
        target.releasePath = targetPathOf({ ...target, buildType: 'release' });
        if (target.runtimeEnv && target.platform === 'wasm') {
            target.rawJsName = `${state.config.general.name}-${target.path}.${target.runtimeEnv}.js`;
            target.jsName = `${state.config.general.name}-${target.path}.${target.runtimeEnv}.js`;
            target.wasmName = `${state.config.general.name}-${target.path}.${target.runtimeEnv}.wasm`;
            target.dataName = `${state.config.general.name}-${target.path}.${target.runtimeEnv}.data`;
            target.dataTxtName = `${state.config.general.name}-${target.path}.${target.runtimeEnv}.data.txt`;
        }
        if (target.platform === 'wasi') {
            // A wasi build is a single command module - no JS glue, no preload.
            target.wasmName = `${state.config.general.name}-${target.path}.wasm`;
        }
        if (target.runtimeEnv === 'node' && target.platform !== 'wasm') {
            Object.assign(target, nodeAddonNamesOf(target, state.config.general.name));
        }
        if (target.runtimeEnv === 'native') {
            Object.assign(target, nativeCommandNamesOf(target, state.config.general.name));
        }
    });

    setAllDependecyPaths();

    // Cargo-crate import markers must exist BEFORE any bundler starts: metro resolves against
    // its startup file map, so a marker first created mid-resolution is invisible to that very
    // build. Bare crates come from the config, module imports from the app's own sources.
    const cargoDeps = state.config.cargoDependencies ?? {};
    const crateNames = Object.keys(cargoDeps);
    const moduleImports = crateNames.length && state.config.paths.project
        ? findCargoModuleImportsIn(state.config.paths.project).filter((i) => Object.hasOwn(cargoDeps, i.crateName))
        : [];
    [...crateNames.map((crateName) => ({ crateName, modulePath: [] })), ...moduleImports]
        .forEach((cargoImport) => writeCargoMarker(state.config.paths.cache, cargoImport));

    if (state.config.build?.setState) {
        state.config.build.setState(state);
    }
}

function loadCacheState() {
    const stateFilePath = `${cacheDir}/cache.json`;
    return loadJson(stateFilePath) || state.cache;
}

export function setAllDependecyPaths() {
    state.config.allDependencyPaths = {};
    state.targets.forEach((target) => {
        state.config.allDependencyPaths[target.path] = { cmake: {} };
        state.config.allDependencies.forEach((d) => {
            state.config.allDependencyPaths[target.path].cmake[d.general.name] = `${d.paths.output}/prebuilt`;
            // A Conan recipe can name a library on another platform only (libpng is png16 on Windows).
            const libNames = d.general.conan
                ? d.export.libName.filter((name) => [target.path, target.releasePath]
                    .some((targetPath) => fs.existsSync(`${d.paths.output}/prebuilt/${targetPath}/lib/lib${name}.a`)))
                : d.export.libName;
            libNames.forEach((name) => {
                state.config.allDependencyPaths[target.path][name] = {
                    root: `${d.paths.output}/prebuilt/${target.path}`,
                };
                const entryArray = d?.targetSpecs?.filter(t => (
                    (!t.platform || t.platform === target.platform)
                    && (!t.arch || t.arch === target.arch)
                    && (!t.runtime || t.runtime === target.runtime)
                    && (!t.buildType || t.buildType === target.buildType)
                )).map(t => t?.specs);
                const platformConfig = Object.assign({}, ...entryArray);
                const isDynamicLib = target.platform === 'android' && platformConfig.libType !== 'static';
                const dep = state.config.allDependencyPaths[target.path][name];
                if (target.platform === 'ios') {
                    let xcRoot;
                    if (target.arch === 'iphoneos') {
                        xcRoot = `${d.paths.project}/${name}.xcframework/ios-arm64`;
                    } else if (target.arch === 'iphonesimulator') {
                        xcRoot = `${d.paths.project}/${name}.xcframework/ios-arm64-simulator`;
                    }
                    dep.header = `${xcRoot}/Headers`;
                    dep.libPath = xcRoot;
                    dep.lib = `${dep.libPath}/lib${name}.a`;
                    dep.bin = `${dep.root}/bin`;
                } else {
                    dep.header = `${dep.root}/include`;
                    dep.libPath = `${dep.root}/lib`;
                    dep.lib = `${dep.libPath}/lib${name}.${isDynamicLib ? 'so' : 'a'}`;
                    dep.bin = `${dep.root}/bin`;
                }
            });
        });
    });
}

export function saveCache() {
    writeJson(`${cacheDir}/cache.json`, state.cache);
}

export default state;
