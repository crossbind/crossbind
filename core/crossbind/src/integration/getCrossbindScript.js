import fs from 'node:fs';
import path from 'node:path';
import getData from '../actions/getData.js';
import loadJson from '../utils/loadJson.js';
import state from '../state/index.js';
import { parseSurface, createRustBridgeCrate, createCrateImportBridge } from '../utils/rustBridgeGen.js';

export default function getCrossbindScript(target, bridgePath) {
    if (!bridgePath) {
        throw new Error('getCrossbindScript needs the bridge file of the imported header');
    }
    return buildScript(target, loadJson(`${bridgePath}.exports.json`));
}

// The Rust analog of a .h import: parse the crate surface and emit the same proxy module
// (per-symbol lets assigned inside this module's initNative). Vectors come from the owning
// cargo package's config; classes/enums come from the parsed source.
export function getRustJsScript(target, rsFile) {
    // Compare real paths: dependency paths go through node_modules symlinks (pnpm workspaces)
    // while bundlers hand the transformer the resolved real file.
    const realCrateDir = (d) => {
        try { return fs.realpathSync(path.resolve(d.paths.project, d.export.crate ?? 'crate')); } catch (e) { return null; }
    };
    const rsReal = fs.realpathSync(rsFile);

    // Marker under <cache>/rust-crates/: a direct crate import - the model comes from the
    // upstream crate's own source, and the bridge is synthesized against the cargo dependency.
    const crateName = path.basename(rsReal, '.rs');
    const cargoDeps = state.config.cargoDependencies ?? {};
    if (Object.hasOwn(cargoDeps, crateName)
        && path.dirname(rsReal) === fs.realpathSync(path.join(state.config.paths.cache, 'rust-crates'))) {
        const { model, namePrefix } = createCrateImportBridge({
            crateName,
            spec: cargoDeps[crateName],
            cacheDir: state.config.paths.cache,
            dtsMode: state.config.dts,
            log: () => {},
        });
        // A crate import registers its public names prefixed (two crates may export the same
        // name), so the proxy exports the clean name and reads the prefixed one off the module.
        return buildScript(target, [
            ...model.classes.map((c) => c.name),
            ...model.enums.map((e) => e.name),
            ...model.freeFns.map((f) => f.jsName),
            ...(model.consts ?? []).map((c) => c.name),
        ].map((name) => ({ local: name, wire: `${namePrefix}${name}` })));
    }

    const pkg = state.config.allDependencies.find((d) => d.export?.type === 'cargo'
        && realCrateDir(d) && rsReal.startsWith(`${realCrateDir(d)}${path.sep}`));
    const model = parseSurface(fs.readFileSync(rsFile, 'utf8'), () => {});
    const vectors = pkg ? (pkg.export?.bindings?.vectors ?? []) : (state.config.export?.bindings?.vectors ?? []);
    if (!pkg) {
        // App-local .rs: synthesize its bridge crate on import (the C++ createBridgeFile analog);
        // the native builds pick every crate under .crossbind/rust-bridges up and link it.
        createRustBridgeCrate({
            rsFile: rsReal,
            cacheDir: state.config.paths.cache,
            projectPath: state.config.paths.project,
            dtsMode: state.config.dts,
            vectors,
            cargoDependencies: state.config.cargoDependencies ?? {},
            log: () => {},
        });
    }
    const symbols = [
        ...model.classes.map((c) => c.name),
        ...model.enums.map((e) => e.name),
        ...(model.freeFns ?? []).map((f) => f.jsName),
        // `pub const`/`pub static` register as module constants, so the proxy exports them too.
        ...(model.consts ?? []).map((c) => c.name),
        ...vectors.map((v) => v.name),
    ];
    return buildScript(target, symbols);
}

function buildScript(target, symbols) {
    if (!target) {
        throw new Error('The target is not available!');
    }
    const env = JSON.stringify(getData('env', target));
    const getPlatformScript = target.platform === 'wasm' ? getWebScript : getReactNativeScript;

    let symbolExportDefineString = '';
    let symbolExportAssignString = '';
    if (symbols && Array.isArray(symbols)) {
        // A symbol is either a plain name or { local, wire }: the second form exports `local`
        // while reading the differently registered `wire` name off the module.
        const pairs = symbols.map((s) => (typeof s === 'string' ? { local: s, wire: s } : s));
        symbolExportDefineString = pairs.map((s) => `export let ${s.local} = null;`).join('\n');
        symbolExportAssignString = pairs.map((s) => `${s.local} = m.${s.wire};`).join('\n');
    }

    return `
        ${getPlatformScript(env)}

        export let AllSymbols = {};
        ${symbolExportDefineString}

        // Each proxy module registers how to bind its own exports, so one init() - from 'crossbind'
        // or from any single module - resolves every imported module. Binding only inside the
        // owning module's init is what leaves the others' exports null.
        function __crossbindBind(m) {
            AllSymbols = m;
            ${symbolExportAssignString}
        }

        if (!globalThis.__crossbindBinders) globalThis.__crossbindBinders = new Set();
        globalThis.__crossbindBinders.add(__crossbindBind);
        // Imported after the runtime booted: this registration missed the run, so bind now.
        if (globalThis.__crossbindModule) __crossbindBind(globalThis.__crossbindModule);

        function __crossbindInit(config = {}) {
            // Boot once per app: the wasm module (or the JSI lib) must only start once.
            if (!globalThis.__crossbindBootPromise) {
                globalThis.__crossbindBootPromise = __crossbindBoot(config);
            }
            return globalThis.__crossbindBootPromise.then((m) => {
                globalThis.__crossbindModule = m;
                globalThis.__crossbindBinders.forEach((bind) => bind(m));
                return m;
            });
        }

        // Dropping the boot promise here is what lets a later init() start a fresh runtime;
        // the bound exports stay pointed at the dead module until it does.
        __crossbindInit.terminate = function terminate() {
            globalThis.__crossbindBootPromise = null;
            globalThis.__crossbindModule = null;
            if (globalThis.Crossbind && globalThis.Crossbind.initNative.terminate) {
                globalThis.Crossbind.initNative.terminate();
            }
        };

        // Every generated module owns initNative(): one call boots the runtime and binds
        // every imported module, so the app calls it from whichever import it already has.
        export { __crossbindInit as initNative };
    `;
}

function getReactNativeScript(env) {
    return `
        import { NativeModules } from 'react-native';
        import Module from '@crossbind/core-embind-jsi';

        const { RNJsiLib } = NativeModules;

        function setEnv() {
            const env = JSON.parse('${env}');
            const CROSSBIND_DATA_PATH = Module.Crossbind.getEnv('CROSSBIND_DATA_PATH');

            Object.entries(env).forEach(([key, value]) => {
                Module.Crossbind.setEnv(key, value.replace('_CROSSBIND_DATA_PATH_', CROSSBIND_DATA_PATH), false);
            });
        }

        // Starting the JSI lib twice re-runs every embind registration and aborts with
        // "Cannot register public name ... twice", so __crossbindInit keeps this to one call.
        async function __crossbindBoot() {
            if (!RNJsiLib || !RNJsiLib.start) {
                throw new Error('Module failed to initialise.');
            }
            await RNJsiLib.start();
            setEnv();
            return Module;
        }
    `;
}

function getWebScript(env) {
    const params = `{
        ...config,
        env: {...${env}, ...config.env},
        paths: {
            wasm: 'crossbind.wasm',
            data: 'crossbind.data.txt',
            worker: 'crossbind.js',
            js: 'crossbind.js',
        }
    }`;

    return `
        function __crossbindBoot(config) {
            return import(/* webpackIgnore: true */ '/crossbind.js')
                .then(n => window.Crossbind.initNative(${params}));
        }
    `;
}
