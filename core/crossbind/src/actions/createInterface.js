
import fs from 'node:fs';
import upath from 'upath';
import state, { saveCache } from '../state/index.js';
import refreshConanDependencies from '../state/refreshConanDependencies.js';
import refreshBuiltDependencies from '../state/refreshBuiltDependencies.js';
import { conanInputsOf } from '../utils/conanDependencies.js';
import { getContentHash, getFileHash } from '../utils/hash.js';
import guardAsyncBindings from '../utils/bridgeAsyncGuard.js';
import fixBridgeRuntime from '../utils/bridgeRuntimeFixes.js';
import {
    interfaceExtras, bridgeExtras, hasPointerRuntime, withPointerRuntimeAnchor, withoutBridgeExtras, POINTER_RUNTIME_ANCHOR,
} from '../utils/bridgeExtras.js';
import resolveNativeImport from '../integration/resolveNativeImport.js';
import { writeHeaderDts, writeConanImportDts } from '../utils/cppDts.js';
import { ALL_NAMES, findHeaderImportsIn } from '../utils/headerImports.js';
import {
    buildInterfaceContent, completingIncludes, findHeaderPrelude, findIgnoredDeclarations, findSwigInlineIncludes, findSwigPreamble,
    indexTypeDefinitions, inlineIncludes, interfaceIncludes, interfaceToRetryWithoutMacros, interfaceWithAllFunctions, parseMacroDump, referencedTypeHeaders,
    selectSwigMacros,
} from '../utils/swigInterface.js';
import writeIfChanged from '../utils/writeIfChanged.js';
import { withDirLockSync } from '../utils/dirLock.js';
import { imageRoleFor } from '../utils/pullDockerImage.js';
import { conanImportOfHeader } from '../utils/conanImport.js';
import run, { cxxPreprocessorFor } from './run.js';
import isSourceCmakePackage from '../utils/isSourceCmakePackage.js';

// Part of every interface hash, so interfaces cached by an older generator are rebuilt.
const INTERFACE_FORMAT = 'swig-macros-3';
// Part of every bridge hash: each bridge carries the SWIG fork's runtime and all bridges of a module must share it, so
// bridges from a fork before field bindings and constants are rebuilt.
const BRIDGE_FORMAT = 'swig-extras-1';
const predefinedMacros = new Map();
const typeDefinitions = new Map();

// Each process keeps the cache it loaded, so an interface or bridge another one has rebuilt since must not pass for
// this one's: beside each file is the hash of what it was made from, blank while the file is written. A file without one
// comes from an older crossbind or a cache CI restores, and its cache record holds.
const keyOf = (file) => `${file}.key`;
const isMadeFrom = (file, hash) => !fs.existsSync(keyOf(file)) || fs.readFileSync(keyOf(file), 'utf8') === getContentHash(hash);

// Metro binds headers in worker processes, so two of them can generate one bridge at once. The headers a header's types
// come from are bound in its turn.
export default function createBridgeFile(headerOrModuleFilePath, target = state.targets.find((t) => t.platform === 'wasm'), options = {}) {
    if (options.withDependencies === false) return bindHeader(headerOrModuleFilePath, target, options);
    return withDirLockSync(`${state.config.paths.build}/bridge.lock`, () => bindHeader(headerOrModuleFilePath, target, options), {
        pollMs: 50,
        heldBy: 'another process is binding a header',
    });
}

function bindHeader(headerOrModuleFilePath, target, { withDependencies = true, wholeHeaders = [] } = {}) {
    // A header can include a Conan package's headers that a build staged after this process loaded, or belong to a
    // dependency built since.
    refreshConanDependencies(state.config);
    refreshBuiltDependencies(state.config);
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
    const allNames = wholeHeaders.some((file) => upath.resolve(file) === interfaceFilePath);
    const names = bindingNames(interfaceFilePath, target, allNames);
    if (withDependencies) warnUnimported(interfaceFilePath, names.functions);
    const interfaceFile = createInterfaceFile(interfaceFilePath, target, sourceDir, names);
    const { headerPath } = includeLocation(interfaceFilePath, target);
    const inlined = findSwigInlineIncludes(interfaceFilePath, [state.config, ...state.config.allDependencies], headerPath);
    const swigView = inlined.length ? writeSwigView(interfaceFilePath, headerPath, inlined) : null;
    const sourceHash = [getFileHash(interfaceFilePath), ...conanInputsHash()].join('\n');
    // The names imported by name decide what the bridge adds to SWIG's output, so another one makes another bridge.
    const bridgeSourceHash = names.named.length ? `${sourceHash}\nnamed:${names.named.join(',')}` : sourceHash;
    const extras = { named: names.named, headerText: () => fs.readFileSync(swigView ? upath.join(swigView.dir, headerPath) : interfaceFilePath, 'utf8') };
    const bridgeFile = createBridgeFileFromInterfaceFile(interfaceFile, target, sourceDir, bridgeSourceHash, swigView, extras);
    const moduleRegex = new RegExp(`.(${state.config.ext.module.join('|')})$`);
    if (bridgeFile) {
        // Records which header this bridge came from, so directory-driven consumers
        // (getAllBridges) can prune bridges whose header no longer exists.
        writeIfChanged(`${bridgeFile}.source`, `${interfaceFilePath}\n`);
        const dtsOptions = {
            headerFile: interfaceFilePath,
            exportsFile: `${bridgeFile}.exports.json`,
            projectPath: state.config.paths.project,
            cacheDir: state.config.paths.cache,
            dtsMode: state.config.dts,
        };
        writeHeaderDts(dtsOptions);
        if (conanImportOfHeader(interfaceFilePath, state.config.paths.cache)) {
            dtsOptions.declarationsFile = createConanDeclarations(interfaceFile, target, sourceDir, sourceHash, swigView);
        }
        writeConanImportDts(dtsOptions);
    }
    if (bridgeFile && withDependencies && !moduleRegex.test(interfaceFilePath)) {
        // A header's own bindings need the types its declarations use registered, which only their headers' bridges do.
        // Such a bridge replaces the header's own, so a header bound whole keeps every constant here too.
        const dependencyBridges = dependencyHeadersOf(interfaceFilePath, target).map((header) => {
            try {
                return createBridgeFile(header, target, { withDependencies: false, wholeHeaders });
            } catch (e) {
                console.warn(`crossbind: ${upath.basename(interfaceFilePath)} uses types from ${upath.basename(header)}, whose bindings failed (${e.message})`);
                return null;
            }
        }).filter(Boolean);
        writeIfChanged(`${bridgeFile}.deps`, dependencyBridges.map((dependency) => `${dependency}\n`).join(''));
    }
    return bridgeFile;
}

// The Conan packages a header's includes may reach, for the interface and bridge caches: they are
// staged after a header may already be bound, and restaged in place for another version.
function conanInputsHash() {
    const conan = conanInputsOf(state.config);
    return conan ? [`conan:${getContentHash(JSON.stringify(conan))}`] : [];
}

// A header binds the constants the app imports from it, and so the free functions of a dependency's header: the project's
// own headers and .i modules bind every function.
function bindingNames(headerOrModuleFilePath, target, allNames) {
    if (new RegExp(`.(${state.config.ext.module.join('|')})$`).test(headerOrModuleFilePath)) return { constants: [], functions: ALL_NAMES, named: [] };
    const { names, takesModule, named } = headerUse(headerOrModuleFilePath, target);
    if (allNames) return { constants: ALL_NAMES, functions: ALL_NAMES, named };
    // A package's own .i says what the header binds.
    const shipsInterface = fs.existsSync(headerOrModuleFilePath.replace(/\.[^./]+$/, '.i'));
    const bindsEveryFunction = takesModule || shipsInterface || !includeLocation(headerOrModuleFilePath, target).isDependency;
    return { constants: names, functions: bindsEveryFunction ? ALL_NAMES : names, named };
}

const warnedUnimported = new Set();

// A bundler transforms the header because something imports it, but no source the scan reads names it: a package in
// node_modules, say.
function warnUnimported(header, functions) {
    if (functions === ALL_NAMES || functions.length || warnedUnimported.has(header)) return;
    warnedUnimported.add(header);
    console.warn(`crossbind: ${upath.basename(header)} binds none of its functions, since no source of the app imports a name from it. Import the functions you call by name, or the whole header with import * as.`);
}

function createInterfaceFile(headerOrModuleFilePath, target, sourceDir, { constants, functions, named = [] }) {
    if (!headerOrModuleFilePath) {
        return null;
    }
    const moduleRegex = new RegExp(`.(${state.config.ext.module.join('|')})$`);
    const isModule = moduleRegex.test(headerOrModuleFilePath);
    const { includeRoot, headerPath } = isModule ? {} : includeLocation(headerOrModuleFilePath, target);
    const packages = [state.config, ...state.config.allDependencies];
    const prelude = isModule ? [] : findHeaderPrelude(headerOrModuleFilePath, packages, headerPath);
    const ignored = isModule ? [] : findIgnoredDeclarations(headerOrModuleFilePath, packages, headerPath);
    const preamble = isModule ? [] : findSwigPreamble(headerOrModuleFilePath, packages, headerPath);
    const completing = includeRoot ? findCompletingIncludes(headerOrModuleFilePath, includeRoot, headerPath) : [];
    const filePathWithoutExt = headerOrModuleFilePath.match(/^(.*)\..+?$/)?.[1];
    const interfaceFile = !isModule && filePathWithoutExt ? `${filePathWithoutExt}.i` : null;
    // A prelude or ignored-declaration change in the owning package, a completed class moving to another header, an
    // interface the package ships beside the header changing or going away, another imported name, or Conan packages
    // its includes may reach being staged or moving to another version must regenerate the interface as well.
    const fileHash = [
        INTERFACE_FORMAT, getFileHash(headerOrModuleFilePath), ...prelude,
        ...(ignored.length ? [`ignored:${ignored.join(',')}`] : []), ...(completing.length ? [`completing:${completing.join(',')}`] : []),
        ...(preamble.length ? [`preamble:${preamble.join('\n')}`] : []),
        ...(interfaceFile && fs.existsSync(interfaceFile) ? [`shipped:${getFileHash(interfaceFile)}`] : []),
        ...(constants.length ? [`constants:${constants === ALL_NAMES ? ALL_NAMES : constants.join(',')}`] : []),
        ...(functions === ALL_NAMES ? [] : [`functions:${functions.join(',')}`]),
        ...(named.length ? [`named:${named.join(',')}`] : []),
        ...conanInputsHash(),
    ].join('\n');
    const cachedInterface = state.cache.interfaces[headerOrModuleFilePath];
    if (state.cache.hashes[headerOrModuleFilePath] === fileHash && cachedInterface && fs.existsSync(cachedInterface)
        && isMadeFrom(cachedInterface, fileHash) && !sharedInterface(headerOrModuleFilePath, cachedInterface)) {
        return cachedInterface;
    }

    if (isModule) {
        const newPath = `${state.config.paths.build}/interface/${headerOrModuleFilePath.split('/').pop()}`;
        return recordInterface(headerOrModuleFilePath, newPath, fileHash, () => fs.copyFileSync(headerOrModuleFilePath, newPath));
    }

    if (!filePathWithoutExt) return null;

    if (fs.existsSync(interfaceFile)) {
        const newPath = `${state.config.paths.build}/interface/${interfaceFile.split('/').at(-1)}`;
        return recordInterface(headerOrModuleFilePath, newPath, fileHash, () => fs.copyFileSync(interfaceFile, newPath));
    }

    const fileName = interfaceName(headerOrModuleFilePath, filePathWithoutExt.split('/').at(-1));

    const macros = collectSwigMacros(headerOrModuleFilePath, interfaceIncludes(headerPath, prelude), fileName, target, sourceDir, constants);
    const extras = interfaceExtras(named, macros.table);
    const content = buildInterfaceContent({
        moduleName: fileName.toUpperCase(),
        headerPath,
        prelude,
        completing,
        swigMacros: macros.lines,
        ignored,
        constants,
        preamble,
        functions: functions === ALL_NAMES ? ALL_NAMES : [...functions, ...extras.functions],
        extras: extras.lines,
    });
    const outputFilePath = `${state.config.paths.build}/interface/${fileName}.i`;
    return recordInterface(headerOrModuleFilePath, outputFilePath, fileHash, () => fs.writeFileSync(outputFilePath, content));
}

// The key is blank while the file is written, so a process that dies in between leaves no file passing for another hash.
function recordInterface(headerFile, interfaceFile, fileHash, write) {
    fs.writeFileSync(keyOf(interfaceFile), '');
    write();
    fs.writeFileSync(keyOf(interfaceFile), getContentHash(fileHash));
    state.cache.interfaces[headerFile] = interfaceFile;
    state.cache.hashes[headerFile] = fileHash;
    saveCache();
    return interfaceFile;
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
    return match ? { includeRoot: match[1], headerPath: match[2], isDependency: true } : { includeRoot: null, headerPath: headerFile.split('/').at(-1) };
}

// The headers under an include root are indexed once per build. A copy of a header is that header, and the copy nearest
// the root stands for it (libpng installs its headers in include/ and include/libpng16/).
function definitionsUnder(includeRoot) {
    if (!typeDefinitions.has(includeRoot)) {
        const extensions = new RegExp(`\\.(${state.config.ext.header.join('|')})$`, 'i');
        const files = fs.readdirSync(includeRoot, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile() && extensions.test(entry.name))
            .map((entry) => upath.relative(includeRoot, upath.join(entry.parentPath, entry.name)))
            .sort()
            .map((path) => ({ path, text: fs.readFileSync(upath.join(includeRoot, path), 'utf8') }));
        const depth = (path) => path.split('/').length;
        const nearest = new Map();
        files.forEach(({ path, text }) => {
            if (!nearest.has(text) || depth(path) < depth(nearest.get(text))) nearest.set(text, path);
        });
        typeDefinitions.set(includeRoot, {
            definitions: indexTypeDefinitions(files.filter(({ path, text }) => nearest.get(text) === path)),
            copyOf: new Map(files.map(({ path, text }) => [path, nearest.get(text)])),
        });
    }
    return typeDefinitions.get(includeRoot);
}

function lookupContext(includeRoot, headerPath, headerText) {
    const { definitions, copyOf } = definitionsUnder(includeRoot);
    return { headerText, headerPath: copyOf.get(headerPath) ?? headerPath, definitions };
}

function findCompletingIncludes(headerFile, includeRoot, headerPath) {
    const headerText = fs.readFileSync(headerFile, 'utf8');
    if (!headerText.includes('unique_ptr')) return [];
    return completingIncludes(lookupContext(includeRoot, headerPath, headerText));
}

function dependencyHeadersOf(headerFile, target) {
    const { includeRoot, headerPath } = includeLocation(headerFile, target);
    if (!includeRoot) return [];
    const headerText = fs.readFileSync(headerFile, 'utf8');
    return referencedTypeHeaders(lookupContext(includeRoot, headerPath, headerText))
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

// The names the app's own sources import from this header, or every name for `import * as` and the other whole-module
// imports. The app also takes the module, and reaches its functions by name, when it imports AllSymbols or when its only
// imports of the header take initNative alone.
// `named` keeps the names imported by name even when another import takes the whole module: macros, variadic functions
// and mutable globals bind only for those.
function headerUse(headerFile, target) {
    const projectDir = state.config.paths.project;
    if (!projectDir || !fs.existsSync(projectDir)) return { names: [], takesModule: false, named: [] };
    const header = targetNeutral(realPath(headerFile));
    const names = new Set();
    let isImported = false;
    let takesAllSymbols = false;
    let takesWhole = false;
    for (const { importer, specifier, names: imported } of findHeaderImportsIn(projectDir, state.config.ext.header)) {
        if (targetNeutral(realPath(resolveNativeImport(specifier, importer, target))) !== header) continue;
        if (imported === ALL_NAMES) {
            takesWhole = true;
            continue;
        }
        isImported = true;
        const listed = imported.filter((name) => C_IDENTIFIER.test(name));
        takesAllSymbols ||= listed.includes('AllSymbols');
        listed.filter((name) => !PROXY_NAMES.has(name)).forEach((name) => names.add(name));
    }
    const named = [...names].sort();
    if (takesWhole) return { names: ALL_NAMES, takesModule: true, named };
    return { names: named, takesModule: takesAllSymbols || (isImported && names.size === 0), named };
}

// A header that does not preprocess on its own, or a host without the image's compiler, keeps the plain interface.
function collectSwigMacros(headerFile, includes, name, target, sourceDir, constants) {
    const interfaceDir = `${state.config.paths.build}/interface`;
    try {
        if (!predefinedMacros.has(target.path)) {
            predefinedMacros.set(target.path, dumpMacros(`${interfaceDir}/predefined-${target.path}.macros.h`, [], [], target));
        }
        const macros = dumpMacros(`${interfaceDir}/${name}.macros.h`, includes, swigIncludePath(target, sourceDir), target, [RELEASE_DEFINE]);
        return {
            lines: selectSwigMacros({ headerText: fs.readFileSync(headerFile, 'utf8'), macros, predefined: predefinedMacros.get(target.path), constants }),
            table: macros,
        };
    } catch (e) {
        console.warn(`crossbind: SWIG reads ${upath.basename(headerFile)} without the macros of its includes (${e.message})`);
        return { lines: [], table: new Map() };
    }
}

// Bridges compile in release with NDEBUG defined, so SWIG reads headers the same way: a declaration that exists only
// without NDEBUG (sqlite3_mutex_held) would otherwise be bound and fail to compile. The predefined dump stays without
// it, so NDEBUG counts as a macro SWIG needs rather than a compiler predefine.
const RELEASE_DEFINE = '-DNDEBUG';

// One bridge serves every desktop target, so SWIG and the macro table it reads come from the web image's em++,
// which defines no operating system; an android bridge is read with the NDK it compiles with. The headers
// still come from the target's own packages.
const toolTargetFor = (target) => (imageRoleFor(target) === 'android' ? target : { ...target, platform: 'wasm' });

function dumpMacros(outputFile, includes, includePath, target, defines = []) {
    const tool = toolTargetFor(target);
    run(cxxPreprocessorFor(tool), [
        '-x', 'c++', '-std=c++17', '-dM', '-E', ...defines,
        ...includePath,
        ...includes.flatMap((header) => ['-include', header]),
        '-o', outputFile,
        '/dev/null',
    ], null, tool);
    return parseMacroDump(fs.readFileSync(outputFile, 'utf8'));
}

function swigIncludePath(target, sourceDir) {
    const allHeaders = state.config.dependencyParameters.headerPathWithDepends.split(';');
    const includePath = [
        ...state.config.allDependencies.map((d) => `${d.paths.output}/prebuilt/${target.path}/include`),
        ...state.config.allDependencies.map((d) => `${d.paths.output}/prebuilt/${target.path}/swig`),
        ...state.config.paths.header,
        ...allHeaders,
        // A package that ships its sources has no prebuilt include directory: the app reaches its headers through
        // the package's own CMakeLists.
        ...state.config.allDependencies.filter(isSourceCmakePackage).flatMap((d) => d.paths.header),
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
    const guarded = guardAsyncBindings(fixBridgeRuntime(bridgeText));
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

// SWIG skips function-like macros, variadic functions and mutable globals: the ones the app imports bind here, after its
// output. Their C++ uses SWIG's pointer runtime, which SWIG writes only for a pointer binding, so a bridge without one
// is generated again with a binding that has one.
function addBridgeExtras(bridgeFilePath, interfaceFilePath, named, headerText, swig) {
    const warningsFile = `${bridgeFilePath}.warnings`;
    const readWarnings = () => (fs.existsSync(warningsFile) ? fs.readFileSync(warningsFile, 'utf8').split('\n').filter(Boolean) : []);
    const interfaceText = fs.readFileSync(interfaceFilePath, 'utf8');
    const module = interfaceText.match(/^%module (\w+)$/m)?.[1];
    let extras = bridgeExtras({ interfaceText, named, bridgeText: fs.readFileSync(bridgeFilePath, 'utf8'), warnings: readWarnings(), headerText, module });
    if (!extras.code && !extras.notes.length) return;
    if (extras.code && !hasPointerRuntime(fs.readFileSync(bridgeFilePath, 'utf8'))) {
        const anchored = withPointerRuntimeAnchor(interfaceText);
        if (anchored !== interfaceText) {
            fs.writeFileSync(interfaceFilePath, anchored);
            swig();
            applyAsyncGuard(bridgeFilePath);
        }
        if (!hasPointerRuntime(fs.readFileSync(bridgeFilePath, 'utf8'))) {
            extras = {
                code: '', exports: [], answered: new Set(),
                notes: [...extras.notes, `${extras.exports.join(', ')}: these need the pointer runtime, which SWIG left out of this bridge; skipped.`],
            };
        }
    }
    if (extras.code) fs.appendFileSync(bridgeFilePath, `\n${extras.code}`);
    const exportsFile = `${bridgeFilePath}.exports.json`;
    const exported = JSON.parse(fs.readFileSync(exportsFile, 'utf8')).filter((name) => name !== POINTER_RUNTIME_ANCHOR);
    fs.writeFileSync(exportsFile, `${JSON.stringify([...new Set([...exported, ...extras.exports])])}\n`);
    fs.writeFileSync(warningsFile, [...readWarnings().filter((line) => !extras.answered.has(line)), ...extras.notes].map((line) => `${line}\n`).join(''));
}

// SWIG looks in its working directory and the interface's before its include path, and neither holds the header, so
// it reads this copy, put first on that path: the includes its package lists are inlined there, while the compiler
// still includes the real header.
function writeSwigView(headerFile, headerPath, names) {
    const dir = `${state.config.paths.build}/swigview`;
    const viewFile = upath.join(dir, headerPath);
    fs.mkdirSync(upath.dirname(viewFile), { recursive: true });
    const readInclude = (name) => fs.readFileSync(upath.join(upath.dirname(headerFile), name), 'utf8');
    writeIfChanged(viewFile, inlineIncludes(fs.readFileSync(headerFile, 'utf8'), names, readInclude));
    return { dir, hash: getFileHash(viewFile) };
}

// The interface text only names the header, so its hash alone kept a bridge across header edits: the
// header's own hash, and the inlined copy's when SWIG reads one, are part of the key.
function createBridgeFileFromInterfaceFile(interfaceFilePath, target, sourceDir = null, sourceHash = '', swigView = null, extras = { named: [], headerText: () => '' }) {
    if (!interfaceFilePath) {
        return null;
    }

    const bridgeHash = () => [
        BRIDGE_FORMAT, getFileHash(interfaceFilePath), sourceHash, ...(swigView ? [`view:${swigView.hash}`] : []),
    ].join('\n');
    const fileHash = bridgeHash();
    const cachedBridge = state.cache.bridges[interfaceFilePath];
    if (state.cache.hashes[interfaceFilePath] === fileHash && cachedBridge && fs.existsSync(cachedBridge) && isMadeFrom(cachedBridge, fileHash)) {
        applyAsyncGuard(cachedBridge);
        return cachedBridge;
    }

    const bridgeFilePath = `${state.config.paths.build}/bridge/${interfaceFilePath.split('/').at(-1)}.cpp`;
    fs.writeFileSync(keyOf(bridgeFilePath), '');
    // #error lines guard branches SWIG evaluates without the compiler's predefined macros, so they only warn.
    const swig = () => run('swig', [
        '-c++',
        '-embind',
        '-cpperraswarn',
        '-o', bridgeFilePath,
        ...(swigView ? [`-I${swigView.dir}`] : []),
        ...swigIncludePath(target, sourceDir),
        interfaceFilePath,
    ], null, toolTargetFor(target));
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
    if (extras.named.length) addBridgeExtras(bridgeFilePath, interfaceFilePath, extras.named, extras.headerText(), swig);
    reportSkippedBindings(bridgeFilePath);

    const madeFrom = bridgeHash();
    fs.writeFileSync(keyOf(bridgeFilePath), getContentHash(madeFrom));
    state.cache.bridges[interfaceFilePath] = bridgeFilePath;
    state.cache.hashes[interfaceFilePath] = madeFrom;
    saveCache();

    return state.cache.bridges[interfaceFilePath];
}

// Generate a full export catalog for the editor, without compiling or linking these extra functions.
function createConanDeclarations(interfaceFile, target, sourceDir, sourceHash, swigView) {
    const dir = `${state.config.paths.build}/declarations`;
    fs.mkdirSync(dir, { recursive: true });
    const file = `${dir}/${upath.basename(interfaceFile)}`;
    writeIfChanged(file, interfaceWithAllFunctions(withoutBridgeExtras(fs.readFileSync(interfaceFile, 'utf8'))));
    const bridge = `${file}.cpp`;
    const hash = getContentHash([BRIDGE_FORMAT, getFileHash(file), sourceHash, swigView?.hash ?? ''].join('\n'));
    if (!fs.existsSync(`${bridge}.exports.json`) || !fs.existsSync(keyOf(bridge)) || fs.readFileSync(keyOf(bridge), 'utf8') !== hash) {
        fs.writeFileSync(keyOf(bridge), '');
        run('swig', ['-c++', '-embind', '-cpperraswarn', '-o', bridge,
            ...(swigView ? [`-I${swigView.dir}`] : []), ...swigIncludePath(target, sourceDir), file], null, toolTargetFor(target));
        fs.writeFileSync(keyOf(bridge), hash);
    }
    return `${bridge}.exports.json`;
}
