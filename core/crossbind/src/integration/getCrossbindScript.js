import fs from 'node:fs';
import path from 'node:path';
import getData from '../actions/getData.js';
import loadJson from '../utils/loadJson.js';
import state from '../state/index.js';
import { parseSurface, createRustBridgeCrate, createCrateImportBridge } from '../utils/rustBridgeGen.js';
import { parseCargoMarkerName } from '../utils/cargoImport.js';
import { UNBOUND_MESSAGE } from '../assets/js-runtime/adapters/unboundMessage.js';

// `base` is where the bundler serves the app from, as Vite's `base` names it; webpack's public path wins at run time.
// Metro asks for `liveExports`: it keeps a header's module as it first transformed it while the app's imports change.
export default function getCrossbindScript(target, bridgePath, { base = '/', liveExports: isLive = false } = {}) {
    if (!bridgePath) {
        throw new Error('getCrossbindScript needs the bridge file of the imported header');
    }
    const script = buildScript(target, loadJson(`${bridgePath}.exports.json`), base);
    return isLive ? `${script}${liveExportsScript()}` : script;
}

// A name the module does not export comes off the booted module: undefined before initNative. A name the module the page
// or app loaded lacks, exported or not, is a function that says why. Serialized into the generated module, so it
// references nothing outside itself.
export function liveExports(exportsObject, unbound) {
    return new Proxy(exportsObject, {
        get(target, name, receiver) {
            const value = Reflect.get(target, name, receiver);
            const bound = globalThis.__crossbindModule;
            if (value != null || !bound || typeof name !== 'string' || ['then', 'default', 'toJSON'].includes(name)) return value;
            if (bound[name] !== undefined) return bound[name];
            if (!/^[A-Za-z_]\w*$/.test(name)) return value;
            return function notBound() {
                throw new Error(`crossbind: ${name} ${unbound}`);
            };
        },
    });
}

function liveExportsScript() {
    return `
        const __crossbindLiveExports = ${liveExports.toString()};
        if (typeof module === 'object' && module) module.exports = __crossbindLiveExports(module.exports, ${JSON.stringify(UNBOUND_MESSAGE)});
    `;
}

// The Rust analog of a .h import: parse the crate surface and emit the same proxy module
// (per-symbol lets assigned inside this module's initNative). Vectors come from the owning
// cargo package's config; classes/enums come from the parsed source.
export function getRustJsScript(target, rsFile, { base = '/' } = {}) {
    return buildScript(target, getRustSymbols(rsFile), base);
}

// The names a Rust import exports. An app-local file or a cargo: crate gets its bridge crate here, the way a header
// gets its bridge from createBridgeFile.
export function getRustSymbols(rsFile) {
    // Compare real paths: dependency paths go through node_modules symlinks (pnpm workspaces)
    // while bundlers hand the transformer the resolved real file.
    const realCrateDir = (d) => {
        try { return fs.realpathSync(path.resolve(d.paths.project, d.export.crate ?? 'crate')); } catch (e) { return null; }
    };
    const rsReal = fs.realpathSync(rsFile);

    // Marker under <cache>/rust-crates/: a direct crate import - the model comes from the
    // upstream crate's own source, and the bridge is synthesized against the cargo dependency.
    const { crateName, modulePath } = parseCargoMarkerName(path.basename(rsReal, '.rs'));
    const cargoDeps = state.config.cargoDependencies ?? {};
    if (Object.hasOwn(cargoDeps, crateName)
        && path.dirname(rsReal) === fs.realpathSync(path.join(state.config.paths.cache, 'rust-crates'))) {
        const { exports } = createCrateImportBridge({
            crateName,
            modulePath,
            spec: cargoDeps[crateName],
            cacheDir: state.config.paths.cache,
            dtsMode: state.config.dts,
            log: () => {},
        });
        // A crate registers its public names under per-crate names (two crates may export the
        // same name), so the proxy exports the clean name and reads the registered one off the module.
        return exports;
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
    return [
        ...model.classes.map((c) => c.name),
        ...(model.streams ?? []).map((s) => s.name),
        ...model.enums.map((e) => e.name),
        ...(model.freeFns ?? []).map((f) => f.jsName),
        // `pub const`/`pub static` register as module constants, so the proxy exports them too.
        ...(model.consts ?? []).map((c) => c.name),
        ...vectors.map((v) => v.name),
    ];
}

function buildScript(target, symbols, base) {
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
        ${getPlatformScript(env, base)}

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
        import { TurboModuleRegistry } from 'react-native';
        import Module from '@crossbind/core-embind-jsi';

        const RNJsiLib = TurboModuleRegistry.get('RNJsiLib');

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

function getWebScript(env, base) {
    const params = `{
        path: base,
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
            const base = new URL((typeof __webpack_public_path__ === 'string' ? __webpack_public_path__ : ${JSON.stringify(base)}) || './', document.baseURI).href;
            return import(/* webpackIgnore: true */ /* @vite-ignore */ base + 'crossbind.js')
                .then(n => window.Crossbind.initNative(${params}));
        }
    `;
}
