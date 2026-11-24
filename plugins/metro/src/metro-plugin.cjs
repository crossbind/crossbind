const path = require('node:path');

let api;
const apiPromise = import('crossbind').then(({ integrationApi }) => {
    api = integrationApi();
});

function createWebMiddleware(middleware) {
    return (req, res, next) => {
        apiPromise.then(() => {
            const { web } = api;
            if (!web) return middleware(req, res, next);
            if (web.debug.runtime === 'mt') {
                // A multithreaded wasm needs SharedArrayBuffer, which only a cross-origin isolated page has.
                Object.entries(api.isolationHeaders).forEach(([name, value]) => res.setHeader(name, value));
            }
            // A web page load asks for the glue first, so serving it is where a changed source or a newly imported header
            // gets linked in, under Expo's experiments.baseUrl, which need not be the root. Metro transforms the .h imports
            // in worker processes, so the link reads their bridges from the build directory.
            const serve = api.serve(web.debug, { link: { prepare: true, allBridges: true } });
            return serve(req, res, () => middleware(req, res, next));
        }).catch(next);
    };
}

module.exports = function CrossbindMetroPlugin(defaultConfig) {
    // Generated proxy modules (e.g. a cargo package's lib.rs) originate in package workspaces
    // outside the app's node_modules chain, so their bare imports (react-native, @babel/runtime,
    // @crossbind/core-embind-jsi, ...) must fall back to the app's resolution. extraNodeModules is
    // consulted only when normal resolution fails, so everything else is untouched.
    const projectRoot = defaultConfig.projectRoot || process.cwd();
    const appNodeModules = new Proxy({}, {
        get: (_, name) => {
            try {
                return path.dirname(require.resolve(`${String(name)}/package.json`, { paths: [projectRoot] }));
            } catch (e) {
                return path.join(projectRoot, 'node_modules', String(name));
            }
        },
    });

    return {
        resetCache: true,
        resolver: {
            extraNodeModules: appNodeModules,
            sourceExts: [...defaultConfig.resolver.sourceExts, ...['h', 'hpp', 'hxx', 'hh'], ...['i'], ...['rs']],
            resolveRequest: (context, moduleName, platform) => {
                // The `crossbind` import above resolves asynchronously; until it lands (and for
                // platforms with no matching target) fall back to Metro's default resolution
                // instead of dereferencing undefined state.
                if (api) {
                    const target = platform === 'web' ? api.web?.release : api.nativeTarget(platform);
                    const dependFilePath = target && api.resolve(moduleName, target);
                    if (dependFilePath) {
                        return context.resolveRequest(context, dependFilePath, platform);
                    }
                }

                return context.resolveRequest(context, moduleName, platform);
            },
        },
        transformer: {
            ...defaultConfig.transformer,
            babelTransformerPath: require.resolve('./metro-transformer.cjs'),
        },
        server: {
            ...defaultConfig.server,
            // Expo's dev server serves the web app, and the wasm its bundle boots is served from here.
            // Metro deprecates enhanceMiddleware, but Expo still builds its middleware stack from it.
            enhanceMiddleware: (metroMiddleware, metroServer) => createWebMiddleware(
                defaultConfig.server?.enhanceMiddleware?.(metroMiddleware, metroServer) ?? metroMiddleware,
            ),
        },
    };
};
