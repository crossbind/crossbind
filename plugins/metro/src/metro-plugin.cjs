const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { WEB_FILES, getWebTargets, buildWebGlue } = require('./web.cjs');

let crossbind;
const crossbindPromise = import('crossbind').then((module) => {
    crossbind = module;
});

// A web page load asks for the glue first, so serving it is where a changed source or a newly
// imported header gets linked in. Requests that arrive meanwhile (a pthread pool's) share the build,
// and the wasm and data wait for it instead of reading what it is still writing.
let inFlightBuild = null;

async function serveWebFile({ targetParams, debug: target }, file, res) {
    if (file.name === 'crossbind.js') {
        inFlightBuild = inFlightBuild || buildWebGlue(crossbind, targetParams, target).finally(() => { inFlightBuild = null; });
    }
    await inFlightBuild;
    // A page reloaded during the build has gone; piping a file to its response would leak the handle.
    if (res.destroyed) return;
    const filePath = `${crossbind.state.config.paths.build}/${target[file.output]}`;
    if (!fs.existsSync(filePath)) {
        res.statusCode = 404;
        res.end();
        return;
    }
    res.setHeader('Content-Type', file.contentType);
    await pipeline(fs.createReadStream(filePath), res);
}

function createWebMiddleware(middleware) {
    return (req, res, next) => {
        crossbindPromise.then(() => {
            const webTargets = getWebTargets(crossbind);
            if (webTargets?.debug.runtime === 'mt') {
                // A multithreaded wasm needs SharedArrayBuffer, which only a cross-origin isolated page has.
                res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
                res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            }
            // The boot code asks under Expo's experiments.baseUrl, which need not be the root.
            const pathname = req.url.split('?')[0];
            const file = webTargets && req.method === 'GET' && WEB_FILES.find(({ name }) => pathname.endsWith(`/${name}`));
            if (!file) {
                return middleware(req, res, next);
            }
            return serveWebFile(webTargets, file, res).catch((error) => {
                // A page that reloads mid-download closes the response; nothing failed.
                if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
                console.error(error);
                if (res.headersSent || res.destroyed) return;
                res.statusCode = 500;
                res.setHeader('Content-Type', 'text/plain');
                res.end(error.message);
            });
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
                if (crossbind) {
                    const target = platform === 'web'
                        ? getWebTargets(crossbind)?.release
                        : crossbind.state.targets.find((t) => t.platform === platform);
                    const dependFilePath = target && crossbind.getDependFilePath(moduleName, target);
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
