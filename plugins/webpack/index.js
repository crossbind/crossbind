
import fs from 'node:fs';
import path from 'node:path';
import {
    state, createLib, buildWasm, createBridgeFile, getData, getCrossbindScript, getRustJsScript, getDependFilePath, buildDependencies, getTargetParams, getFilteredBuildTargets, isSourceNewer,
    appSourceFiles,
} from 'crossbind';

const targetParams = getTargetParams({ platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'] }, true);
let buildTargetRelease = getFilteredBuildTargets(targetParams, { buildType: 'release' })?.[0];
let buildTargetDebug = getFilteredBuildTargets(targetParams, { buildType: 'debug' })?.[0];

if (!buildTargetRelease && !buildTargetDebug) {
    throw new Error('No build targets found');
}

if (!buildTargetDebug) {
    buildTargetDebug = buildTargetRelease;
} else if (!buildTargetRelease) {
    buildTargetRelease = buildTargetDebug;
}

const buildTargetFor = (mode) => (mode === 'development' ? buildTargetDebug : buildTargetRelease);

export default class CrossbindWebpackPlugin {
    static defaultOptions = {};

    constructor(options = {}) {
        this.options = { ...CrossbindWebpackPlugin.defaultOptions, ...options };
        this.bridges = [];
    }

    apply(compiler) {
        const pluginName = this.constructor.name;
        compiler.options.resolve = compiler.options.resolve || {};
        compiler.options.resolve.alias = compiler.options.resolve.alias || {};
        // `cargo:` imports use the node:/npm: convention for a non-npm store; webpack's resolver
        // has no such scheme, so the request is rewritten to the generated marker .rs (which the
        // loader then turns into the crate-import bridge). Works on rspack via its compat layer.
        new compiler.webpack.NormalModuleReplacementPlugin(/^cargo:/, (resource) => {
            const marker = getDependFilePath(resource.request, buildTargetRelease);
            if (marker) resource.request = marker;
        }).apply(compiler);
        // A dependency's header (`@crossbind/port-zlib/zlib.h`) names the package, not a file: it lives in the
        // package's prebuilt include directory for the target, as the Vite and Metro plugins resolve it.
        new compiler.webpack.NormalModuleReplacementPlugin(new RegExp(`\\.(${state.config.ext.header.join('|')})$`), (resource) => {
            const header = getDependFilePath(resource.request, buildTargetRelease);
            if (header) resource.request = header;
        }).apply(compiler);
        // Rust packages ship no JS entry at all (their package.json is just a name), so node
        // resolution can never find them. Each known cargo-type dependency gets an exact-match
        // alias onto its crate root; the loader's .rs branch turns that into the proxy module.
        for (const dep of state.config.allDependencies ?? []) {
            if (dep.export?.type !== 'cargo' || !dep.package?.name) continue;
            const libRs = path.resolve(dep.paths.project, dep.export.crate ?? 'crate', 'src/lib.rs');
            if (fs.existsSync(libRs) && !(`${dep.package.name}$` in compiler.options.resolve.alias)) {
                compiler.options.resolve.alias[`${dep.package.name}$`] = libRs;
            }
        }
        // Before any loader runs: a header's bridge reads the include roots of every dependency, conan's staged
        // packages included, and a cargo dependency built for another target only is there but lacks this one
        // until the build makes it.
        const buildDeps = () => buildDependencies({ targetParams: { ...targetParams, buildType: [buildTargetFor(compiler.options.mode).buildType] } });
        compiler.hooks.beforeRun.tapPromise(pluginName, buildDeps);
        compiler.hooks.watchRun.tapPromise(pluginName, buildDeps);
        // tapPromise (not tap) so webpack awaits the native C++/wasm build and a build
        // failure surfaces as a compilation error instead of an unhandled rejection.
        compiler.hooks.done.tapPromise(pluginName, this.onDone.bind(this));
        compiler.hooks.afterCompile.tapAsync(pluginName, this.afterCompile.bind(this));
    }

    afterCompile(compilation, callback) {
        state.config.paths.native.map((file) => compilation.contextDependencies.add(file));
        callback();
    }

    async onDone({ compilation }) {
        const isDev = compilation.options.mode === 'development';
        const buildTarget = buildTargetFor(compilation.options.mode);
        const force = isSourceNewer(buildTarget);
        const sourceBuilt = createLib(buildTarget, 'Source', { force, buildSource: true });
        // Bridge cache is keyed on the nativeGlob fingerprint: a changed bridge
        // set rebuilds the lib even without source changes, and a rebuilt lib
        // must force the final link too.
        const bridgeBuilt = createLib(buildTarget, 'Bridge', { force, buildSource: false, nativeGlob: [`${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`, ...this.bridges] });
        await buildWasm(buildTarget, { force: force || Boolean(sourceBuilt) || Boolean(bridgeBuilt) });
        if (!isDev) {
            const output = state.config.paths.output === state.config.paths.build ? compilation.options.output.path : state.config.paths.output;
            // On a first-ever build the output dir may not exist yet when this
            // hook runs; copyFileSync reports that as ENOENT too.
            fs.mkdirSync(output, { recursive: true });
            fs.copyFileSync(`${state.config.paths.build}/${buildTarget.jsName}`, `${output}/crossbind.js`);
            fs.copyFileSync(`${state.config.paths.build}/${buildTarget.wasmName}`, `${output}/crossbind.wasm`);

            const dataFilePath = `${state.config.paths.build}/${buildTarget.dataTxtName}`;
            if (fs.existsSync(dataFilePath)) {
                fs.copyFileSync(dataFilePath, `${output}/crossbind.data.txt`);
            }
            /* const workerFilePath = `${state.config.paths.build}/${state.config.general.name}.js`;
            if (fs.existsSync(workerFilePath)) {
                fs.copyFileSync(workerFilePath, `${output}/cpp.worker.js`);
            } */
        }
    }

    getLoaderOptions() {
        return {
            bridges: this.bridges,
            appSourceFiles,
            createBridgeFile,
            getData,
            state,
            getCrossbindScript,
            getRustJsScript,
            getTargetParams,
            getFilteredBuildTargets
        };
    }

    getRule() {
        return {
            // `rs` rides the same rule: the loader branches on the extension.
            test: new RegExp(`\\.(${[...state.config.ext.header, 'rs'].join('|')})$`),
            loader: '@crossbind/plugin-webpack-loader',
            options: { ...this.getLoaderOptions() },
        };
    }

    setDevServerMiddleware(middlewares, devServer) {
        if (!devServer) {
            throw new Error('devServer is not defined');
        }

        // The boot code asks under webpack's public path, which need not be the root.
        const asksFor = (req, name) => req.url.split('?')[0].endsWith(`/${name}`);

        middlewares.unshift({
            name: '/crossbind.js',
            middleware: (req, res, next) => {
                if (!asksFor(req, 'crossbind.js')) {
                    next();
                    return;
                }
                const filePath = `${state.config.paths.build}/${buildTargetDebug.jsName}`;
                res.setHeader('Content-Type', 'application/javascript');
                res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
                fs.createReadStream(filePath).pipe(res);
            },
        });

        middlewares.unshift({
            name: '/crossbind.wasm',
            middleware: (req, res, next) => {
                if (!asksFor(req, 'crossbind.wasm')) {
                    next();
                    return;
                }
                const filePath = `${state.config.paths.build}/${buildTargetDebug.wasmName}`;
                res.setHeader('Content-Type', 'application/wasm');
                res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
                fs.createReadStream(filePath).pipe(res);
            },
        });

        middlewares.unshift({
            name: '/crossbind.data.txt',
            middleware: (req, res, next) => {
                if (!asksFor(req, 'crossbind.data.txt')) {
                    next();
                    return;
                }
                const filePath = `${state.config.paths.build}/${buildTargetDebug.dataTxtName}`;
                res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
                if (!fs.existsSync(filePath)) {
                    res.statusCode = 404;
                    res.end();
                    return;
                }
                fs.createReadStream(filePath).pipe(res);
            },
        });

        return middlewares;
    }

    getDevServerConfig() {
        return {
            watchFiles: state.config.paths.native,
            hot: true,
            liveReload: true,
            headers: {
                'Cross-Origin-Opener-Policy': 'same-origin',
                'Cross-Origin-Embedder-Policy': 'require-corp',
            },
            setupMiddlewares: (middlewares, devServer) => {
                return this.setDevServerMiddleware(middlewares, devServer);
            },
        };
    }
}
