import { setCoercionModule, wrapModuleForCoercion } from './adapters/vector-coercion.js';
import { patchModuleForExceptionDecode } from './adapters/exception-decode.js';

export function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

export function mergeDeep(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (isObject(source[key])) {
                if (!target[key]) Object.assign(target, { [key]: {} });
                mergeDeep(target[key], source[key]);
            } else {
                Object.assign(target, { [key]: source[key] });
            }
        }
    }

    return mergeDeep(target, ...sources);
}

export function composeAdapters(adapters) {
    const composed = {};
    const extendFns = [];
    const readyFns = [];
    for (const a of adapters) {
        if (!a) continue;
        if (a.getDefaultPathPrefix) composed.getDefaultPathPrefix = a.getDefaultPathPrefix;
        if (a.getDataPath) composed.getDataPath = a.getDataPath;
        if (a.finalizePath) composed.finalizePath = a.finalizePath;
        if (a.extendModule) extendFns.push(a.extendModule);
        if (a.onModuleReady) readyFns.push(a.onModuleReady);
    }
    if (extendFns.length) {
        composed.extendModule = (m, config) => extendFns.forEach((fn) => fn(m, config));
    }
    if (readyFns.length) {
        composed.onModuleReady = async (m, config) => {
            for (const fn of readyFns) {
                await fn(m, config);
            }
        };
    }
    return composed;
}

function buildLocateFile(config, adapter) {
    return function locateFile(fileName) {
        let path = fileName;
        if (config.paths && config.paths.wasm && fileName.endsWith('.wasm')) {
            path = config.paths.wasm;
        } else if (config.paths && config.paths.data && (fileName.endsWith('.data.txt') || fileName.endsWith('.data'))) {
            path = config.paths.data;
        }

        let prefix = '';
        if (config.path) {
            prefix = config.path;
            if (prefix.slice(-1) !== '/') prefix += '/';
        } else if (adapter.getDefaultPathPrefix) {
            prefix = adapter.getDefaultPathPrefix();
        }

        let output = prefix + path;
        if (output.endsWith('.data')) output += '.txt';
        if (adapter.finalizePath) output = adapter.finalizePath(output);

        return output;
    };
}

// WASMFS's FS.writeFile writes at the end of a file that exists (emsdk 6.0.9 js_api.cpp), where the classic FS
// replaces it; opening the file for writing empties it first.
function replaceOnWriteFile(FS) {
    const { writeFile } = FS;
    FS.writeFile = (path, data) => {
        FS.close(FS.open(path, 'w'));
        return writeFile(path, data);
    };
}

export function createBaseModule(Module, config, adapter) {
    return new Promise((resolve, reject) => {
        const locateFile = buildLocateFile(config, adapter);
        const dataPath = adapter.getDataPath ? adapter.getDataPath() : '/crossbind';

        const m = {
            print(text) {
                if (config.logHandler) {
                    config.logHandler(text, 'stdout');
                } else {
                    console.debug(`wasm stdout: ${text}`);
                }
            },
            printErr(text) {
                if (config.errorHandler) {
                    config.errorHandler(text, 'stderr');
                } else {
                    console.error(`wasm stderr: ${text}`);
                }
            },
            locateFile,
            preRun: [
                ({ ENV }) => {
                    if (ENV && config && config.env) {
                        Object.entries(config.env).forEach(([key, value]) => {
                            ENV[key] = value?.replace('_CROSSBIND_DATA_PATH_', dataPath);
                        });
                    }
                },
            ],
            unmount() {},
            toArray(vector) {
                if (Array.isArray(vector)) return vector;
                const len = vector.size();
                const output = new Array(len);
                for (let i = 0; i < len; i += 1) {
                    output[i] = vector.get(i);
                }
                return output;
            },
            toVector(classOrName, array = []) {
                const VectorClass = typeof classOrName === 'string' ? m[classOrName] : classOrName;
                const vector = new VectorClass();
                array.forEach((item) => {
                    vector.push_back(item);
                });
                return vector;
            },
        };

        if (adapter.extendModule) adapter.extendModule(m, config);

        if (config.getWasmFunction) {
            m.instantiateWasm = function instantiateWasm(info, receive) {
                const instance = new WebAssembly.Instance(config.getWasmFunction(), info);
                receive(instance);
                return instance.exports;
            };
        }

        // onModuleReady may need to await async setup (e.g. the OPFS preflight in
        // fs-browser), which emscripten's onRuntimeInitialized callback cannot, so
        // both hooks run after the factory settles - adapter first, then the user's.
        Module(m).then(async (mod) => {
            if (mod.FS) replaceOnWriteFile(mod.FS);
            if (adapter.onModuleReady) await adapter.onModuleReady(mod, config);
            if (config.onRuntimeInitialized) config.onRuntimeInitialized(mod);
            return mod;
        }).then(resolve).catch(reject);
    });
}

export function createInitCrossbind({
    Module, systemConfig, adapter, worker,
}) {
    let crossbindPromise;

    function createModule(config) {
        return createBaseModule(Module, config, adapter);
    }

    if (worker && worker.isWorkerScope) {
        worker.exposeWorker(systemConfig, createModule);
    }

    function initNative(userConfig = {}) {
        if (crossbindPromise) return crossbindPromise;

        const config = mergeDeep(systemConfig, userConfig);

        if (worker && config.useWorker && !worker.isWorkerScope) {
            crossbindPromise = worker.initWithWorker(config, userConfig);
        } else {
            // Direct (non-worker) mode: wrap the module so plain-array arguments coerce to
            // embind vectors like they do in worker mode. Narrow wrapper — only the module's
            // own calls, leaving HEAP*/FS/returned objects raw (see wrapModuleForCoercion).
            crossbindPromise = createModule(config).then((m) => {
                setCoercionModule(m);
                // Instance/static methods stay raw in direct mode, so the decode has to
                // land on the class prototypes themselves.
                patchModuleForExceptionDecode(m);
                return wrapModuleForCoercion(m);
            });
        }

        return crossbindPromise;
    }

    initNative.terminate = function terminate() {
        if (worker && worker.terminate) worker.terminate();
        crossbindPromise = null;
    };

    if (typeof globalThis === 'object') {
        globalThis.Crossbind = { initNative };
    }

    return initNative;
}
