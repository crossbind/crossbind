

import {
    state, createLib, createBridgeFile, buildWasm, getCrossbindScript, getRustJsScript, buildDependencies,
    getDependFilePath, getTargetParams, getFilteredBuildTargets, isSourceNewer, prepareConanDependencies,
} from 'crossbind';

import fs from 'node:fs';
import p from 'node:path';

const targetParams = getTargetParams({ platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'] }, true);
let buildTargetRelease = getFilteredBuildTargets(targetParams, { buildType: 'release' })?.[0];
let buildTargetDebug = getFilteredBuildTargets(targetParams, { buildType: 'debug' })?.[0];

if (!buildTargetRelease && !buildTargetDebug) {
    throw new Error('No build targets found');
}

if (!buildTargetRelease) {
    buildTargetRelease = buildTargetDebug;
}

const rollupCrossbindPlugin = (options, bridges = []) => {
    const headerRegex = new RegExp(`\\.(${state.config.ext.header.join('|')})$`);
    const moduleRegex = new RegExp(`\\.(${state.config.ext.module.join('|')})$`);

    return {
        name: 'rollup-plugin-crossbind',
        resolveId(source) {
            if (source === '/crossbind.js') {
                return { id: source, external: true };
            }
            const dependFilePath = getDependFilePath(source, buildTargetRelease);
            if (dependFilePath) {
                return dependFilePath;
            }

            return null;
        },
        async transform(code, path) {
            // Rust surfaces need no bridge file here: the native bridge is the package's
            // generated companion crate (or the app-local synthesized crate); this only emits
            // the JS proxy module - the same shape as the .h flow.
            if (path.endsWith('.rs')) {
                return getRustJsScript(buildTargetRelease, path);
            }
            if (!headerRegex.test(path) && !moduleRegex.test(path)) {
                return null;
            }

            const bridgeFile = createBridgeFile(path);
            bridges.push(bridgeFile);

            return getCrossbindScript(buildTargetRelease, bridgeFile);
        },
        async buildStart() {
            await prepareConanDependencies([buildTargetRelease]);
            const watch = (dirs) => {
                dirs.forEach((dir) => {
                    const filesToWatch = fs.readdirSync(dir);

                    for (const file of filesToWatch) {
                        const fullPath = p.join(dir, file);
                        const stats = fs.statSync(fullPath);

                        if (stats.isFile()) {
                            this.addWatchFile(fullPath);
                        } else if (stats.isDirectory()) {
                            watch([fullPath]);
                        }
                    }
                });
            };

            state.config.paths.native.forEach((dir) => {
                if (fs.existsSync(dir)) {
                    watch([dir]);
                }
            });
        },
        async generateBundle() {
            await buildDependencies({ targetParams: { ...targetParams, buildType: [buildTargetRelease.buildType] } });
            const force = isSourceNewer(buildTargetRelease);
            const sourceBuilt = createLib(buildTargetRelease, 'Source', { force, buildSource: true });
            // Bridge cache is keyed on the nativeGlob fingerprint: adding or
            // removing a .h import rebuilds the bridge lib even when no source
            // file changed, and a rebuilt lib must force the final link too.
            const bridgeBuilt = createLib(buildTargetRelease, 'Bridge', { force, buildSource: false, nativeGlob: [`${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`, ...bridges] });
            await buildWasm(buildTargetRelease, { force: force || Boolean(sourceBuilt) || Boolean(bridgeBuilt) });

            this.emitFile({
                type: 'asset',
                source: fs.readFileSync(`${state.config.paths.build}/${buildTargetRelease.jsName}`),
                fileName: 'crossbind.js',
            });

            this.emitFile({
                type: 'asset',
                source: fs.readFileSync(`${state.config.paths.build}/${buildTargetRelease.wasmName}`),
                fileName: 'crossbind.wasm',
            });
            const dataFilePath = `${state.config.paths.build}/${buildTargetRelease.dataTxtName}`;
            if (fs.existsSync(dataFilePath)) {
                this.emitFile({
                    type: 'asset',
                    source: fs.readFileSync(dataFilePath),
                    fileName: 'crossbind.data.txt',
                });
            }
            /* const workerFilePath = `${state.config.paths.build}/${state.config.general.name}.js`;
            if (fs.existsSync(workerFilePath)) {
                this.emitFile({
                    type: 'asset',
                    source: fs.readFileSync(workerFilePath),
                    fileName: `cpp.worker.js`,
                });
            } */
        },
    };
};

export default rollupCrossbindPlugin;
