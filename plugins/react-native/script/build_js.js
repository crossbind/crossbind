
/* eslint-disable no-empty */
import { state, prepareConanDependencies } from 'crossbind';
import upath from 'upath';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isBridgeFresh, saveBridgeStamp } from './bridgeCache.js';

const projectRequire = createRequire(`${state.config.paths.project}/package.json`);

const platform = process.argv.length === 3 ? process.argv[2] : 'web';
const bundleOutput = `${state.config.paths.build}/metro-${platform}.js`;

// Metro resolves conan: imports, and SWIG reads their headers, for the platform's first target.
const metroTarget = state.targets.find((target) => target.platform === platform);
if (metroTarget) await prepareConanDependencies([metroTarget]);

if (isBridgeFresh(platform, bundleOutput)) {
    console.log(`crossbind: bridge bundle (${platform}) up to date — skipping Metro.`);
} else {
    await buildBridgeBundle();
    saveBridgeStamp(platform, bundleOutput);
}

async function buildBridgeBundle() {
    const Metro = (await import('metro')).default;

    let exportEmbedAsync;
    let resolveOptions;
    let isExpo = false;

    // Only enter the Expo path when expo is a declared dependency of the consuming app.
    // Without this guard, hoisted/peer copies in monorepos (e.g. pnpm's .pnpm/node_modules)
    // can satisfy `expoRequire.resolve('@expo/cli/...')` and we end up running an Expo bundler
    // against a non-Expo project, which fails with "Serializer did not return expected format".
    const projectDependencies = {
        ...(state.config.package?.dependencies || {}),
        ...(state.config.package?.devDependencies || {}),
        ...(state.config.package?.peerDependencies || {}),
    };

    if (projectDependencies.expo) {
        try {
            // Expo nests @expo/cli under node_modules/expo/node_modules/@expo/cli, so it is not
            // resolvable from this script's location. Resolve it through the user's expo package.
            const expoRequire = createRequire(projectRequire.resolve('expo/package.json'));
            const exportEmbedPath = expoRequire.resolve('@expo/cli/build/src/export/embed/exportEmbedAsync.js');
            const resolveOptionsPath = expoRequire.resolve('@expo/cli/build/src/export/embed/resolveOptions.js');
            const exportEmbedMod = await import(pathToFileURL(exportEmbedPath).href);
            const resolveOptionsMod = await import(pathToFileURL(resolveOptionsPath).href);
            exportEmbedAsync = exportEmbedMod.exportEmbedAsync ?? exportEmbedMod.default?.exportEmbedAsync;
            resolveOptions = resolveOptionsMod.resolveOptions ?? resolveOptionsMod.default?.resolveOptions;
            isExpo = !!exportEmbedAsync && !!resolveOptions;
        } catch (e) {}
    }

    const modulePath = state.config.package.main ? getModulePath(state.config.package.main) : null;
    const entry = modulePath ? upath.relative(state.config.paths.project, modulePath) : 'index.js';

    const config = await Metro.loadConfig();

    if (isExpo) {
        const options = await callResolveOptions(resolveOptions, {
            '--entry-file': entry,
            '--bundle-output': bundleOutput,
            '--platform': platform,
        });
        await exportEmbedAsync(state.config.paths.project, options);
    } else {
        // See callResolveOptions for why a warm transform cache must not be reused here.
        await Metro.runBuild({ ...config, resetCache: true }, {
            entry,
            platform,
            minify: true,
            dev: false,
            sourceMap: false,
            out: bundleOutput,
        });
    }
}

async function callResolveOptions(resolveOptions, args) {
    // --reset-cache forces Metro to re-run our babel-transformer for .h files, which is
    // what writes the SWIG bridge .i.cpp consumed by the iOS build below. With a warm
    // Metro cache (e.g. from a prior `expo start`), the transform is skipped, the bridge
    // is never written, and the embind class never gets registered at runtime.
    const parsed = { args: { '--dev': false, '--minify': true, '--reset-cache': true } };
    // Expo CLI 0.30+ (Expo 53+) added projectRoot as the first argument.
    if (resolveOptions.length >= 3) {
        return resolveOptions(state.config.paths.project, args, parsed);
    }
    return resolveOptions(args, parsed);
}

function getModulePath(moduleName) {
    let resolvedPath;
    try {
        resolvedPath = projectRequire.resolve(moduleName);
    } catch (e) {
        try {
            resolvedPath = import.meta.resolve(moduleName).replace('file://', '');
        } catch (e2) {
            return null;
        }
    }

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        return resolvedPath;
    }

    const extensions = ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'];
    for (const ext of extensions) {
        const fullPath = resolvedPath + ext;
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }
    return null;
}
