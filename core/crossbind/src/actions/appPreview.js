import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import upath from 'upath';
import state from '../state/index.js';
import { getFilteredBuildTargets, getTargetParams } from './target.js';
import buildDependencies from './buildDependencies.js';
import buildWasm from './buildWasm.js';
import createLib from './createLib.js';
import isSourceNewer from './isSourceNewer.js';
import { createBridges } from './nativeBridges.js';
import { packageManagerOf } from './addExtension.js';
import findFiles from '../utils/findFiles.js';
import { resolveAppPageApi } from '../utils/resolveAppHost.js';
import { identityLine, previewBlockers } from '../utils/previewBlockers.js';
import { previewModuleSource } from '../utils/previewModule.js';
import { PREVIEW_PROTOCOL, newPreviewKey } from '../utils/previewSession.js';
import {
    defaultRouteAddress, previewHost, previewPort, urlHost,
} from '../utils/previewAddress.js';

const { version: CROSSBIND_VERSION } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const UPDATES = {
    npm: 'npm update crossbind', pnpm: 'pnpm up crossbind', yarn: 'yarn up crossbind', bun: 'bun update crossbind',
};
// What tells a bundler plugin it builds an app, which a preview's web build leaves out.
const APP_BUILD_ENV = ['CROSSBIND_APP_BUILD', 'CROSSBIND_APP_PLATFORM', 'CROSSBIND_APP_DEVICE'];
const APP_HEADER = /#\s*include\s*[<"]crossbind\/app\.h[>"]/;

// The web build's targets of its dev server, as the bundler plugins pick them: the debug build links, the release
// target's bridges bind.
function webTargets() {
    const params = getTargetParams({ platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'] }, true);
    const [release] = getFilteredBuildTargets(params, { buildType: 'release' });
    const [debug] = getFilteredBuildTargets(params, { buildType: 'debug' });
    return { params, release, debug: debug ?? release };
}

// Vite 8.1 brought server.ws, 8.0 the console's forwarding, which a preview's page and terminal take.
export function viteProblem(name, version) {
    const [major, minor] = String(version).split('.').map((part) => Number.parseInt(part, 10));
    if (major > 8 || (major === 8 && minor >= 1)) return null;
    return `crossbind: crossbind app preview needs Vite 8.1 or later, and this project has ${name === 'vite' ? '' : `${name} `}${version}: update vite.`;
}

// The project's own crossbind/app as Node imports it, whose names the module of the project's side passes on.
export async function projectPageApi(file = resolveAppPageApi()) {
    let api;
    try {
        api = await import(pathToFileURL(file).href);
    } catch (error) {
        throw new Error(`crossbind: crossbind app preview reads the names of this project's crossbind/app from ${file}, which Node cannot import: ${error.message}. Update @crossbind/core-app-host to match crossbind.`, { cause: error });
    }
    previewModuleSource(api);
    return api;
}

const nativeFiles = () => {
    const { paths, ext } = state.config;
    const pattern = `**/*.{${[...ext.source, ...ext.header, 'rs'].join(',')}}`;
    return [...new Set([...paths.native, ...paths.header])].filter((dir) => fs.existsSync(dir)).flatMap((dir) => findFiles(pattern, { cwd: dir }));
};

// A compile that stopped at <crossbind/app.h>, which a web build does not have, named by the files that include it.
export function appHeaderBlocker(error, files, project) {
    const said = `${error?.cause?.stdout ?? ''}${error?.cause?.stderr ?? ''}`;
    if (!said.includes('crossbind/app.h')) return null;
    const including = files.filter((file) => APP_HEADER.test(fs.readFileSync(file, 'utf8'))).map((file) => upath.relative(project, file));
    return new Error(`crossbind: ${including.join(', ') || "the project's native code"} includes <crossbind/app.h>, the app's native API, which a preview's WebAssembly does not have: keep it under #ifdef CROSSBIND_APP, or run crossbind app dev.`, { cause: error });
}

// The web build's native code, as the page's first /crossbind.js would build it, so a compile that fails stops the
// preview before it prints its address.
async function buildNative({ params, release, debug }, files) {
    await buildDependencies({ targetParams: { ...params, buildType: [debug.buildType] } });
    const force = isSourceNewer(debug);
    let sourceBuilt;
    try {
        sourceBuilt = createLib(debug, 'Source', { force, buildSource: true });
    } catch (error) {
        throw appHeaderBlocker(error, files, state.config.paths.project) ?? error;
    }
    const bridges = createBridges(release).map(({ bridge }) => bridge);
    const nativeGlob = [`${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`, ...bridges];
    const bridgeBuilt = createLib(debug, 'Bridge', { force, buildSource: false, nativeGlob });
    await buildWasm(debug, { force: force || Boolean(sourceBuilt) || Boolean(bridgeBuilt) });
}

// crossbind app preview: what it checks before it prints anything, in order, then the project's Vite in preview mode,
// whose exit code it gives back.
export default async function appPreview({
    host, port, args, viteName, viteVersion, runVite,
}) {
    // The web build's native code compiles without CROSSBIND_APP here, and its dev server is no app's.
    for (const variable of APP_BUILD_ENV) delete process.env[variable];
    const vite = viteProblem(viteName, viteVersion);
    if (vite) throw new Error(vite);
    await projectPageApi();
    const targets = webTargets();
    const blockers = previewBlockers(state.config, targets.debug);
    if (blockers.length > 0) throw new Error(blockers.join('\n'));
    const where = previewHost(host, host === undefined || ['0.0.0.0', '::'].includes(host) ? await defaultRouteAddress() : null);
    const chosenPort = await previewPort(where.listen, port);
    const files = nativeFiles();
    if (files.length > 0) await buildNative(targets, files);

    const key = newPreviewKey();
    const { name } = state.config.general;
    const update = UPDATES[packageManagerOf(state.config.paths.project, process.env.npm_config_user_agent)];
    const address = `${urlHost(where.address)}:${chosenPort}`;
    const identity = identityLine(state.config);
    console.log(`crossbind app preview: ${name}, protocol ${PREVIEW_PROTOCOL}, Vite ${viteVersion}`);
    console.log(`  on ${address}${where.interface ? ` (${where.interface})` : ''}${where.listen === where.address ? '' : `, listening on ${where.listen}`}`);
    console.log(`  open: http://${address}/#k=${key}`);
    if (identity) console.log(`  ${identity}`);

    const session = { protocol: PREVIEW_PROTOCOL, project: { name }, crossbind: CROSSBIND_VERSION, update };
    const preview = JSON.stringify({
        key, address: where.address, listen: where.listen, port: chosenPort, session, update,
    });
    return runVite(args, { ...process.env, CROSSBIND_APP_PREVIEW: preview });
}
