import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import createCompanionResolver from './resolveCompanionPackage.js';

const PKG = '@crossbind/core-app-host';

const resolveAppHostRoot = createCompanionResolver({
    pkg: PKG,
    siblingDir: 'app-host',
    siblingMarker: 'cpp/src/main.cpp',
    missingMessage: `crossbind: apps need ${PKG} - add it to your devDependencies.`,
});

export default resolveAppHostRoot;

// The embind runtime ships in @crossbind/core-embind-jsi, a dependency of the app host package.
export function resolveAppEmbindJsiRoot() {
    const req = createRequire(path.join(resolveAppHostRoot(), 'package.json'));
    return path.dirname(fs.realpathSync(req.resolve('@crossbind/core-embind-jsi/package.json')));
}

// crossbind/app as an app's page imports it, which the app host assembles with what crossbind's own extensions give the page.
export function resolveAppPageApi() {
    const file = path.join(resolveAppHostRoot(), 'js', 'app.js');
    if (!fs.existsSync(file)) throw new Error(`crossbind: the app host at ${resolveAppHostRoot()} has no crossbind/app for an app's page: update ${PKG} to match crossbind.`);
    return fs.realpathSync(file);
}

// The same for a page a bundler builds for the browser, where a project has the app host: code an app shares with its
// web build still bundles, and what it calls rejects as outside an app. A project without the host has none.
export function findAppPageApi() {
    try {
        return resolveAppPageApi();
    } catch {
        return null;
    }
}
