import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DARWIN_CC } from './darwinToolchain.js';

// On a Mac, every bridge step bound for the web image runs with @crossbind/bridge-tools, which crossbind has as an
// optional dependency there: its SWIG in this process, and Xcode's clang reading headers as the image's em++ does. The
// two make the same bridges, so a macOS or iOS build needs no Docker. An Android bridge is read with the NDK, in its
// image.
const PACKAGE = '@crossbind/bridge-tools';
// clang reads CPATH and CPLUS_INCLUDE_PATH despite -nostdinc, so it gets only these.
const CLANG_ENVIRONMENT = ['PATH', 'HOME', 'TMPDIR'];
// As much as run() takes from a command.
const OUTPUT_LIMIT = 512 * 1024 * 1024;
const require = createRequire(import.meta.url);

export const usesBridgeTools = (target, host = process.platform) => host === 'darwin' && target?.platform !== 'android';

export function missingToolsMessage(error, version = require('../../package.json').version) {
    if (error?.code === 'MODULE_NOT_FOUND') {
        return `crossbind: bridges on a Mac need ${PACKAGE}, which installs with crossbind there unless optional dependencies are left out: npm install --save-dev ${PACKAGE}@${version}`;
    }
    if (error?.code === 'ENOENT') {
        return `crossbind: ${PACKAGE} has not been built in this checkout: pnpm --filter ${PACKAGE} build (needs Docker)`;
    }
    return `crossbind: ${PACKAGE} does not load: ${error?.message}`;
}

let loaded;
export function loadBridgeTools() {
    if (!loaded) {
        try {
            loaded = require(PACKAGE);
        } catch (error) {
            throw new Error(missingToolsMessage(error), { cause: error });
        }
    }
    return loaded;
}

// As run() fails for a command that exits with an error: the output shown, the exit code in the cause.
export function runSwig(args, cwd, tools = loadBridgeTools()) {
    let result;
    try {
        result = tools.swig(args, { cwd });
    } catch (error) {
        if (error.output) console.error(error.output);
        throw error;
    }
    if (result.status === 0) return;
    if (result.output) console.error(result.output);
    throw new Error(`crossbind: command failed (swig) with exit code ${result.status}`, { cause: { status: result.status } });
}

export const clangEnvironment = (env = process.env) => Object.fromEntries(CLANG_ENVIRONMENT.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));

export function runPreprocessor(args, cwd, tools = loadBridgeTools(), exec = execFileSync) {
    try {
        exec(DARWIN_CC, [...tools.preprocessorArgs, ...args], {
            cwd, env: clangEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: OUTPUT_LIMIT,
        });
    } catch (error) {
        if (error?.stdout?.length) console.log(error.stdout.toString());
        if (error?.stderr?.length) console.error(error.stderr.toString());
        throw new Error(`crossbind: command failed (clang) with exit code ${error?.status ?? 'unknown'}`, { cause: error });
    }
}
