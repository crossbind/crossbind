import fs from 'node:fs';
import upath from 'upath';
import state from '../state/index.js';
import createBridgeFile from './createInterface.js';
import getDependFilePath from '../integration/getDependFilePath.js';
import resolveNativeImport from '../integration/resolveNativeImport.js';
import { getRustSymbols } from '../integration/getCrossbindScript.js';
import { findNativeImportsIn, nativeSpecifierTest } from '../utils/nativeImports.js';

const SCHEME = /^(cargo|conan):/;
const isBare = (specifier) => !specifier.startsWith('.') && !upath.isAbsolute(specifier);

function realPath(file) {
    try {
        return upath.normalize(fs.realpathSync(file));
    } catch (e) {
        return upath.resolve(file);
    }
}

// The first target whose packages ship the file. A cargo: or conan: import that none resolves fails the build with
// what to declare or install, as it does in a bundler.
function resolveImport(specifier, importer, targets) {
    let failure = null;
    for (const target of targets) {
        try {
            const file = SCHEME.test(specifier) ? getDependFilePath(specifier, target) : resolveNativeImport(specifier, importer, target);
            if (file && fs.existsSync(file)) return { target, file };
        } catch (error) {
            failure ??= error;
        }
    }
    if (failure) throw failure;
    return null;
}

// The native files the app's own sources import, by real path, each under the first target whose packages ship it
// and with the bare specifiers that name it, which Node cannot resolve on its own.
export function findAppNativeImports(targets) {
    const projectDir = state.config.paths.project;
    const imports = new Map();
    if (!projectDir || !fs.existsSync(projectDir)) return imports;
    for (const { importer, specifier } of findNativeImportsIn(projectDir, nativeSpecifierTest(state.config.ext))) {
        const resolved = resolveImport(specifier, importer, targets);
        if (!resolved) {
            console.warn(`crossbind: ${upath.relative(projectDir, importer)} imports ${specifier}, which no dependency ships for ${targets.map((t) => t.path).join(', ')}.`);
            continue;
        }
        const file = realPath(resolved.file);
        const found = imports.get(file) ?? { file, target: resolved.target, specifiers: [] };
        const specifiers = isBare(specifier) && !found.specifiers.includes(specifier) ? [...found.specifiers, specifier] : found.specifiers;
        imports.set(file, { ...found, specifiers });
    }
    return imports;
}

// The imported files no bridge of the build covers yet, bound the way a bundler plugin binds what it transforms. A Rust
// import has no bridge file: its crate links through buildAppRustCrates or its package, so it brings its names.
export function createImportedBridges(bound, imports) {
    const boundFiles = new Set(bound.map(({ file }) => realPath(file)));
    return [...imports.values()].filter(({ file }) => !boundFiles.has(file)).map(({ file, target }) => (file.endsWith('.rs')
        ? { file, names: getRustSymbols(file) }
        : { file, bridge: createBridgeFile(file, target) }));
}
