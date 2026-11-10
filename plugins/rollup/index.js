

import {
    state, createLib, createBridgeFile, buildWasm, getCrossbindScript, getRustJsScript, buildDependencies,
    getDependFilePath, getTargetParams, getFilteredBuildTargets, isSourceNewer, appSourceFiles, buildProjectApp, publishApp,
    appOutputName, appTargetParams, checkInstaller, resolveAppPageApi, shipApp,
} from 'crossbind';

import fs from 'node:fs';
import p from 'node:path';

// An app's page reaches the module in the host the app runs, so its build makes the host, not wasm: this machine's, or
// with CROSSBIND_APP_PLATFORM one per iOS SDK, Android ABI or Linux or Windows arch.
const isApp = state.config.target.runtimeEnv === 'app';
const targetParams = isApp
    ? appTargetParams()
    : getTargetParams({ platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'] }, true);
// iOS and Android keep targets without a runtime environment for React Native, which every filter of runtimeEnv lets
// through.
const appOnly = isApp ? { runtimeEnv: 'app' } : {};
let buildTargetRelease = getFilteredBuildTargets(targetParams, { buildType: 'release', ...appOnly })?.[0];
let buildTargetDebug = getFilteredBuildTargets(targetParams, { buildType: 'debug', ...appOnly })?.[0];
const appTargets = isApp ? getFilteredBuildTargets(targetParams, { buildType: 'release', ...appOnly }) : [];

if (isApp && !buildTargetRelease) {
    throw new Error(`crossbind: desktop apps build on macOS, Linux and Windows so far, and this machine runs ${process.platform}-${process.arch}.`);
}
if (!buildTargetRelease && !buildTargetDebug) {
    throw new Error('No build targets found');
}

if (!buildTargetRelease) {
    buildTargetRelease = buildTargetDebug;
}

const rollupCrossbindPlugin = (options, bridges = []) => {
    const headerRegex = new RegExp(`\\.(${state.config.ext.header.join('|')})$`);
    const moduleRegex = new RegExp(`\\.(${state.config.ext.module.join('|')})$`);
    // Vite gives the base it serves the app from; plain Rollup has none.
    let base = '/';
    let isServe = false;

    return {
        name: 'rollup-plugin-crossbind',
        configResolved(config) {
            base = config.base;
            isServe = config.command === 'serve';
        },
        resolveId(source) {
            if (source === '/crossbind.js') {
                return { id: source, external: true };
            }
            if (isApp && source === 'crossbind/app') return resolveAppPageApi();
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
                return getRustJsScript(buildTargetRelease, path, { base });
            }
            if (!headerRegex.test(path) && !moduleRegex.test(path)) {
                return null;
            }

            const bridgeFile = createBridgeFile(path, buildTargetRelease);
            // A header transforms again after each source edit; a repeated entry would change the bridge lib's fingerprint.
            if (!bridges.includes(bridgeFile)) bridges.push(bridgeFile);
            // The names the app imports decide what a header binds, so watch mode transforms it again after any source edit.
            // Vite's dev server rebinds them itself: there, Vite would take the sources for imports of the header and, the
            // page importing the header, update nothing after an edit to the page.
            if (!isServe) appSourceFiles(state.config.paths.project).forEach((file) => this.addWatchFile(file));

            return getCrossbindScript(buildTargetRelease, bridgeFile, { base });
        },
        async buildStart() {
            // writeBundle puts each app beside what installs it, whose names, signing keys and installers stop the build
            // here if they cannot be, before the dependencies compile.
            if (isApp && !isServe) {
                for (const target of appTargets) await checkInstaller(target);
            }
            // Before any transform: a header's bridge reads the include roots of every dependency, and a cargo
            // dependency built for another target only is there but lacks this one until the build makes it.
            await buildDependencies({ targetParams: { ...targetParams, buildType: [buildTargetRelease.buildType] } });
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
            if (isApp) {
                for (const target of appTargets) await buildProjectApp(target);
                this.emitFile({
                    type: 'asset',
                    source: fs.readFileSync(`${state.config.paths.build}/${buildTargetRelease.appJsName}`),
                    fileName: 'crossbind.js',
                });
                return;
            }
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
        // The page, once written, goes into the app beside it: one project of every SDK or ABI for iOS and Android, one
        // app per arch for a desktop, which then ships with what installs it. The installers write beside the apps, so
        // they run once every app has its page, which would take their files in.
        async writeBundle(outputOptions) {
            if (!isApp) return;
            const dir = outputOptions.dir ?? p.dirname(outputOptions.file);
            const apps = ['ios', 'android'].includes(buildTargetRelease.platform) ? [buildTargetRelease] : appTargets;
            const published = apps.map((target) => ({ target, to: publishApp(target, { to: `${dir}/${appOutputName(target)}`, page: dir }) }));
            for (const { target, to } of published) await shipApp(target, to);
        },
    };
};

export default rollupCrossbindPlugin;
