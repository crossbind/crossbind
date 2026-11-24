import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { integrationApi } from 'crossbind';
import rollupCrossbindPlugin from '@crossbind/plugin-rollup';

const glueOf = (api, target) => api.outputs(target).find(({ name }) => name === 'crossbind.js').path;

// During development an app opens on the dev server, and the app's session builds and reopens it: see crossbind's
// appDevSession. Closing the window, or the app on the Simulator or device, ends the session and the server.
function appDevPlugin(api) {
    let isServe = false;
    let isEmptiedHere = false;
    let outDir = null;
    let server = null;
    const session = api.app.dev({
        invalidate: () => server.moduleGraph.invalidateAll(),
        end: (status) => server.close().then(() => process.exit(status)),
        error: (message) => server.config.logger.error(message),
    });

    return {
        name: 'vite-plugin-crossbind-app',
        // Gradle writes reports into the Android project it builds, in crossbind's own directory, and an HTML file there
        // would reload the page. An iPhone or iPad reaches the dev server at this Mac's address on its cable or network,
        // which alone the server listens on, unless Vite's own --host names an address or every one. The alias, which runs
        // before Vite's own resolving, takes a page's crossbind/app from the app host. The page reads the platform it is
        // built for, which leaves the code of the others out of the build.
        config(userConfig, { command }) {
            const watch = { ignored: [`${api.dirs.cache}/**`, `${api.dirs.build}/**`] };
            const resolve = { alias: [{ find: /^crossbind\/app$/, replacement: api.pageApi() }] };
            const define = { 'import.meta.env.CROSSBIND_APP_PLATFORM': JSON.stringify(api.app.platform) };
            // A build for one platform keeps the apps that builds for the others wrote beside the page, so crossbind empties
            // the folder in Vite's place, unless the project says how Vite does.
            isEmptiedHere = command === 'build' && userConfig.build?.emptyOutDir === undefined;
            const build = isEmptiedHere ? { emptyOutDir: false } : {};
            if (command !== 'serve') return { resolve, define, server: { watch }, build };
            try {
                return { resolve, define, server: { watch, host: session.host(userConfig.server?.host) }, build };
            } catch (error) {
                // What the developer mends, as a device to connect or a setting to turn on, needs no stack, which Vite
                // would print with an error it starts with.
                console.error(error.message);
                process.exit(1);
            }
        },
        configResolved(config) {
            isServe = config.command === 'serve';
            const dir = path.resolve(config.root, config.build.outDir);
            const inRoot = path.relative(config.root, dir);
            // As Vite, which empties no folder outside the project's root.
            outDir = isEmptiedHere && inRoot && !inRoot.startsWith('..') && !path.isAbsolute(inRoot) ? dir : null;
        },
        buildStart() {
            if (outDir) api.app.emptyOutDir(outDir);
        },
        async load(source) {
            if (!isServe || source !== '/crossbind.js') return null;
            return session.glue();
        },
        configureServer(devServer) {
            session.begin();
            server = devServer;
            devServer.httpServer?.once('listening', () => {
                const { port } = devServer.httpServer.address();
                session.open({ port, base: devServer.config.base }).catch((error) => devServer.config.logger.error(error.message));
            });
            devServer.httpServer?.once('close', session.stop);
            process.once('exit', session.stop);
        },
        async handleHotUpdate({ file }) {
            const change = await session.changed(file);
            if (!change) return undefined;
            return change.reopened || change.native ? [] : undefined;
        },
    };
}

// A preview, which crossbind app preview runs: the page takes crossbind/app from the crossbind app on the device, which
// answers the page api's path itself, through a module of the project's side, reads the device's platform as each module
// starts, and opens its socket to this server at the one address a device reaches; the server answers the device that
// opened it alone. Vite turns an external id that is no URL into one it loads, so the page api's path loads a module that
// says where it belongs; the dependency optimizer would bundle the project's own copy of crossbind/app, so it leaves it
// out. The web build --cloud uploads takes the page's part alone: no server, and no key.
function previewPlugin(preview) {
    return {
        name: 'vite-plugin-crossbind-preview',
        enforce: 'pre',
        config(userConfig, { command }) {
            const page = {
                define: { 'import.meta.env.CROSSBIND_APP_PLATFORM': 'globalThis.__crossbind_device?.platform' },
                optimizeDeps: { exclude: ['crossbind/app', 'crossbind/app/core'] },
            };
            if (command !== 'serve') return page;
            const { listen, port, address } = preview.server();
            const host = net.isIPv6(address) ? `[${address}]` : address;
            return {
                ...page,
                server: {
                    host: listen,
                    port,
                    strictPort: true,
                    ws: { host, clientPort: port },
                    forwardConsole: { unhandledErrors: true, logLevels: ['log', 'info', 'warn', 'error', 'debug'] },
                    // Vite checks each request's Host, which an address passes and a name only as it is listed.
                    ...(net.isIP(address) ? {} : { allowedHosts: [address] }),
                },
            };
        },
        resolveId(id) {
            if (id === 'crossbind/app' || id === 'crossbind/app/core') return preview.moduleId;
            return id === preview.pageApiPath ? { id: preview.pageApiPath, external: true } : null;
        },
        async load(id) {
            if (id === preview.moduleId) return preview.moduleSource();
            if (id !== preview.pageApiPath) return null;
            return `throw new Error('crossbind: this page opens in the crossbind app, which serves ${preview.pageApiPath} itself');`;
        },
        configureServer(server) {
            // The gate stands in front of the server itself, which Vite's middleware mode leaves to another.
            if (!server.httpServer) throw new Error("crossbind: a preview runs on Vite's own server: leave server.middlewareMode out.");
            preview.guard(server.httpServer, { logger: server.config.logger, configOf: () => server.config });
            // The address is crossbind app preview's to print, with its key; Vite's own would open the gate's 403.
            server.printUrls = () => {};
        },
    };
}

const isolate = (api, res) => Object.entries(api.isolationHeaders).forEach(([name, value]) => res.setHeader(name, value));

const viteCrossbindPlugin = (options) => {
    const api = integrationApi();
    if (api.app) {
        return [rollupCrossbindPlugin(options, api), appDevPlugin(api)];
    }
    // What crossbind app preview hands the web build's dev server it starts.
    const { preview } = api;
    const { debug } = api.targets;
    let isServe = false;
    let base = '/';

    return [
        ...(preview ? [previewPlugin(preview)] : []),
        rollupCrossbindPlugin(options, api),
        {
            name: 'vite-plugin-crossbind',
            // A page an app shares with its web build takes crossbind/app from the app host here too, and reads that it is
            // built for no app's platform, which leaves the apps' code out of the build. A preview's page takes both from
            // the device's app instead.
            config() {
                if (preview) return {};
                const pageApi = api.pageApi();
                if (!pageApi) return {};
                return {
                    resolve: { alias: [{ find: /^crossbind\/app$/, replacement: pageApi }] },
                    define: { 'import.meta.env.CROSSBIND_APP_PLATFORM': 'undefined' },
                };
            },
            async load(source) {
                if (!isServe || source !== '/crossbind.js') return null;
                // Each request for the glue loads it again (see the middleware), and parallel pages share the link in
                // flight instead of each linking over the same outputs.
                await api.link(debug, { prepare: true });
                return fs.readFileSync(glueOf(api, debug), { encoding: 'utf8', flag: 'r' });
            },
            configResolved(config) {
                isServe = config.command === 'serve';
                base = config.base;
                if (isServe) {
                    config.server.fs.allow.push(api.dirs.build);
                }
            },
            configureServer(server) {
                if (!isServe) return;
                server.middlewares.use((req, res, next) => {
                    isolate(api, res);
                    // The app asks under its base, which vite strips only after this middleware.
                    const url = req.url.startsWith(base) ? `/${req.url.slice(base.length)}` : req.url;
                    if (url === '/crossbind.js') {
                        // The glue depends on the bridge set, which grows as .h imports are transformed; vite would
                        // otherwise serve the cached load() result forever. Invalidate so the load hook re-runs - cheap
                        // when nothing changed, and it heals a request that raced ahead of the transforms.
                        const mod = server.moduleGraph.getModuleById('/crossbind.js');
                        if (mod) server.moduleGraph.invalidateModule(mod);
                    } else {
                        const output = api.outputs(debug).find(({ name }) => url === `/${name}`);
                        if (output) req.url = `${base}@fs/${output.path}`;
                    }
                    next();
                });
            },
            configurePreviewServer(server) {
                server.middlewares.use((req, res, next) => {
                    isolate(api, res);
                    next();
                });
            },
            async handleHotUpdate({ file, server }) {
                const change = await api.changed(file);
                if (!change) return undefined;
                change.headers?.flatMap((header) => [...(server.moduleGraph.getModulesByFile(header) ?? [])])
                    .forEach((mod) => server.moduleGraph.invalidateModule(mod));
                server.ws.send({ type: 'full-reload' });
                return change.headers ? [] : undefined;
            },
        },
    ];
};

export default viteCrossbindPlugin;
