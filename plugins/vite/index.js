
import {
    state, createLib, createBridgeFile, buildWasm, buildDependencies, getTargetParams, getFilteredBuildTargets, isSourceNewer, getRustJsScript,
} from 'crossbind';
import rollupCrossbindPlugin from '@crossbind/plugin-rollup';

import fs from 'node:fs';

const targetParams = getTargetParams({ platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'] }, true);
let buildTargetRelease = getFilteredBuildTargets(targetParams, { buildType: 'release' })?.[0];
let buildTargetDebug = getFilteredBuildTargets(targetParams, { buildType: 'debug' })?.[0];

if (!buildTargetRelease && !buildTargetDebug) {
    throw new Error('No build targets found');
}

if (!buildTargetDebug) {
    buildTargetDebug = buildTargetRelease;
}

const viteCrossbindPlugin = (options) => {
    let isServe = false;
    // The middleware invalidates /crossbind.js on every request so a request that raced ahead
    // of the .h transforms heals itself. With parallel test workers that means N requests enter
    // load() at once, and without this each one would run its own full dependency + source +
    // bridge + wasm build over the same output paths - minutes of contention, and pages binding
    // to glue from different build generations (two module instances, so embind rejects a
    // vector built by the other one). Concurrent callers share the in-flight build; the next
    // request after it settles still starts a fresh one.
    let inFlightBuild = null;
    const bridges = [];

    async function buildGlue() {
        await buildDependencies({ targetParams: { ...targetParams, buildType: [buildTargetDebug.buildType] } });
        const force = isSourceNewer(buildTargetDebug);
        const sourceBuilt = createLib(buildTargetDebug, 'Source', { force, buildSource: true });
        // The Bridge cache is keyed on the nativeGlob fingerprint, so a
        // request that raced ahead of the .h transforms rebuilds here
        // once the bridge list has grown; a rebuilt lib must also force
        // the final link or the wasm keeps the stale registrations.
        const bridgeBuilt = createLib(buildTargetDebug, 'Bridge', { force, buildSource: false, nativeGlob: [`${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`, ...bridges] });
        await buildWasm(buildTargetDebug, { force: force || Boolean(sourceBuilt) || Boolean(bridgeBuilt) });
    }

    const headerRegex = new RegExp(`\\.(${state.config.ext.header.join('|')})$`);
    const sourceRegex = new RegExp(`\\.(${state.config.ext.source.join('|')})$`);

    return [
        rollupCrossbindPlugin(options, bridges),
        {
            name: 'vite-plugin-crossbind',
            async load(source) {
                if (isServe && source === '/crossbind.js') {
                    inFlightBuild = inFlightBuild || buildGlue().finally(() => { inFlightBuild = null; });
                    await inFlightBuild;
                    return fs.readFileSync(`${state.config.paths.build}/${buildTargetDebug.jsName}`, { encoding: 'utf8', flag: 'r' });
                }
                return null;
            },
            configResolved(config) {
                isServe = config.command === 'serve';
                if (isServe) {
                    config.server.fs.allow.push(state.config.paths.build);
                }
            },
            configureServer(server) {
                if (isServe) {
                    server.middlewares.use((req, res, next) => {
                        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
                        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
                        if (req.url === '/crossbind.js') {
                            // The glue depends on the bridge set, which grows as .h
                            // imports are transformed; vite would otherwise serve the
                            // cached load() result forever. Invalidate so the load
                            // hook re-runs - cheap when nothing changed, and it heals
                            // a request that raced ahead of the transforms.
                            const mod = server.moduleGraph.getModuleById('/crossbind.js');
                            if (mod) server.moduleGraph.invalidateModule(mod);
                        }
                        if (req.url === '/crossbind.wasm') req.url = `/@fs/${state.config.paths.build}/${buildTargetDebug.wasmName}`;
                        else if (req.url === '/crossbind.data.txt') req.url = `/@fs/${state.config.paths.build}/${buildTargetDebug.dataTxtName}`;
                        // else if (req.url === '/cpp.worker.js') req.url = `/@fs/${state.config.paths.build}/${state.config.general.name}.js`;
                        next();
                    });
                }
            },
            configurePreviewServer(server) {
                server.middlewares.use((req, res, next) => {
                    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
                    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
                    next();
                });
            },
            async handleHotUpdate({ file, server }) {
                // The cache holds what crossbind writes itself, staged Conan headers among it.
                if (file.startsWith(state.config.paths.build) || file.startsWith(state.config.paths.cache)) {
                    return;
                }
                if (headerRegex.test(file)) {
                    const bridgeFile = createBridgeFile(file);
                    bridges.push(bridgeFile);
                    createLib(buildTargetDebug, 'Bridge', { force: true, buildSource: false, nativeGlob: [`${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`, ...bridges] });
                    await buildWasm(buildTargetDebug, { force: true });
                    server.ws.send({ type: 'full-reload' });
                } else if (sourceRegex.test(file)) {
                    createLib(buildTargetDebug, 'Source', { force: true, buildSource: true, bypassCmake: true });
                    await buildWasm(buildTargetDebug, { force: true });
                    server.ws.send({ type: 'full-reload' });
                } else if (file.endsWith('.rs') && !file.startsWith(state.config.paths.cache)) {
                    // Re-parse the surface so the bridge crate and .d.ts follow a changed API;
                    // cargo itself sees the edit (the bridge embeds the file via #[path]) and
                    // buildWasm rebuilds the app super-crate before relinking. Generated crates
                    // under the cache never take this path.
                    getRustJsScript(buildTargetDebug, file);
                    await buildWasm(buildTargetDebug, { force: true });
                    server.ws.send({ type: 'full-reload' });
                }
            },
        },
    ];
};

export default viteCrossbindPlugin;
