import crypto from 'node:crypto';
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
import { PREVIEW_PROTOCOL, listedNameProblem, newPreviewKey } from '../utils/previewSession.js';
import {
    defaultRouteAddress, listedAddress, previewHost, previewPort, urlHost,
} from '../utils/previewAddress.js';
import { cloudUrl } from '../utils/cloudAccount.js';
import loadSystemConfig from '../utils/systemConfig.js';
import { halfBlocks, qrMatrix } from '../utils/qrMatrix.js';
import {
    dayWords, listSession, previewAccount, removeSnapshot, uploadSnapshot,
} from './cloudCommands.js';

const { version: CROSSBIND_VERSION } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const UPDATES = {
    npm: 'npm update crossbind', pnpm: 'pnpm up crossbind', yarn: 'yarn up crossbind', bun: 'bun update crossbind',
};
// What tells a bundler plugin it builds an app, which a preview's web build leaves out.
const APP_BUILD_ENV = ['CROSSBIND_APP_BUILD', 'CROSSBIND_APP_PLATFORM', 'CROSSBIND_APP_DEVICE'];
const APP_HEADER = /#\s*include\s*[<"]crossbind\/app\.h[>"]/;
// What a QR code or a link opens a session with: crossbind.dev's page, which hands it to the crossbind app. It names
// the session alone; the device reads the rest, the key among it, from its own account's list.
const OPEN_PAGE = 'https://crossbind.dev/open/';
const SESSION_ID_BYTES = 16;
const PROJECT_ID_BYTES = 16;
// Black on bright white, so that a terminal's dark theme does not turn the code over.
const BLACK_ON_WHITE = ['\x1b[30;107m', '\x1b[0m'];

// The project's id on the account's list, the same at each run and for no other project, from its name and its root's
// real path, with nothing written to disk.
export const projectIdOf = (name, root) => crypto.createHash('sha256').update(`crossbind-project.${name}.${fs.realpathSync(root)}`).digest()
    .subarray(0, PROJECT_ID_BYTES).toString('base64url');

// A session's QR code as the terminal shows it, in its own colours under NO_COLOR.
export const qrLines = (link, env = process.env) => halfBlocks(qrMatrix(link).modules)
    .map((line) => (env.NO_COLOR ? line : `${BLACK_ON_WHITE[0]}${line}${BLACK_ON_WHITE[1]}`));

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

// What a preview prints: its project, the account it opens on, where it runs, and the QR code of its link, which names
// the session alone.
function printPreview({
    name, viteVersion, account, id, where,
}) {
    const link = `${OPEN_PAGE}?s=${id}`;
    const identity = identityLine(state.config);
    console.log(`crossbind app preview: ${name}, protocol ${PREVIEW_PROTOCOL}, Vite ${viteVersion}`);
    console.log(`  signed in to crossbind cloud as ${account.name}`);
    where.forEach((line) => console.log(`  ${line}`));
    console.log(`  scan this with a phone's camera, or open ${link}`);
    qrLines(link).forEach((line) => console.log(`  ${line}`));
    console.log(`  Projects lists it in the crossbind app on every device signed in as ${account.name}`);
    if (identity) console.log(`  ${identity}`);
}

// --cloud: the project's web build in preview mode, which takes no key, uploaded as a snapshot that the crossbind app on
// the account's devices lists and opens from anywhere; it prints the same QR code, and ends.
async function uploadedPreview({
    url, account, args, viteVersion, runVite,
}) {
    const { name } = state.config.general;
    const outDir = `${state.config.paths.build}/snapshot`;
    const built = await runVite(['build', '--outDir', outDir, '--emptyOutDir', ...args], { ...process.env, CROSSBIND_APP_PREVIEW: JSON.stringify({ build: true }) });
    if (built !== 0) return built;
    const { id, version, expiresOn } = await uploadSnapshot({
        url, token: account.token, project: { id: projectIdOf(name, state.config.paths.project), name }, protocol: PREVIEW_PROTOCOL, dir: outDir,
    });
    printPreview({
        name, viteVersion, account, id, where: [`uploaded as a snapshot, version ${version}, kept until ${dayWords(expiresOn)}`],
    });
    return 0;
}

// --cloud --remove: the project's snapshot removed from crossbind cloud, found as an upload finds it. It needs the
// project's name, which crossbind cloud lists projects by, and this machine's sign-in, and nothing of a web build.
async function removedPreview() {
    const { name } = state.config.general;
    const named = listedNameProblem(name);
    if (named) throw new Error(named);
    const url = cloudUrl(loadSystemConfig());
    const account = await previewAccount({ url });
    await removeSnapshot({
        url, token: account.token, project: { id: projectIdOf(name, state.config.paths.project), name }, protocol: PREVIEW_PROTOCOL,
    });
    console.log(`crossbind app preview: ${name}`);
    console.log(`  signed in to crossbind cloud as ${account.name}`);
    console.log(`  removed its snapshot from crossbind cloud: no device signed in as ${account.name} lists it now`);
    return 0;
}

// crossbind app preview: what it checks before it prints anything, in order, the account it opens on, then the
// project's Vite in preview mode, whose exit code it gives back, with its session on the account's list meanwhile; with
// --cloud (`asSnapshot`), its web build uploaded as a snapshot instead, or with --remove too (`isRemoval`), the
// snapshot removed.
export default async function appPreview({
    host, port, asSnapshot, isRemoval, args, viteName, viteVersion, runVite,
}) {
    if (isRemoval && !asSnapshot) throw new Error('crossbind: --remove removes this project\'s snapshot from crossbind cloud, with --cloud: crossbind app preview --cloud --remove.');
    if (isRemoval) return removedPreview();
    // The web build's native code compiles without CROSSBIND_APP here, and its dev server is no app's.
    for (const variable of APP_BUILD_ENV) delete process.env[variable];
    const vite = viteProblem(viteName, viteVersion);
    if (vite) throw new Error(vite);
    await projectPageApi();
    const targets = webTargets();
    const blockers = previewBlockers(state.config, targets.debug);
    if (blockers.length > 0) throw new Error(blockers.join('\n'));
    const named = listedNameProblem(state.config.general.name);
    if (named) throw new Error(named);
    const cloud = cloudUrl(loadSystemConfig());
    const account = await previewAccount({ url: cloud });
    if (asSnapshot) {
        return uploadedPreview({
            url: cloud, account, args, viteVersion, runVite,
        });
    }
    const where = previewHost(host, host === undefined || ['0.0.0.0', '::'].includes(host) ? await defaultRouteAddress() : null);
    const chosenPort = await previewPort(where.listen, port);
    const files = nativeFiles();
    if (files.length > 0) await buildNative(targets, files);

    const key = newPreviewKey();
    const id = crypto.randomBytes(SESSION_ID_BYTES).toString('base64url');
    const { name } = state.config.general;
    const update = UPDATES[packageManagerOf(state.config.paths.project, process.env.npm_config_user_agent)];
    const address = `${urlHost(where.address)}:${chosenPort}`;
    const listed = await listSession({
        url: cloud,
        token: account.token,
        id,
        session: {
            source: 'dev',
            project: { id: projectIdOf(name, state.config.paths.project), name },
            addresses: [listedAddress(where.address, chosenPort)],
            protocol: PREVIEW_PROTOCOL,
            key,
        },
    });
    printPreview({
        name,
        viteVersion,
        account,
        id,
        where: [
            `on ${address}${where.interface ? ` (${where.interface})` : ''}${where.listen === where.address ? '' : `, listening on ${where.listen}`}`,
            `open: http://${address}/#k=${key}`,
        ],
    });

    const session = {
        protocol: PREVIEW_PROTOCOL, project: { name }, crossbind: CROSSBIND_VERSION, update, account: { id: account.id, name: account.name }, session: id,
    };
    const preview = JSON.stringify({
        key, address: where.address, listen: where.listen, port: chosenPort, session, update,
    });
    // A Ctrl-C ends Vite, then the preview once its session is off the list: crossbind's own end at a SIGINT
    // (utils/logger.js) is set aside until Vite has ended, and a second Ctrl-C meanwhile ends it at once.
    const onInterrupt = process.listeners('SIGINT');
    onInterrupt.forEach((listener) => process.off('SIGINT', listener));
    try {
        return await runVite(args, { ...process.env, CROSSBIND_APP_PREVIEW: preview });
    } finally {
        onInterrupt.forEach((listener) => process.on('SIGINT', listener));
        await listed.stop();
    }
}
