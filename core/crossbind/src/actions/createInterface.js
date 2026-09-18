
import fs from 'node:fs';
import upath from 'upath';
import state, { saveCache } from '../state/index.js';
import { getFileHash } from '../utils/hash.js';
import guardAsyncBindings from '../utils/bridgeAsyncGuard.js';
import { writeHeaderDts, parseCppSurface } from '../utils/cppDts.js';
import { injectFieldBindings } from '../utils/cppFieldBindings.js';
import {
    buildInterfaceContent, completingIncludes, findHeaderPrelude, findIgnoredDeclarations, indexTypeDefinitions, interfaceIncludes,
    interfaceToRetryWithoutMacros, parseMacroDump, referencedTypeHeaders, selectSwigMacros,
} from '../utils/swigInterface.js';
import writeIfChanged from '../utils/writeIfChanged.js';
import run, { cxxPreprocessorFor } from './run.js';

// Part of every interface hash, so interfaces cached by an older generator are rebuilt.
const INTERFACE_FORMAT = 'swig-macros-1';
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
    if (bridgeFile && !moduleRegex.test(interfaceFilePath)) {
        // SWIG's -embind backend emits no member variables; inject .property lines for the
        // header's public value fields. Idempotent, so the cached-bridge path is safe too.
        const bridgeContent = fs.readFileSync(bridgeFile, 'utf8');
        const injected = injectFieldBindings(bridgeContent, parseCppSurface(fs.readFileSync(interfaceFilePath, 'utf8'), () => {}));
        if (injected !== bridgeContent) fs.writeFileSync(bridgeFile, injected);
    }
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
    // A prelude or ignored-declaration change in the owning package, or a completed class moving to another header, must
    // regenerate the interface as well.
    const fileHash = [
        INTERFACE_FORMAT, getFileHash(headerOrModuleFilePath), ...prelude,
        ...(ignored.length ? [`ignored:${ignored.join(',')}`] : []), ...(completing.length ? [`completing:${completing.join(',')}`] : []),
    ].join('\n');
    const cachedInterface = state.cache.interfaces[headerOrModuleFilePath];
    if (state.cache.hashes[headerOrModuleFilePath] === fileHash && cachedInterface && fs.existsSync(cachedInterface)) {
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

    const temp = headerOrModuleFilePath.match(/^(.*)\..+?$/);
    if (!temp || temp.length < 2) return null;

    const filePathWithoutExt = temp[1];
    const interfaceFile = `${filePathWithoutExt}.i`;

    if (fs.existsSync(interfaceFile)) {
        const newPath = `${state.config.paths.build}/interface/${interfaceFile.split('/').at(-1)}`;
        fs.copyFileSync(interfaceFile, newPath);
        state.cache.interfaces[headerOrModuleFilePath] = newPath;
        state.cache.hashes[headerOrModuleFilePath] = fileHash;
        saveCache();
        return newPath;
    }

    const fileName = filePathWithoutExt.split('/').at(-1);

    const content = buildInterfaceContent({
        moduleName: fileName.toUpperCase(),
        headerPath,
        prelude,
        completing,
        swigMacros: collectSwigMacros(headerOrModuleFilePath, interfaceIncludes(headerPath, prelude), fileName, target, sourceDir),
        ignored,
    });
    const outputFilePath = `${state.config.paths.build}/interface/${fileName}.i`;
    fs.writeFileSync(outputFilePath, content);

    state.cache.interfaces[headerOrModuleFilePath] = outputFilePath;
    state.cache.hashes[headerOrModuleFilePath] = fileHash;
    saveCache();

    return outputFilePath;
}

// A header is included by its path under a project header directory or a dependency's include directory; one found only
// through its own directory has no include root to search.
function includeLocation(headerFile, target) {
    const projectRoot = state.config.paths.header.find((path) => headerFile.startsWith(path));
    if (projectRoot) return { includeRoot: projectRoot, headerPath: headerFile.substr(projectRoot.length + 1) };
    const dependencyRoots = (state.config.dependencyParameters?.getCmakeDependsPathAndName(target).pathsOfCmakeDepends || [])
        .filter((d) => d.startsWith(state.config.paths.base));
    const match = dependencyRoots.map((p) => headerFile.match(new RegExp(`^(${p}/.*?/include)/(.*?)$`, 'i'))).find(Boolean);
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

// A header that does not preprocess on its own, or a host without the image's compiler, keeps the plain interface.
function collectSwigMacros(headerFile, includes, name, target, sourceDir) {
    const interfaceDir = `${state.config.paths.build}/interface`;
    try {
        if (!predefinedMacros.has(target.path)) {
            predefinedMacros.set(target.path, dumpMacros(`${interfaceDir}/predefined-${target.path}.macros.h`, [], [], target));
        }
        const macros = dumpMacros(`${interfaceDir}/${name}.macros.h`, includes, swigIncludePath(target, sourceDir), target);
        return selectSwigMacros({ headerText: fs.readFileSync(headerFile, 'utf8'), macros, predefined: predefinedMacros.get(target.path) });
    } catch (e) {
        console.warn(`crossbind: SWIG reads ${upath.basename(headerFile)} without the macros of its includes (${e.message})`);
        return [];
    }
}

function dumpMacros(outputFile, includes, includePath, target) {
    run(cxxPreprocessorFor(target), [
        '-x', 'c++', '-std=c++17', '-dM', '-E',
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

// The interface text only names the header, so its hash alone kept a bridge across header edits: the
// header's own hash is part of the key.
function createBridgeFileFromInterfaceFile(interfaceFilePath, target, sourceDir = null, sourceHash = '') {
    if (!interfaceFilePath) {
        return null;
    }

    const bridgeHash = () => `${getFileHash(interfaceFilePath)}\n${sourceHash}`;
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

    state.cache.bridges[interfaceFilePath] = bridgeFilePath;
    state.cache.hashes[interfaceFilePath] = bridgeHash();
    saveCache();

    return state.cache.bridges[interfaceFilePath];
}
