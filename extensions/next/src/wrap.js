import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const LOADER = createRequire(import.meta.url).resolve('./loader.cjs');
// Next's phase for `next dev`.
const DEV_SERVER = 'phase-development-server';
// Where `next build` puts the page's files in its output, which Next serves at /_next/static.
const GLUE_DIR = ['static', 'crossbind'];
// Where `next dev` asks for them, which a rewrite hands to crossbind's own server.
const DEV_GLUE = '/_crossbind';
// The specifier of each import and export a source makes.
const IMPORTS = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"\n]+)['"]/g;

const relativeTo = (root, file) => `./${path.relative(root, file).split(path.sep).join('/')}`;

// The file of an import crossbind resolves that names no file a bundler finds, or null: a dependency's header, a `cargo:`
// crate, a Rust package, which ships no JS entry.
function namedFiles(api, target) {
    const rustEntries = new Map(api.rustPackages().map(({ name, entry }) => [name, entry]));
    return (request) => rustEntries.get(request)
        ?? (request.startsWith('cargo:') || api.kindOf(request) === 'header' ? api.resolve(request, target) : null);
}

// Turbopack has no resolver crossbind can hook, so each such import becomes an alias, read from the app's sources as
// Next loads the config.
function aliasesOf(api, fileOf) {
    const requests = new Set(api.appSources().flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(IMPORTS)].map(([, request]) => request)));
    return [...requests].flatMap((request) => {
        if (request.startsWith('.') || request.startsWith('/')) return [];
        const file = fileOf(request);
        return file ? [[request, file]] : [];
    });
}

// The isolation headers on every route, which a multithreaded page needs and Next sends in dev and on `next start`.
const isolation = (api) => ({ source: '/:path*', headers: Object.entries(api.isolationHeaders).map(([key, value]) => ({ key, value })) });

// `next dev` gets the debug glue from crossbind's own server, which links it as the page asks for it, once the page's
// modules have bound their headers, as Vite's and Metro's dev servers do: a Next config adds no middleware, so a rewrite
// hands the requests on. Turbopack binds the headers in processes of its own, so the link reads every bridge. A
// multithreaded page's workers load the glue too, which their isolation needs on its own answer.
async function serveDevGlue(api) {
    const serve = api.serve(api.targets.debug, { link: { prepare: true, allBridges: true }, isolate: true });
    const server = http.createServer((req, res) => serve(req, res, () => {
        res.statusCode = 404;
        res.end();
    }));
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    // Next may load its config in more than one process; a server no request reaches keeps none of them running.
    server.unref();
    return `http://127.0.0.1:${server.address().port}`;
}

// A config's rewrites, in either form Next takes, with the dev glue's first.
function withDevGlue(rewrites, origin) {
    const glue = { source: `${DEV_GLUE}/:file`, destination: `${origin}/:file` };
    if (rewrites === undefined || Array.isArray(rewrites)) return { beforeFiles: [glue], afterFiles: rewrites ?? [] };
    return { ...rewrites, beforeFiles: [glue, ...(rewrites.beforeFiles ?? [])] };
}

// The config crossbind(config) gives Next, which calls it with the phase: crossbind's loader on native files under
// Turbopack and webpack alike, the release glue linked after `next build` compiles, and under `next dev` the debug glue
// served as the page asks. A dependency's header is in its release build, which a debug link reads too, so the imports
// resolve and the headers bind for the release target in either phase, as in crossbind's webpack plugin.
export default function wrap(api, config) {
    return async (phase, context) => {
        const userConfig = (typeof config === 'function' ? await config(phase, context) : config) ?? {};
        await api.ready();
        const { project } = api.dirs;
        const { release } = api.targets;
        await api.prepare(release);
        const isDev = phase === DEV_SERVER;
        const basePath = (userConfig.basePath ?? '').replace(/\/$/, '');
        const assetPrefix = (userConfig.assetPrefix || basePath).replace(/\/$/, '');
        const devGlue = isDev ? await serveDevGlue(api) : null;
        const base = isDev ? `${basePath}${DEV_GLUE}/` : `${assetPrefix}/_next/static/crossbind/`;
        const loader = { loader: LOADER, options: { workerModule: api.workerModule, base } };
        const { header, module } = api.ext;
        const extensions = [...header, ...module, 'rs'];
        const fileOf = namedFiles(api, release);
        const aliases = aliasesOf(api, fileOf);
        const { turbopack = {}, compiler = {} } = userConfig;

        return {
            ...userConfig,
            turbopack: {
                ...turbopack,
                rules: { ...Object.fromEntries(extensions.map((ext) => [`*.${ext}`, { loaders: [loader], as: '*.js' }])), ...turbopack.rules },
                // Turbopack takes an alias's target relative to the project.
                resolveAlias: { ...Object.fromEntries(aliases.map(([request, file]) => [request, relativeTo(project, file)])), ...turbopack.resolveAlias },
            },
            webpack(webpackConfig, webpackContext) {
                const configured = userConfig.webpack ? userConfig.webpack(webpackConfig, webpackContext) : webpackConfig;
                configured.module.rules.push({ test: new RegExp(`\\.(${extensions.join('|')})$`), use: [loader] });
                // webpack reads `cargo:` and `conan:` as URL schemes before any alias, so a named import is replaced
                // before it resolves, as crossbind's webpack plugin does.
                configured.plugins.push(new webpackContext.webpack.NormalModuleReplacementPlugin(/./, (resource) => {
                    const file = fileOf(resource.request);
                    if (file) resource.request = file;
                }));
                return configured;
            },
            ...(isDev ? { rewrites: async () => withDevGlue(await userConfig.rewrites?.(), devGlue) } : {}),
            ...(release.runtime === 'mt' ? { headers: async () => [...((await userConfig.headers?.()) ?? []), isolation(api)] } : {}),
            compiler: {
                ...compiler,
                async runAfterProductionCompile(metadata) {
                    await compiler.runAfterProductionCompile?.(metadata);
                    // Turbopack's loaders bound the headers in their workers, so the link reads every bridge.
                    await api.link(release, { prepare: true, allBridges: true });
                    api.writeOutputs(release, path.join(metadata.distDir, ...GLUE_DIR));
                },
            },
        };
    };
}
