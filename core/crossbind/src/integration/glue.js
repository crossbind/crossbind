import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import upath from 'upath';
import state from '../state/index.js';
import buildWasm from '../actions/buildWasm.js';
import createBridgeFile from '../actions/createInterface.js';
import createLib from '../actions/createLib.js';
import getAllBridges from '../actions/getAllBridges.js';
import isSourceNewer from '../actions/isSourceNewer.js';
import { isAppSource } from '../utils/appSources.js';
import withDirLock from '../utils/dirLock.js';
import { getFileHash } from '../utils/hash.js';
import { getRustJsScript } from './getCrossbindScript.js';
import { ISOLATION_HEADERS } from './isolationHeaders.js';

export { ISOLATION_HEADERS };

// The files a page's boot code asks for, each one a build output of its target. An app's page loads the runtime its
// host serves.
const WEB_OUTPUTS = [
    { name: 'crossbind.js', field: 'jsName', contentType: 'text/javascript' },
    { name: 'crossbind.wasm', field: 'wasmName', contentType: 'application/wasm' },
    { name: 'crossbind.data.txt', field: 'dataTxtName', contentType: 'text/plain', optional: true },
];
const APP_OUTPUTS = [{ name: 'crossbind.js', field: 'appJsName', contentType: 'text/javascript' }];

export function outputsOf(target) {
    const outputs = target.runtimeEnv === 'app' ? APP_OUTPUTS : WEB_OUTPUTS;
    return outputs.map(({ name, field, contentType, optional = false }) => ({
        name, path: `${state.config.paths.build}/${target[field]}`, contentType, optional,
    }));
}

export function writeOutputs(target, dir) {
    // On a first build the tool's output directory may not exist yet.
    fs.mkdirSync(dir, { recursive: true });
    outputsOf(target).forEach(({ name, path, optional }) => {
        if (optional && !fs.existsSync(path)) return;
        fs.copyFileSync(path, upath.join(dir, name));
    });
}

const commonBridges = () => `${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`;

// The Bridge lib's cache is keyed on its file list, so a changed bridge set rebuilds it; a rebuilt lib forces the link,
// or the wasm keeps the stale registrations.
async function linkGlue(target, bridges) {
    const force = isSourceNewer(target);
    const sourceBuilt = createLib(target, 'Source', { force, buildSource: true });
    const bridgeBuilt = createLib(target, 'Bridge', { force, buildSource: false, nativeGlob: [commonBridges(), ...bridges] });
    await buildWasm(target, { force: force || Boolean(sourceBuilt) || Boolean(bridgeBuilt) });
}

// One link per target at a time: a call while one runs shares it, and the first call after it settles starts anew. With
// parallel pages each would otherwise link over the same outputs, and pages would bind glue of different builds. A tool
// that links from more than one process, as Next's loaders do under `next dev`, takes turns on the build directory.
export function createLinker(bridges, prepare) {
    const linking = new Map();
    const link = (target, { prepare: withDependencies = false, allBridges = false } = {}) => {
        if (!linking.has(target)) {
            const run = async () => {
                if (withDependencies) await prepare(target);
                // A tool that transforms in other processes, as Metro does, leaves its bridges in the build directory.
                await linkGlue(target, allBridges ? getAllBridges() : [...bridges]);
            };
            const lock = `${state.config.paths.build}/link-${target.path}.lock`;
            linking.set(target, withDirLock(lock, run, { heldBy: 'another process is linking' }).finally(() => linking.delete(target)));
        }
        return linking.get(target);
    };
    return { link, running: (target) => linking.get(target) };
}

async function sendOutput(linker, target, output, res, { link, isolate }) {
    if (link && output.name === 'crossbind.js') linker.link(target, link);
    await linker.running(target);
    // A page reloaded during the build has gone; piping a file to its response would leak the handle.
    if (res.destroyed) return;
    if (isolate) Object.entries(ISOLATION_HEADERS).forEach(([name, value]) => res.setHeader(name, value));
    if (!fs.existsSync(output.path)) {
        res.statusCode = 404;
        res.end();
        return;
    }
    res.setHeader('Content-Type', output.contentType);
    await pipeline(fs.createReadStream(output.path), res);
}

// A dev server's answer for the page's boot code, under any base, from the build directory. A request for the glue
// links it first when `link` says how; every request waits for a link in flight instead of reading what it still writes.
export function serveOutputs(linker, target, { link = null, isolate = false } = {}) {
    return (req, res, next) => {
        const pathname = req.url.split('?')[0];
        const output = req.method === 'GET' && outputsOf(target).find(({ name }) => pathname.endsWith(`/${name}`));
        if (!output) {
            next();
            return;
        }
        sendOutput(linker, target, output, res, { link, isolate }).catch((error) => {
            // A page that reloads mid-download closes the response; nothing failed.
            if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
            console.error(error);
            if (res.headersSent || res.destroyed) return;
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain');
            res.end(error.message);
        });
    };
}

// The names the app imports decide what a dependency's header binds, so after a source edit each imported header binds
// again. The headers come back when a bridge changed.
function rebindHeaders(bridges, target) {
    const bridgeDir = `${state.config.paths.build}/bridge`;
    const stamp = () => (fs.existsSync(bridgeDir) ? fs.readdirSync(bridgeDir)
        .filter((name) => name.endsWith('.i.cpp'))
        .map((name) => `${name}:${getFileHash(`${bridgeDir}/${name}`)}`)
        .join('\n') : '');
    const headers = [...bridges].filter((bridge) => bridge && fs.existsSync(`${bridge}.source`))
        .map((bridge) => fs.readFileSync(`${bridge}.source`, 'utf8').trim())
        .filter((header) => fs.existsSync(header));
    const before = stamp();
    headers.forEach((header) => createBridgeFile(header, target));
    return stamp() === before ? null : headers;
}

// A dev server's answer to an edit: native code relinks the debug glue, and a source of the app binds the headers it
// imports again. Null when the edit is none of crossbind's, else the page reloads: { headers } when those headers bound
// anew, {} when the wasm was rebuilt.
export async function devChange(file, { kindOf, bridges, release, debug }) {
    const { build, cache, project } = state.config.paths;
    // The cache holds what crossbind writes itself, staged Conan headers among it.
    if (file.startsWith(build) || file.startsWith(cache)) return null;
    const kind = kindOf(file);
    if (kind === 'header') {
        bridges.add(createBridgeFile(file, release));
        createLib(debug, 'Bridge', { force: true, buildSource: false, nativeGlob: [commonBridges(), ...bridges] });
    } else if (kind === 'source') {
        createLib(debug, 'Source', { force: true, buildSource: true, bypassCmake: true });
    } else if (kind === 'rust') {
        // The surface is parsed again so the bridge crate and .d.ts follow a changed API; cargo sees the edit itself, and
        // buildWasm rebuilds the app's super-crate before it links.
        getRustJsScript(debug, file);
    } else {
        const headers = isAppSource(project, file) ? rebindHeaders(bridges, release) : null;
        return headers ? { headers } : null;
    }
    await buildWasm(debug, { force: true });
    return {};
}
