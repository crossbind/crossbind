import {
    integrationApi,
    // What getLoaderOptions() has always handed a config, which may read crossbind's state through it.
    appSourceFiles, createBridgeFile, getCrossbindScript, getData, getFilteredBuildTargets, getRustJsScript, getTargetParams, state,
} from 'crossbind';

export default class CrossbindWebpackPlugin {
    static defaultOptions = {};

    constructor(options = {}) {
        this.options = { ...CrossbindWebpackPlugin.defaultOptions, ...options };
        this.api = integrationApi();
        // The web build, which a project without one stops at here.
        this.targets = this.api.targets;
    }

    targetFor(mode) {
        return mode === 'development' ? this.targets.debug : this.targets.release;
    }

    apply(compiler) {
        const pluginName = this.constructor.name;
        const { api } = this;
        const { release } = this.targets;
        compiler.options.resolve = compiler.options.resolve || {};
        compiler.options.resolve.alias = compiler.options.resolve.alias || {};
        // `cargo:` imports use the node:/npm: convention for a non-npm store; webpack's resolver
        // has no such scheme, so the request is rewritten to the generated marker .rs (which the
        // loader then turns into the crate-import bridge). Works on rspack via its compat layer.
        new compiler.webpack.NormalModuleReplacementPlugin(/^cargo:/, (resource) => {
            const marker = api.resolve(resource.request, release);
            if (marker) resource.request = marker;
        }).apply(compiler);
        // A dependency's header (`@crossbind/port-zlib/zlib.h`) names the package, not a file: it lives in the
        // package's prebuilt include directory for the target, as the Vite and Metro plugins resolve it.
        new compiler.webpack.NormalModuleReplacementPlugin(new RegExp(`\\.(${api.ext.header.join('|')})$`), (resource) => {
            const header = api.resolve(resource.request, release);
            if (header) resource.request = header;
        }).apply(compiler);
        // Rust packages ship no JS entry at all (their package.json is just a name), so node
        // resolution can never find them. Each known cargo-type dependency gets an exact-match
        // alias onto its crate root; the loader's .rs branch turns that into the proxy module.
        for (const { name, entry } of api.rustPackages()) {
            if (!(`${name}$` in compiler.options.resolve.alias)) compiler.options.resolve.alias[`${name}$`] = entry;
        }
        const prepare = () => api.prepare(this.targetFor(compiler.options.mode));
        compiler.hooks.beforeRun.tapPromise(pluginName, prepare);
        compiler.hooks.watchRun.tapPromise(pluginName, prepare);
        // tapPromise (not tap) so webpack awaits the native C++/wasm build and a build
        // failure surfaces as a compilation error instead of an unhandled rejection.
        compiler.hooks.done.tapPromise(pluginName, this.onDone.bind(this));
        compiler.hooks.afterCompile.tapAsync(pluginName, this.afterCompile.bind(this));
    }

    afterCompile(compilation, callback) {
        this.api.nativeDirs().forEach((dir) => compilation.contextDependencies.add(dir));
        callback();
    }

    async onDone({ compilation }) {
        const target = this.targetFor(compilation.options.mode);
        await this.api.link(target);
        if (compilation.options.mode === 'development') return;
        // crossbind.config.js may name where the page's files go; else they go beside webpack's.
        this.api.writeOutputs(target, this.api.dirs.output ?? compilation.options.output.path);
    }

    getLoaderOptions() {
        return {
            api: this.api,
            appSourceFiles,
            createBridgeFile,
            getData,
            state,
            getCrossbindScript,
            getRustJsScript,
            getTargetParams,
            getFilteredBuildTargets,
        };
    }

    getRule() {
        return {
            // `rs` rides the same rule: the loader branches on the extension.
            test: new RegExp(`\\.(${[...this.api.ext.header, 'rs'].join('|')})$`),
            loader: '@crossbind/plugin-webpack-loader',
            options: { ...this.getLoaderOptions() },
        };
    }

    setDevServerMiddleware(middlewares, devServer) {
        if (!devServer) {
            throw new Error('devServer is not defined');
        }
        // The boot code asks under webpack's public path, which need not be the root.
        middlewares.unshift({ name: 'crossbind', middleware: this.api.serve(this.targets.debug, { isolate: true }) });
        return middlewares;
    }

    getDevServerConfig() {
        return {
            watchFiles: this.api.nativeDirs(),
            hot: true,
            liveReload: true,
            headers: { ...this.api.isolationHeaders },
            setupMiddlewares: (middlewares, devServer) => {
                return this.setDevServerMiddleware(middlewares, devServer);
            },
        };
    }
}
