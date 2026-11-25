import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { WORKER_ENV } from './transformer.cjs';

const TRANSFORMER = createRequire(import.meta.url).resolve('./transformer.cjs');

// Whether the app renders on the web, as an Expo app with react-native-web does: one without it has no web build.
function rendersOnWeb(projectRoot) {
    try {
        createRequire(path.join(projectRoot, 'package.json')).resolve('react-native-web');
        return true;
    } catch {
        return false;
    }
}

// The transformer the config had, Expo's or React Native's as getDefaultConfig names it, which crossbind's hands every
// file to: a config may name it by its package, which the app resolves.
function upstreamOf(appRequire, config, projectRoot) {
    const named = config.transformer.babelTransformerPath ?? 'metro-babel-transformer';
    try {
        return appRequire.resolve(named);
    } catch (error) {
        throw new Error(`crossbind: Metro's config names the transformer ${named}, which ${projectRoot} cannot resolve: wrap the config getDefaultConfig() gives, as crossbind(getDefaultConfig(__dirname)) does.`, { cause: error });
    }
}

// Expo's export writes the files its serializer hands back, so a web export's glue joins them, linked once every module
// has transformed, which is when the serializer runs, from the bridges the transforms wrote. Only js and css files
// become tags of the page. A server's bundle, as Expo's static rendering makes, and a dev server's need none.
function withGlue(api, serializer) {
    if (typeof serializer !== 'function') return serializer;
    const wrapped = async (entryPoint, preModules, graph, options) => {
        const result = await serializer(entryPoint, preModules, graph, options);
        const { platform, dev, customTransformOptions } = graph.transformOptions;
        const environment = customTransformOptions?.environment;
        if (platform !== 'web' || dev || environment === 'node' || environment === 'react-server' || !api.web) return result;
        const parsed = typeof result === 'string' ? JSON.parse(result) : result;
        if (!Array.isArray(parsed?.artifacts)) return result;
        const { release } = api.web;
        await api.link(release, { prepare: true, allBridges: true });
        api.outputs(release).forEach(({ name, path: file, optional }) => {
            if (optional && !fs.existsSync(file)) return;
            parsed.artifacts.push({ filename: name, originFilename: name, type: 'crossbind', metadata: {}, source: fs.readFileSync(file) });
        });
        return parsed;
    };
    return Object.assign(wrapped, { __originalSerializer: serializer.__originalSerializer });
}

// Expo's dev server serves the web app, and the glue its bundle boots is served here: a page load asks for the glue
// first, so serving it is where a changed source or a newly imported header gets linked in, under Expo's
// experiments.baseUrl, which need not be the root. Metro transforms the .h imports in worker processes, so the link
// reads their bridges from the build directory.
function withWebGlue(api, middleware) {
    const { web } = api;
    if (!web) return middleware;
    const serve = api.serve(web.debug, { link: { prepare: true, allBridges: true } });
    return (req, res, next) => {
        // A multithreaded wasm needs SharedArrayBuffer, which only a cross-origin isolated page has.
        if (web.debug.runtime === 'mt') Object.entries(api.isolationHeaders).forEach(([name, value]) => res.setHeader(name, value));
        serve(req, res, () => middleware(req, res, next));
    };
}

// The config crossbind(config) gives Metro, which awaits it: the web build's dependencies are staged first, as Metro
// resolves imports against the files it finds as it starts.
export default async function wrap(api, config) {
    await api.ready();
    const projectRoot = config.projectRoot || process.cwd();
    if (api.web && rendersOnWeb(projectRoot)) await api.prepare(api.web.release);
    const appRequire = createRequire(path.join(projectRoot, 'package.json'));
    process.env[WORKER_ENV] = JSON.stringify({ api: api.workerModule, upstream: upstreamOf(appRequire, config, projectRoot) });
    // Generated proxy modules (e.g. a cargo package's lib.rs) originate in package workspaces outside the app's
    // node_modules chain, so their bare imports (react-native, @babel/runtime, @crossbind/core-embind-jsi, ...) fall back
    // to the app's resolution. extraNodeModules is consulted only when normal resolution fails, so everything else is
    // untouched.
    const appNodeModules = new Proxy({}, {
        get: (_, name) => {
            try {
                return path.dirname(appRequire.resolve(`${String(name)}/package.json`));
            } catch {
                return path.join(projectRoot, 'node_modules', String(name));
            }
        },
    });
    const resolveRequest = config.resolver.resolveRequest ?? ((context, moduleName, platform) => context.resolveRequest(context, moduleName, platform));
    const enhanceMiddleware = config.server?.enhanceMiddleware;

    return {
        ...config,
        resetCache: true,
        resolver: {
            ...config.resolver,
            extraNodeModules: appNodeModules,
            sourceExts: [...config.resolver.sourceExts, ...api.ext.header, ...api.ext.module, 'rs'],
            resolveRequest: (context, moduleName, platform) => {
                const target = platform === 'web' ? api.web?.release : api.nativeTarget(platform);
                const dependFilePath = target && api.resolve(moduleName, target);
                return resolveRequest(context, dependFilePath || moduleName, platform);
            },
        },
        transformer: {
            ...config.transformer,
            babelTransformerPath: TRANSFORMER,
        },
        serializer: {
            ...config.serializer,
            customSerializer: withGlue(api, config.serializer?.customSerializer),
        },
        server: {
            ...config.server,
            // Metro deprecates enhanceMiddleware, but Expo still builds its middleware stack from it.
            enhanceMiddleware: (metroMiddleware, metroServer) => withWebGlue(api, enhanceMiddleware?.(metroMiddleware, metroServer) ?? metroMiddleware),
        },
    };
}
