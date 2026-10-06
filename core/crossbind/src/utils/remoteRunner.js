import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCKER_BASE } from './replaceBasePathForDocker.js';

const CLIENT = fileURLToPath(new URL('./remoteClient.js', import.meta.url));

// Only native inputs travel to the runner; the application's JavaScript and credential files stay on the
// machine. A cargo target folder stays on the runner, and only the static libraries crossbind links come back from it.
export const REMOTE_EXCLUDE_RULES = Object.freeze({
    dirs: Object.freeze(['node_modules', '.git']),
    files: Object.freeze(['.env', '.env.*', '.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc']),
    extensions: Object.freeze(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx']),
    serverOnly: Object.freeze({ names: Object.freeze(['target', 'target-mt']), marker: 'Cargo.toml', keep: Object.freeze(['*/release/*.a']) }),
});

const URL_VARIABLE = 'CROSSBIND_REMOTE_URL';
const TOKEN_VARIABLE = 'CROSSBIND_TOKEN';

// The runner of a step's own image (CROSSBIND_REMOTE_URL_LINUX, ...) wins over the one every image shares.
export const remoteVariables = (role) => ({
    url: `${URL_VARIABLE}_${role.toUpperCase()}`,
    token: `${TOKEN_VARIABLE}_${role.toUpperCase()}`,
});

// A token goes only to the address it was set with: CROSSBIND_TOKEN_LINUX with CROSSBIND_REMOTE_URL_LINUX,
// CROSSBIND_TOKEN with CROSSBIND_REMOTE_URL.
function remoteRunner(role, env = process.env) {
    const own = remoteVariables(role);
    if (env[own.url]) return { url: env[own.url], token: env[own.token], tokenVariable: own.token };
    if (env[URL_VARIABLE]) return { url: env[URL_VARIABLE], token: env[TOKEN_VARIABLE], tokenVariable: TOKEN_VARIABLE };
    return null;
}

export function remoteRunnerUrl(role, env = process.env) {
    return remoteRunner(role, env)?.url ?? null;
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;
const warnedUrls = new Set();

// Plain http to another machine carries the token and the sources unencrypted.
function warnIfPlainHttp(url) {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' || LOOPBACK.test(hostname) || warnedUrls.has(url)) return;
    warnedUrls.add(url);
    console.warn(`crossbind: ${url} is plain http to another machine - the token and your sources travel unencrypted; put TLS in front of the runner.`);
}

const isInside = (rel, root) => root === '.' || rel === root || rel.startsWith(`${root}/`);

// Null for a folder outside the base: a local docker run mounts only the base, so it never sees one either.
function relativeToBase(base, folder) {
    const rel = path.relative(base, folder);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel.split(path.sep).join('/') || '.';
}

function foldNested(roots) {
    const unique = [...new Set(roots)].sort((a, b) => a.length - b.length);
    return unique.filter((root, i) => !unique.slice(0, i).some((outer) => isInside(root, outer)));
}

// A file the command line names may include its neighbours (`#include "../include/x.h"`), so unless a
// configured folder holds it, the package that holds it travels: the nearest folder below the base with a
// package.json. Its JavaScript stays behind, as everywhere else.
function packageOf(base, configured, file) {
    if (configured.some((root) => isInside(relativeToBase(base, file), root))) return file;
    for (let dir = path.dirname(file); dir.startsWith(`${base}${path.sep}`); dir = path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    }
    return file;
}

// What a toolchain step may read (inputRoots) and where it writes (outputRoots), relative to paths.base,
// the folder a local docker run mounts. `extraInputs` are only read (a file the link names);
// `extraOutputs` are read and written, like a crate's folder and its Cargo.lock.
export function remoteRoots(config, { extraInputs = [], extraOutputs = [] } = {}) {
    const { paths, allDependencies = [] } = config;
    const relOf = (folder) => relativeToBase(paths.base, folder);
    const isBelowBase = (folder) => Boolean(folder) && relOf(folder) !== null;
    const dependencyFolders = allDependencies.flatMap((d) => [d.paths.output, ...(d.paths.native ?? []), ...(d.paths.header ?? [])]);
    const configured = [...paths.native, ...paths.header, paths.cache, paths.output, `${paths.cli}/assets`, ...dependencyFolders].filter(isBelowBase).map(relOf);
    const outputs = [paths.cache, paths.output, ...extraOutputs].filter(isBelowBase).map(relOf);
    return {
        inputRoots: foldNested([...configured, ...extraInputs.filter(isBelowBase).map((file) => relOf(packageOf(paths.base, configured, file))), ...outputs]),
        outputRoots: foldNested(outputs),
    };
}

export function baseMount(config, extra = {}) {
    return { host: config.paths.base, container: DOCKER_BASE, ...remoteRoots(config, extra) };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Paths a command line names below the base (a source the link adds, an include folder, a preload file)
// travel even when no configured folder holds them. The base itself is never one: it would send everything.
export function referencedPaths(base, values) {
    const pattern = new RegExp(`${escapeRegExp(base)}(?:/[^@=;:,'"\\s]*)?`, 'g');
    const found = values.flatMap((value) => String(value).match(pattern) ?? []);
    return [...new Set(found)].filter((candidate) => candidate !== base && fs.existsSync(candidate));
}

// Arguments for execFileSync/spawnSync: the client runs as its own process, so the caller stays
// synchronous as it is with docker. The token reaches it through its environment, never its command line.
export function remoteExecParams({ role, image, mounts, cwd, argv, env }, options) {
    const { url, token, tokenVariable } = remoteRunner(role);
    if (!token) throw new Error(`crossbind: the ${role} runner at ${url} needs a token - set ${tokenVariable}.`);
    warnIfPlainHttp(url);
    const payload = { url, role, image, mounts, cwd, argv, env, rules: REMOTE_EXCLUDE_RULES };
    return [process.execPath, [CLIENT, JSON.stringify(payload)], { ...options, env: { ...process.env, [TOKEN_VARIABLE]: token } }];
}
