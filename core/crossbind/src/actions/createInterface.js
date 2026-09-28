
import fs from 'node:fs';
import { createRequire } from 'node:module';
import upath from 'upath';
import state, { saveCache } from '../state/index.js';
import { getContentHash, getFileHash } from '../utils/hash.js';
import guardAsyncBindings from '../utils/bridgeAsyncGuard.js';
import getDependFilePath from '../integration/getDependFilePath.js';
import { writeHeaderDts } from '../utils/cppDts.js';
import { ALL_NAMES, findHeaderImportsIn } from '../utils/headerImports.js';
import {
    buildInterfaceContent, completingIncludes, findHeaderPrelude, findIgnoredDeclarations, indexTypeDefinitions, interfaceIncludes,
    interfaceToRetryWithoutMacros, parseMacroDump, referencedTypeHeaders, selectSwigMacros,
} from '../utils/swigInterface.js';
import writeIfChanged from '../utils/writeIfChanged.js';
import run, { cxxPreprocessorFor } from './run.js';

// Part of every interface hash, so interfaces cached by an older generator are rebuilt.
const INTERFACE_FORMAT = 'swig-macros-1';
// Part of every bridge hash: each bridge carries the SWIG fork's runtime and all bridges of a module must share it, so
// bridges from a fork before field bindings and constants are rebuilt.
const BRIDGE_FORMAT = 'swig-constants-1';
const predefinedMacros = new Map();
const typeDefinitions = new Map();

export default function createBridgeFile(headerOrModuleFilePath, target = state.targets.find((t) => t.platform === 'wasm'), { withDependencies = true } = {}) {
    const interfaceFilePath = upath.resolve(headerOrModuleFilePath);
    if (!fs.existsSync(`${state.config.paths.build}/interface`)) {
        fs.mkdirSync(`${state.config.paths.build}/interface`, { recursive: true });
    }
    if (!fs.existsSync(`${state.config.paths.build}/bridge`)) {
        fs.mkdirSync(`${state.config.paths.build}/bridge`, { recursive: true });
    }
    // The header may live outside paths.native (e.g. a package-subpath import like
    // '@scope/pkg/native/x.h'), so its own directory must reach swig's include list.
    const sourceDir = upath.dirname(interfaceFilePath);
    const interfaceFile = createInterfaceFile(interfaceFilePath, target, sourceDir);
    const bridgeFile = createBridgeFileFromInterfaceFile(interfaceFile, target, sourceDir, getFileHash(interfaceFilePath));
    const moduleRegex = new RegExp(`.(${state.config.ext.module.join('|')})$`);
    if (bridgeFile) {
        // Records which header this bridge came from, so directory-driven consumers
        // (getAllBridges) can prune bridges whose header no longer exists.
        writeIfChanged(`${bridgeFile}.source`, `${interfaceFilePath}\n`);
        writeHeaderDts({
            headerFile: interfaceFilePath,
            exportsFile: `${bridgeFile}.exports.json`,
            projectPath: state.config.paths.project,
            cacheDir: state.config.paths.cache,
            dtsMode: state.config.dts,
        });
    }
    if (bridgeFile && withDependencies && !moduleRegex.test(interfaceFilePath)) {
        // A header's own bindings need the types its declarations use registered, which only their headers' bridges do.
        const dependencyBridges = dependencyHeadersOf(interfaceFilePath, target).map((header) => {
            try {
                return createBridgeFile(header, target, { withDependencies: false });
            } catch (e) {
                console.warn(`crossbind: ${upath.basename(interfaceFilePath)} uses types from ${upath.basename(header)}, whose bindings failed (${e.message})`);
                return null;
            }
        }).filter(Boolean);
        writeIfChanged(`${bridgeFile}.deps`, dependencyBridges.map((dependency) => `${dependency}\n`).join(''));
    }
    return bridgeFile;
}

function createInterfaceFile(headerOrModuleFilePath, target, sourceDir) {
    if (!headerOrModuleFilePath) {
        return null;
    }
    const moduleRegex = new RegExp(`.(${state.config.ext.module.join('|')})$`);
    const isModule = moduleRegex.test(headerOrModuleFilePath);
    const { includeRoot, headerPath } = isModule ? {} : includeLocation(headerOrModuleFilePath, target);
    const packages = [state.config, ...state.config.allDependencies];
    const prelude = isModule ? [] : findHeaderPrelude(headerOrModuleFilePath, packages, headerPath);
    const ignored = isModule ? [] : findIgnoredDeclarations(headerOrModuleFilePath, packages, headerPath);
    const completing = includeRoot ? findCompletingIncludes(headerOrModuleFilePath, includeRoot, headerPath) : [];
    const filePathWithoutExt = headerOrModuleFilePath.match(/^(.*)\..+?$/)?.[1];
    const interfaceFile = !isModule && filePathWithoutExt ? `${filePathWithoutExt}.i` : null;
    const constants = isModule ? [] : importedNames(headerOrModuleFilePath, target);
    // A prelude or ignored-declaration change in the owning package, a completed class moving to another header, an
    // interface the package ships beside the header changing or going away, or another imported name must regenerate
    // the interface as well.
    const fileHash = [
        INTERFACE_FORMAT, getFileHash(headerOrModuleFilePath), ...prelude,
        ...(ignored.length ? [`ignored:${ignored.join(',')}`] : []), ...(completing.length ? [`completing:${completing.join(',')}`] : []),
        ...(interfaceFile && fs.existsSync(interfaceFile) ? [`shipped:${getFileHash(interfaceFile)}`] : []),
        ...(constants.length ? [`constants:${constants === ALL_NAMES ? ALL_NAMES : constants.join(',')}`] : []),
    ].join('\n');
    const cachedInterface = state.cache.interfaces[headerOrModuleFilePath];
    if (state.cache.hashes[headerOrModuleFilePath] === fileHash && cachedInterface && fs.existsSync(cachedInterface)
        && !sharedInterface(headerOrModuleFilePath, cachedInterface)) {
        return cachedInterface;
    }

    if (isModule) {
        const newPath = `${state.config.paths.build}/interface/${headerOrModuleFilePath.split('/').pop()}`;
        fs.copyFileSync(headerOrModuleFilePath, newPath);
        state.cache.interfaces[headerOrModuleFilePath] = newPath;
        state.cache.hashes[headerOrModuleFilePath] = fileHash;
        saveCache();
        return newPath;
    }

    if (!filePathWithoutExt) return null;

    if (fs.existsSync(interfaceFile)) {
        const newPath = `${state.config.paths.build}/interface/${interfaceFile.split('/').at(-1)}`;
        fs.copyFileSync(interfaceFile, newPath);
        state.cache.interfaces[headerOrModuleFilePath] = newPath;
        state.cache.hashes[headerOrModuleFilePath] = fileHash;
        saveCache();
        return newPath;
    }

    const fileName = interfaceName(headerOrModuleFilePath, filePathWithoutExt.split('/').at(-1));

    const content = buildInterfaceContent({
        moduleName: fileName.toUpperCase(),
        headerPath,
        prelude,
        completing,
        swigMacros: collectSwigMacros(headerOrModuleFilePath, interfaceIncludes(headerPath, prelude), fileName, target, sourceDir, constants),
        ignored,
        constants,
    });
    const outputFilePath = `${state.config.paths.build}/interface/${fileName}.i`;
    fs.writeFileSync(outputFilePath, content);

    state.cache.interfaces[headerOrModuleFilePath] = outputFilePath;
    state.cache.hashes[headerOrModuleFilePath] = fileHash;
    saveCache();

    return outputFilePath;
}

const interfacePath = (name) => `${state.config.paths.build}/interface/${name}.i`;
// Each platform build of a package ships its headers under dist/prebuilt/<target>/include: one header for the interface.
const headerIdentity = (file) => file.match(/\/dist\/prebuilt\/[^/]+\/include\/(.+)$/)?.[1] ?? file;
const sharedInterface = (headerFile, interfaceFile) => Object.entries(state.cache.interfaces)
    .some(([other, file]) => headerIdentity(other) !== headerIdentity(headerFile) && file === interfaceFile);

// An interface is named after its header's file name. A second header with that name (tiffio.h and tiffio.hxx, or one
// name in two directories) takes its extension, then a hash of its path, so neither replaces the other's bridge.
function interfaceName(headerFile, base) {
    const candidates = [base, `${base}_${upath.extname(headerFile).slice(1)}`, `${base}_${getContentHash(headerFile).slice(0, 8)}`];
    return candidates.find((name) => !sharedInterface(headerFile, interfacePath(name))) ?? candidates.at(-1);
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A header is included by its path under a project header directory or a dependency's include directory; one found only
// through its own directory has no include root to search.
function includeLocation(headerFile, target) {
    const projectRoot = state.config.paths.header.find((path) => headerFile.startsWith(path));
    if (projectRoot) return { includeRoot: projectRoot, headerPath: headerFile.substr(projectRoot.length + 1) };
    const dependencyRoots = (state.config.dependencyParameters?.getCmakeDependsPathAndName(target).pathsOfCmakeDepends || [])
        .filter((d) => d.startsWith(state.config.paths.base));
    const match = dependencyRoots.map((p) => headerFile.match(new RegExp(`^(${escapeRegExp(p)}/.*?/include)/(.*?)$`, 'i'))).find(Boolean);
    return match ? { includeRoot: match[1], headerPath: match[2] } : { includeRoot: null, headerPath: headerFile.split('/').at(-1) };
}

// The headers under an include root are indexed once per build.
function definitionsUnder(includeRoot) {
    if (!typeDefinitions.has(includeRoot)) {
        const extensions = new RegExp(`\\.(${state.config.ext.header.join('|')})$`, 'i');
        const files = fs.readdirSync(includeRoot, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile() && extensions.test(entry.name))
            .map((entry) => upath.relative(includeRoot, upath.join(entry.parentPath, entry.name)))
            .sort()
            .map((path) => ({ path, text: fs.readFileSync(upath.join(includeRoot, path), 'utf8') }));
        typeDefinitions.set(includeRoot, indexTypeDefinitions(files));
    }
    return typeDefinitions.get(includeRoot);
}

function findCompletingIncludes(headerFile, includeRoot, headerPath) {
    const headerText = fs.readFileSync(headerFile, 'utf8');
    if (!headerText.includes('unique_ptr')) return [];
    return completingIncludes({ headerText, headerPath, definitions: definitionsUnder(includeRoot) });
}

function dependencyHeadersOf(headerFile, target) {
    const { includeRoot, headerPath } = includeLocation(headerFile, target);
    if (!includeRoot) return [];
    const headerText = fs.readFileSync(headerFile, 'utf8');
    return referencedTypeHeaders({ headerText, headerPath, definitions: definitionsUnder(includeRoot) })
        .map((header) => upath.join(includeRoot, header));
}

// The proxy module's own exports, never names of the header.
const PROXY_NAMES = new Set(['initNative', 'AllSymbols']);
const C_IDENTIFIER = /^[A-Za-z_]\w*$/;

// A package header resolves under the target's prebuilt directory, and the bundler may resolve it for another target.
const targetNeutral = (file) => file?.replace(/\/dist\/prebuilt\/[^/]+\/include\//, '/dist/prebuilt/*/include/');

function realPath(file) {
    if (!file) return null;
    try {
        return upath.normalize(fs.realpathSync(file));
    } catch (e) {
        return upath.resolve(file);
    }
}

// A package that is not a crossbind dependency (the conformance kit) resolves the way the bundler finds it.
function resolveHeaderImport(specifier, importer, target) {
    if (specifier.startsWith('.')) return upath.resolve(upath.dirname(importer), specifier);
    if (upath.isAbsolute(specifier)) return specifier;
    try {
        return getDependFilePath(specifier, target) ?? createRequire(importer).resolve(specifier);
    } catch (e) {
        return null;
    }
}

// The names the app's own sources import from this header, or every name for `import * as`.
function importedNames(headerFile, target) {
    const projectDir = state.config.paths.project;
    if (!projectDir || !fs.existsSync(projectDir)) return [];
    const header = targetNeutral(realPath(headerFile));
    const names = new Set();
    for (const { importer, specifier, names: imported } of findHeaderImportsIn(projectDir, state.config.ext.header)) {
        if (targetNeutral(realPath(resolveHeaderImport(specifier, importer, target))) !== header) continue;
        if (imported === ALL_NAMES) return ALL_NAMES;
        imported.filter((name) => C_IDENTIFIER.test(name) && !PROXY_NAMES.has(name)).forEach((name) => names.add(name));
    }
    return [...names].sort();
}

// A header that does not preprocess on its own, or a host without the image's compiler, keeps the plain interface.
function collectSwigMacros(headerFile, includes, name, target, sourceDir, constants) {
    const interfaceDir = `${state.config.paths.build}/interface`;
    try {
        if (!predefinedMacros.has(target.path)) {
            predefinedMacros.set(target.path, dumpMacros(`${interfaceDir}/predefined-${target.path}.macros.h`, [], [], target));
        }
        const macros = dumpMacros(`${interfaceDir}/${name}.macros.h`, includes, swigIncludePath(target, sourceDir), target, [RELEASE_DEFINE]);
        return selectSwigMacros({ headerText: fs.readFileSync(headerFile, 'utf8'), macros, predefined: predefinedMacros.get(target.path), constants });
    } catch (e) {
        console.warn(`crossbind: SWIG reads ${upath.basename(headerFile)} without the macros of its includes (${e.message})`);
        return [];
    }
}

// Bridges compile in release with NDEBUG defined, so SWIG reads headers the same way: a declaration that exists only
// without NDEBUG (sqlite3_mutex_held) would otherwise be bound and fail to compile. The predefined dump stays without
// it, so NDEBUG counts as a macro SWIG needs rather than a compiler predefine.
const RELEASE_DEFINE = '-DNDEBUG';

function dumpMacros(outputFile, includes, includePath, target, defines = []) {
    run(cxxPreprocessorFor(target), [
        '-x', 'c++', '-std=c++17', '-dM', '-E', ...defines,
        ...includePath,
        ...includes.flatMap((header) => ['-include', header]),
        '-o', outputFile,
        '/dev/null',
    ], null, target);
    return parseMacroDump(fs.readFileSync(outputFile, 'utf8'));
}

function swigIncludePath(target, sourceDir) {
    const allHeaders = state.config.dependencyParameters.headerPathWithDepends.split(';');
    const includePath = [
        ...state.config.allDependencies.map((d) => `${d.paths.output}/prebuilt/${target.path}/include`),
        ...state.config.allDependencies.map((d) => `${d.paths.output}/prebuilt/${target.path}/swig`),
        ...state.config.paths.header,
        ...allHeaders,
        ...(sourceDir ? [sourceDir] : []),
    ].filter((path) => !!path.toString()).map((path) => `-I${path}`);
    return [...new Set(includePath)];
}

// Idempotent: wraps every emscripten::async() registration in the generated
// bridge behind #ifdef CROSSBIND_JSPI (see utils/bridgeAsyncGuard.js). Applied on
// the cached path too, so bridges generated by older versions get guarded the
// next time they are picked up.
function applyAsyncGuard(bridgeFilePath) {
    const bridgeText = fs.readFileSync(bridgeFilePath, { encoding: 'utf8' });
    const guarded = guardAsyncBindings(bridgeText);
    if (guarded !== bridgeText) {
        fs.writeFileSync(bridgeFilePath, guarded);
    }
}

// A build hides SWIG's output, so the SWIG fork writes each binding it skipped beside the bridge, under the path SWIG saw.
function reportSkippedBindings(bridgeFilePath) {
    const warningsFile = `${bridgeFilePath}.warnings`;
    if (!fs.existsSync(warningsFile)) return;
    fs.readFileSync(warningsFile, 'utf8').split('\n').filter(Boolean).forEach((line) => {
        const [, file, lineNumber, message] = line.match(/^(.*):(\d+): (.*)$/) ?? [];
        console.warn(`crossbind: ${file ? `${upath.basename(file)}:${lineNumber}: ${message}` : line}`);
    });
}

// The interface text only names the header, so its hash alone kept a bridge across header edits: the
// header's own hash is part of the key.
function createBridgeFileFromInterfaceFile(interfaceFilePath, target, sourceDir = null, sourceHash = '') {
    if (!interfaceFilePath) {
        return null;
    }

    const bridgeHash = () => `${BRIDGE_FORMAT}\n${getFileHash(interfaceFilePath)}\n${sourceHash}`;
    const fileHash = bridgeHash();
    const cachedBridge = state.cache.bridges[interfaceFilePath];
    if (state.cache.hashes[interfaceFilePath] === fileHash && cachedBridge && fs.existsSync(cachedBridge)) {
        applyAsyncGuard(cachedBridge);
        return cachedBridge;
    }

    const bridgeFilePath = `${state.config.paths.build}/bridge/${interfaceFilePath.split('/').at(-1)}.cpp`;
    // #error lines guard branches SWIG evaluates without the compiler's predefined macros, so they only warn.
    const swig = () => run('swig', [
        '-c++',
        '-embind',
        '-cpperraswarn',
        '-o', bridgeFilePath,
        ...swigIncludePath(target, sourceDir),
        interfaceFilePath,
    ], null, target);
    try {
        swig();
    } catch (e) {
        // Known macros can expose declarations SWIG cannot parse and used to skip; without them it parses as before.
        const content = fs.readFileSync(interfaceFilePath, 'utf8');
        const plain = interfaceToRetryWithoutMacros(content, e);
        if (!plain) throw e;
        console.warn(`crossbind: SWIG cannot parse ${upath.basename(interfaceFilePath)} with the macros of its includes; generating it without them`);
        fs.writeFileSync(interfaceFilePath, plain);
        try {
            swig();
        } catch (retryError) {
            // The cached interface keeps its macros, so the next build tries them again.
            fs.writeFileSync(interfaceFilePath, content);
            throw retryError;
        }
    }
    applyAsyncGuard(bridgeFilePath);
    reportSkippedBindings(bridgeFilePath);

    state.cache.bridges[interfaceFilePath] = bridgeFilePath;
    state.cache.hashes[interfaceFilePath] = bridgeHash();
    saveCache();

    return state.cache.bridges[interfaceFilePath];
}
