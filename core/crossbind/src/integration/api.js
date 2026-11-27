import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import upath from 'upath';
import state from '../state/index.js';
import buildDependencies from '../actions/buildDependencies.js';
import createBridgeFile from '../actions/createInterface.js';
import pageLicensesAsset from '../actions/pageLicenses.js';
import { checkInstaller, shipApp } from '../actions/appInstaller.js';
import {
    appOutputName, appPlatform, buildProjectApp, emptyAppOutDir, publishApp,
} from '../actions/buildApp.js';
import isAppBuild from '../utils/appBuild.js';
import appSourceFiles, { appSourceImports } from '../utils/appSources.js';
import { findAppPageApi, resolveAppPageApi } from '../utils/resolveAppHost.js';
import {
    PAGE_API_PATH, guardServer, previewGate, previewOf, previewSocketGate,
} from '../utils/previewSession.js';
import { PREVIEW_MODULE_ID, previewModuleSource } from '../utils/previewModule.js';
import appDevSession from './appDevSession.js';
import bindHeaderImports from './bindHeaderImports.js';
import getCrossbindScript, { getRustJsScript } from './getCrossbindScript.js';
import getDependFilePath from './getDependFilePath.js';
import {
    ISOLATION_HEADERS, createLinker, devChange, outputsOf, serveOutputs, writeOutputs,
} from './glue.js';
import {
    NO_WEB_TARGET, appTargets, nativeTarget, webTargets,
} from './pageTargets.js';

function kindOf(file) {
    if (file.endsWith('.rs')) return 'rust';
    const { header, module, source } = state.config.ext;
    const has = (extensions) => extensions.some((extension) => file.endsWith(`.${extension}`));
    if (has(header)) return 'header';
    if (has(module)) return 'module';
    if (has(source)) return 'source';
    return null;
}

function filesUnder(dir) {
    return fs.readdirSync(dir).flatMap((name) => {
        const file = upath.join(dir, name);
        const stats = fs.statSync(file);
        if (stats.isFile()) return [file];
        return stats.isDirectory() ? filesUnder(file) : [];
    });
}

// A Rust package ships no JS entry, so a tool that resolves a bare import as Node does finds its crate root instead.
function rustPackages() {
    return (state.config.allDependencies ?? [])
        .filter((dep) => dep.export?.type === 'cargo' && dep.package?.name)
        .map((dep) => ({ name: dep.package.name, entry: upath.resolve(dep.paths.project, dep.export.crate ?? 'crate', 'src/lib.rs') }))
        .filter(({ entry }) => fs.existsSync(entry));
}

// A preview, which crossbind app preview runs: the page takes crossbind/app from the crossbind app on the device, which
// answers PAGE_API_PATH itself, through a module of the project's side, and opens its socket to this server at the one
// address a device reaches; the server answers the device that opened it alone. The web build --cloud uploads takes the
// page's part alone: no server, and no key.
function previewApi(preview) {
    if (!preview) return null;
    return Object.freeze({
        moduleId: PREVIEW_MODULE_ID,
        pageApiPath: PAGE_API_PATH,
        // Where the dev server listens, and the address and port a device reaches it at.
        server() {
            if (preview.build) throw new Error("crossbind: CROSSBIND_APP_PREVIEW names a preview's web build, which serves nothing: crossbind app preview sets it.");
            return { listen: preview.listen, port: preview.port, address: preview.address };
        },
        async moduleSource() {
            return previewModuleSource(await import(pathToFileURL(resolveAppPageApi()).href));
        },
        // The gate stands in front of the server's own handler; the socket gate reads the tool's resolved config, the
        // socket's token among it.
        guard(httpServer, { logger, configOf }) {
            guardServer(httpServer, previewGate(preview, logger));
            httpServer.prependListener('upgrade', previewSocketGate(configOf, logger));
        },
    });
}

// What a bundler integration needs of crossbind, once per tool session: the targets of the page it builds, what turns a
// native import into a module, the glue it links and serves or emits, and an app's build and dev session.
export default function integrationApi() {
    const isApp = isAppBuild();
    // One entry per bridge: a repeated one would change the Bridge lib's fingerprint.
    const bridges = new Set();
    let page = null;
    let preview;
    let app = null;

    const pageTargets = () => {
        page ??= isApp ? appTargets() : webTargets();
        if (!page) throw new Error(NO_WEB_TARGET);
        return page;
    };
    const prepare = (target) => buildDependencies({ targetParams: { ...pageTargets().params, buildType: [target.buildType] } });
    const linker = createLinker(bridges, prepare);

    const appApi = () => Object.freeze({
        get platform() {
            return appPlatform();
        },
        get targets() {
            return pageTargets().all;
        },
        // Before the dependencies compile: each app goes beside what installs it, whose names, signing keys and
        // installers stop the build here if they cannot be.
        async check() {
            for (const target of pageTargets().all) await checkInstaller(target);
        },
        async build() {
            for (const target of pageTargets().all) await buildProjectApp(target);
        },
        // The page, once written, goes into the app beside it: one project of every SDK or ABI for iOS and Android, one
        // app per arch for a desktop, which then ships with what installs it. The installers write beside the apps, so
        // they run once every app has its page, which would take their files in.
        async publish(dir) {
            const { release, all } = pageTargets();
            const apps = ['ios', 'android'].includes(release.platform) ? [release] : all;
            const published = apps.map((target) => ({ target, to: publishApp(target, { to: `${dir}/${appOutputName(target)}`, page: dir }) }));
            for (const { target, to } of published) await shipApp(target, to);
        },
        emptyOutDir: (dir) => emptyAppOutDir(dir),
        dev: (tool) => appDevSession(tool, kindOf),
    });

    return Object.freeze({
        get ext() {
            const { header, module, source } = state.config.ext;
            return { header: [...header], module: [...module], source: [...source] };
        },
        // What crossbind writes itself, the project, and where crossbind.config.js puts the page's files: null leaves them to
        // the tool.
        get dirs() {
            const {
                build, cache, project, output,
            } = state.config.paths;
            return {
                build, cache, project, output: output === build ? null : output,
            };
        },
        isolationHeaders: ISOLATION_HEADERS,
        // The page's build: a browser's wasm, or in an app build the app's host. Each of release and debug stands in for
        // the other when crossbind.config.js leaves one out.
        get targets() {
            return pageTargets();
        },
        // The web build, or null when crossbind.config.js leaves no wasm32 browser target.
        get web() {
            return webTargets();
        },
        nativeTarget,
        get app() {
            if (!isApp) return null;
            app ??= appApi();
            return app;
        },
        get preview() {
            if (isApp) return null;
            if (preview === undefined) preview = previewApi(previewOf());
            return preview;
        },
        kindOf,
        // crossbind/app: the app host's page api.
        pageApi: () => (isApp ? resolveAppPageApi() : findAppPageApi()),
        // A dependency's file for an import: a package's header, a cargo: crate, a Conan package's header.
        resolve: (source, target) => getDependFilePath(source, target) ?? null,
        // Before any transform: a header's bridge reads the include roots of every dependency, and a cargo dependency built
        // for another target only is there but lacks this one until the build makes it.
        prepare,
        // `atBase`: the integration serves the glue at `base` itself, which a bundler's public path then does not replace.
        transform(file, target, { base = '/', liveExports = false, atBase = false } = {}) {
            const kind = kindOf(file);
            // A Rust surface needs no bridge file: its native bridge is the package's generated companion crate, or the
            // app's own, and this emits only the JS proxy module.
            if (kind === 'rust') return getRustJsScript(target, file, { base, atBase });
            if (kind !== 'header' && kind !== 'module') return null;
            const bridge = createBridgeFile(file, target);
            bridges.add(bridge);
            return getCrossbindScript(target, bridge, { base, liveExports, atBase });
        },
        // A tool that keeps a header's module while the app's imports change binds the headers a source imports again.
        bindImports: (code, file, target) => bindHeaderImports(code, file, target),
        link: linker.link,
        outputs: outputsOf,
        writeOutputs,
        serve: (target, options) => serveOutputs(linker, target, options),
        // The names the app imports decide what a header binds, so a watcher transforms a header again after any of these.
        appSources: () => appSourceFiles(state.config.paths.project),
        // What those sources import, past comments and imports of types alone, for a tool that names each import ahead.
        appImports: () => appSourceImports(state.config.paths.project),
        nativeDirs: () => [...state.config.paths.native],
        nativeFiles: () => state.config.paths.native.filter((dir) => fs.existsSync(dir)).flatMap(filesUnder),
        rustPackages,
        changed: (file) => devChange(file, { kindOf, bridges, ...pageTargets() }),
        // A page that reads its licenses with crossbind/licenses finds them beside it.
        licenses: (bundle, { root }) => pageLicensesAsset(bundle, { root, platform: pageTargets().release.platform, runtimeEnv: isApp ? 'app' : null }),
    });
}
