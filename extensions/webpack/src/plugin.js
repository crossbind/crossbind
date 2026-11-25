import { createRequire } from 'node:module';

const NAME = 'crossbind';
const LOADER = createRequire(import.meta.url).resolve('./loader.cjs');
// What the loader turns into a module.
const LOADED = ['header', 'rust'];

// webpack-dev-server 6 is a plugin that webpack-cli 7 makes from the config's devServer before any plugin runs, and it
// reads its options only as it sets up; getFreePort is the static webpack-cli calls on it.
const isDevServerPlugin = (plugin) => typeof plugin?.constructor?.getFreePort === 'function' && typeof plugin.options === 'object';

// A dev server's options with crossbind's part: the headers of an isolated page, a reload after a native source changes,
// which is no module, and in front of the rest the middleware that links and serves the glue the boot code asks for,
// under webpack's public path, which need not be the root.
function served(api, options = {}) {
    const previous = options.setupMiddlewares;
    let serve = null;
    const middleware = (req, res, next) => api.ready().then(() => {
        serve ??= api.serve(api.targets.debug, { isolate: true });
        serve(req, res, next);
    }).catch(next);
    return {
        ...options,
        hot: options.hot ?? true,
        liveReload: options.liveReload ?? true,
        headers: { ...api.isolationHeaders, ...options.headers },
        setupMiddlewares: (middlewares, devServer) => {
            api.ready().then(() => devServer.watchFiles?.(api.nativeDirs(), {})).catch((error) => devServer.logger?.error(error.message));
            return [{ name: NAME, middleware }, ...(previous ? previous(middlewares, devServer) : middlewares)];
        },
    };
}

// crossbind's plugin for webpack and Rspack, on the api crossbind() hands it: what needs crossbind's state waits for the
// compiler's first run, which the api is ready by.
export default function webpackPlugin(api) {
    return {
        name: NAME,
        apply(compiler) {
            let targets = null;
            let rustEntries = new Map();
            const ready = async () => {
                if (targets) return;
                await api.ready();
                // The web build, which a project without one stops at here.
                targets = api.targets;
                rustEntries = new Map(api.rustPackages().map(({ name, entry }) => [name, entry]));
            };
            const targetFor = (mode) => (mode === 'development' ? targets.debug : targets.release);

            compiler.options.module.rules.push({ test: (file) => Boolean(targets) && LOADED.includes(api.kindOf(file)), loader: LOADER, options: { api } });
            // A dependency's header (`@crossbind/port-zlib/zlib.h`) names the package, not a file: it lives in the
            // package's prebuilt include directory for the target. `cargo:` imports use the node:/npm: convention for a
            // non-npm store, which webpack's resolver has no scheme for, so they become the generated marker .rs. A Rust
            // package ships no JS entry, so its name becomes its crate root. The loader makes each a module.
            new compiler.webpack.NormalModuleReplacementPlugin(/./, (resource) => {
                if (!targets) return;
                const { request } = resource;
                const file = request.startsWith('cargo:') || api.kindOf(request) === 'header' ? api.resolve(request, targets.release) : rustEntries.get(request);
                if (file) resource.request = file;
            }).apply(compiler);

            // tapPromise, so webpack awaits the native C++/wasm build and a failure is the compilation's.
            const prepare = async () => {
                await ready();
                await api.prepare(targetFor(compiler.options.mode));
            };
            compiler.hooks.beforeRun.tapPromise(NAME, prepare);
            compiler.hooks.watchRun.tapPromise(NAME, prepare);
            compiler.hooks.afterCompile.tapPromise(NAME, async (compilation) => {
                await ready();
                api.nativeDirs().forEach((dir) => compilation.contextDependencies.add(dir));
            });
            compiler.hooks.done.tapPromise(NAME, async ({ compilation }) => {
                await ready();
                const target = targetFor(compilation.options.mode);
                await api.link(target);
                if (compilation.options.mode === 'development') return;
                // crossbind.config.js may name where the page's files go; else they go beside webpack's.
                api.writeOutputs(target, api.dirs.output ?? compilation.options.output.path);
            });

            if (compiler.options.devServer !== false) compiler.options.devServer = served(api, compiler.options.devServer);
            compiler.options.plugins.filter(isDevServerPlugin).forEach((plugin) => {
                plugin.options = served(api, plugin.options);
            });
        },
    };
}
