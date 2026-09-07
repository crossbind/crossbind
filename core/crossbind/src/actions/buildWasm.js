import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import replace from 'replace';
import run from './run.js';
import getDependLibs from './getDependLibs.js';
import getData from './getData.js';
import buildJs from './buildJs.js';
import triggerExtensions from './extensions.js';
import state from '../state/index.js';
import resolveEmbindRustRoot from '../utils/resolveEmbindRust.js';
import logger from '../utils/logger.js';
import { getContentHash, getFilesFingerprint } from '../utils/hash.js';
import { buildLinkLibArgs } from '../utils/linkLayout.js';
import buildAppRustCrates from '../utils/appRustCrates.js';

export default async function buildWasm(target, options = {}) {
    const isProd = target.buildType === 'release';
    const buildType = isProd ? 'Release' : 'Debug';

    // Caller can opt out of the final emcc link entirely (e.g. when the
    // package is consumed only as a static library by downstream builds).
    if (state.config.export.bundle === false) {
        logger.info(`[${target.path}] wasm+js skipped (export.bundle = false)`);
        return false;
    }
    // Cargo packages only stage their staticlib; the consuming app links and bundles it.
    if (state.config.export.type === 'cargo') {
        logger.info(`[${target.path}] wasm+js skipped (cargo package - staticlib only)`);
        return false;
    }

    // buildLib's cache is keyed on paths.output/prebuilt; after a cache clean the
    // build-dir copy can be gone while the output artifact is still valid — link it then.
    const sourceLibCandidates = [
        `${state.config.paths.build}/Source-${buildType}/${target.path}/lib${state.config.general.name}.a`,
        `${state.config.paths.output}/prebuilt/${target.path}/lib/lib${state.config.general.name}.a`,
    ];
    // App-local Rust surfaces (imported .rs files) arrive as ONE super staticlib; it is the
    // single fully-loaded Rust archive of the link (see the libstd rule below).
    const appRustLibs = buildAppRustCrates(target, state.config.paths.cache, state.config.cargoDependencies ?? {});
    const libs = [
        ...getDependLibs(target),
        ...appRustLibs,
        sourceLibCandidates.find((lib) => fs.existsSync(lib)) ?? sourceLibCandidates[0],
        `${state.config.paths.build}/Bridge-${buildType}/${target.path}/lib${state.config.general.name}.a`,
    ];

    // By default only the Bridge archive is --whole-archive'd (see
    // linkLayout.js) so wasm-ld dead-code-eliminates everything unreferenced.
    // Two escape hatches, both `export.wholeArchive: true`: on the APP it
    // restores the legacy layout (every archive wholesale); on a LIBRARY's
    // own config it keeps that library's archives whole in every consumer
    // link (for members that self-register from static initializers).
    const wholeArchiveAll = state.config.export.wholeArchive === true;
    const wholeArchiveNames = new Set();
    // Rust libstd rule: every Rust staticlib bundles its own libstd, so at most ONE Rust archive
    // may be fully loaded (the app super staticlib). Generated cargo bridges are linked lazily
    // with their keep symbol pinned (-u pulls just the registration object); manual-bindings
    // crates have no keep symbol and fall back to whole-archive - safe only while they are the
    // single loaded Rust archive.
    const rustKeepFlags = [];
    if (appRustLibs.length > 0) wholeArchiveNames.add('crossbind_app_super');
    state.config.dependencyParameters.getCmakeDepends(target).forEach((dep) => {
        if (dep.export.wholeArchive === true) {
            (dep.export.libName || []).forEach((name) => wholeArchiveNames.add(name));
        }
        if (dep.export.type === 'cargo') {
            const crateLibRs = `${dep.paths.project}/${dep.export.crate ?? 'crate'}/src/lib.rs`.replace('/./', '/');
            const isManual = fs.existsSync(crateLibRs) && fs.readFileSync(crateLibRs, 'utf8').includes('bindings!');
            (dep.export.libName || []).forEach((name) => {
                // wasm-ld's -u does NOT pull archive members (it just leaves an import);
                // --export forces the symbol to resolve, dragging the registration object in.
                if (isManual) wholeArchiveNames.add(name);
                else rustKeepFlags.push(`-Wl,--export=crossbind_keep_${name}`);
            });
        }
    });
    // The whole-archived app super-staticlib and a lazily-pulled package bridge object each
    // carry rustc's allocator/panic shims (codegen-units=1 places them in the same object as
    // the pulled registrations). They are bit-identical toolchain synthetics; Mach-O dedups
    // them as weak defs, wasm-ld sees strong duplicates - allow them for this combination only.
    if (appRustLibs.length > 0 && rustKeepFlags.length > 0) {
        rustKeepFlags.push('-Wl,--allow-multiple-definition');
    }
    const linkLibs = buildLinkLibArgs(libs, { wholeArchiveAll, wholeArchiveNames });

    // Any Rust archive in the link needs the web adapter TU: it provides the flat
    // crossbind_embind_* C-ABI (typeid getters + passthroughs to emscripten's embind).
    const hasRust = rustKeepFlags.length > 0 || appRustLibs.length > 0
        || state.config.dependencyParameters.getCmakeDepends(target).some((dep) => dep.export.type === 'cargo');
    // The adapter ships in @crossbind/core-embind-rust (declared by the consumer, resolved here).
    const rustSources = hasRust ? [`${resolveEmbindRustRoot()}/adapters/web.cpp`] : [];

    const binary = getData('binary', target);
    const emccFlags = [...(binary?.emccFlags || []), ...rustKeepFlags];

    triggerExtensions('buildWasm', 'beforeBuild', [emccFlags]);

    if (target.runtime === 'mt' && !emccFlags.includes('-pthread')) {
        emccFlags.push('-pthread');
        emccFlags.push('-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency || 1, 2)');
        emccFlags.push('-sPTHREAD_POOL_SIZE_STRICT=2');
    }

    if (target.platform === 'wasm') {
        emccFlags.push('-msimd128');
    }

    if (target.arch === 'wasm64') {
        emccFlags.push('-sMEMORY64=1');
    }

    if (state.config.excludedDependencies?.length && !emccFlags.includes('-sERROR_ON_UNDEFINED_SYMBOLS=0')) {
        emccFlags.push('-sERROR_ON_UNDEFINED_SYMBOLS=0');
    }

    // Link inputs (flags, lib set, preloaded data) are invisible to a pure
    // artifact-existence cache: a config emccFlags change used to keep
    // serving the old wasm until a manual .crossbind clear. Fingerprint them next
    // to the artifact and treat a mismatch as a cache miss. Lib entries carry
    // size+mtime, so a rebuilt dependency archive (same path, new content)
    // forces the relink too.
    const linkFingerprintFile = `${state.config.paths.build}/${target.jsName}.fingerprint`;
    // The artifact also bundles the JS runtime (buildJs) and links the C runtime
    // entries from cpp-runtime/ - inputs a flag/lib fingerprint cannot see, so a
    // runtime edit used to keep serving the previously linked output.
    const runtimeAssetDirs = [
        `${state.config.paths.cli}/assets/js-runtime`,
        `${state.config.paths.cli}/assets/cpp-runtime`,
    ];
    const runtimeAssets = runtimeAssetDirs.flatMap((dir) => (fs.existsSync(dir)
        ? fs.readdirSync(dir, { recursive: true })
            .map((file) => `${dir}/${file}`)
            .filter((file) => fs.statSync(file).isFile())
        : []));
    const linkFingerprint = getContentHash(JSON.stringify({
        // Bump when the link-arg layout itself changes (e.g. the move to
        // bridge-only --whole-archive), so cached artifacts from the old
        // layout cannot satisfy the new one. The effective whole-archive
        // set is part of the layout: flipping a config flag must relink.
        linkLayout: 'v2-bridge-only-whole-archive',
        // The emcc arg tail is hardcoded per environment in this file, invisible to the
        // emccFlags entry below - hashing the builder itself makes any inline-arg edit
        // (a new -s flag, an EXPORTED_RUNTIME_METHODS change) a guaranteed cache miss.
        builder: getFilesFingerprint([fileURLToPath(import.meta.url)]),
        wholeArchiveAll,
        wholeArchiveNames: [...wholeArchiveNames].sort(),
        emccFlags,
        libs: libs.map((lib) => {
            const stat = fs.existsSync(lib) ? fs.statSync(lib) : null;
            return { lib, size: stat ? stat.size : null, mtimeMs: stat ? stat.mtimeMs : null };
        }),
        data: getData('data', target),
        runtime: getFilesFingerprint(runtimeAssets),
        rustSources: getFilesFingerprint(rustSources),
    }));
    const linkChanged = !fs.existsSync(linkFingerprintFile)
        || fs.readFileSync(linkFingerprintFile, { encoding: 'utf8' }) !== linkFingerprint;

    if (!options.force && !linkChanged && fs.existsSync(`${state.config.paths.build}/${target.jsName}`) && fs.existsSync(`${state.config.paths.build}/${target.wasmName}`)) {
        logger.cachedStep(target, 'wasm+js');
        return false;
    }

    if (target.runtimeEnv === 'browser') {
        logger.startStep(target, 'wasm');
        const t0 = performance.now();

        triggerExtensions('buildWasm', 'beforeBuildBrowser', [emccFlags]);

        const data = Object.entries(getData('data', target)).map(([key, value]) => ['--preload-file', `${key.replaceAll('@', '@@')}@/crossbind/${value}`]).flat();
        run('em++', [
            '-lembind',
            ...emccFlags,
            // '-lwebsocket.js', '-sPROXY_POSIX_SOCKETS', '-sWEBSOCKET_DEBUG=1', '-sJSPI', '-g', '-sWASMFS',
            '-s', 'FORCE_FILESYSTEM=1',
            '-sEXPORT_NAME=Module2', // '-pthread', '-sPTHREAD_POOL_SIZE=5',
            ...linkLibs, ...rustSources, `${state.config.paths.cli}/assets/cpp-runtime/browser.cpp`,
            ...(isProd ? ['-O3'] : []),
            '-s', 'WASM=1', '-s', 'MODULARIZE=1', '-s', 'DYNAMIC_EXECUTION=0',
            '-s', 'RESERVED_FUNCTION_POINTERS=200', // '-s', 'FORCE_FILESYSTEM=1',
            '-s', 'ALLOW_MEMORY_GROWTH=1',
            // Keep this explicit: Firefox/WebKit TextDecoder rejects views over resizable
            // ArrayBuffers, breaking every string crossing the wasm boundary.
            '-s', 'GROWABLE_ARRAYBUFFERS=0',
            '-s', 'WASMFS',
            '-s', 'ENVIRONMENT=web,webview,worker',
            // getExceptionMessage must be listed here too: the helpers flag alone defines it
            // in the glue but does not attach it to the MODULARIZE instance.
            '-s', 'EXPORTED_RUNTIME_METHODS=["FS", "ENV", "getExceptionMessage"]',
            '-fwasm-exceptions',
            // Exports getExceptionMessage so the runtime can decode raw WebAssembly.Exception
            // values back into JS Errors carrying the C++ what() text.
            '-sEXPORT_EXCEPTION_HANDLING_HELPERS',
            '-o', `${state.config.paths.build}/${target.rawJsName}`,
            ...data,
        ], null, target);
        const t1 = performance.now();
        logger.doneStep(target, 'wasm');
        logger.startStep(target, 'js');
        // The pthread bootstrap spawns workers from _scriptName, captured from
        // document.currentScript at LOAD time - undefined when the bridge is
        // loaded as a module script, so workers would fetch "/undefined" and
        // direct-mode mt init hangs. Inject Module.crossbindMainScript (set by the
        // browser adapter from paths.worker/paths.js; a crossbind-specific key, as
        // emscripten's own mainScriptUrlOrBlob trips emsdk 6 debug assertions
        // on st targets) at SPAWN time instead. The previous spaced
        // 'var _scriptName = ' rewrite no longer matched the minified glue and
        // silently no-opped; the guard below turns any future format drift
        // into a visible error instead.
        replace({
            regex: 'pthreadMainJs=_scriptName',
            replacement: 'pthreadMainJs=Module["crossbindMainScript"]||_scriptName',
            paths: [`${state.config.paths.build}/${target.rawJsName}`],
            recursive: false,
            silent: true,
        });
        const glue = fs.readFileSync(`${state.config.paths.build}/${target.rawJsName}`, 'utf8');
        if (glue.includes('pthreadMainJs') && !glue.includes('Module["crossbindMainScript"]||_scriptName')) {
            logger.error('pthread spawn rewrite missed (emscripten glue format changed?): mt builds may fetch /undefined workers');
        }
        /* replace({
            regex: 'val === 10',
            replacement: 'false',
            paths: [`${state.config.paths.build}/${state.config.general.name}.js`],
            recursive: false,
            silent: true,
        }); */
        await buildJs(target);
        // fs.rmSync(`${state.config.paths.build}/${state.config.general.name}.js`);
        // fs.copyFileSync(`${state.config.paths.build}/${state.config.general.name}.browser.js`, `${state.config.paths.build}/${state.config.general.name}.js`);
        // fs.renameSync(`${state.config.paths.build}/${state.config.general.name}.js`, `${state.config.paths.build}/${state.config.general.name}.worker.browser.js`);
        logger.doneStep(target, 'js');
    }

    if (target.runtimeEnv === 'edge') {
        logger.startStep(target, 'wasm');
        const t0 = performance.now();

        triggerExtensions('buildWasm', 'beforeBuildEdge', [emccFlags]);

        const data = Object.entries(getData('data', target)).map(([key, value]) => ['--preload-file', `${key.replaceAll('@', '@@')}@/crossbind/${value}`]).flat();
        run('em++', [
            '-lembind',
            ...emccFlags,
            '-sEXPORT_NAME=Module2',
            // rustSources carries the embind-rust adapter TU (emval/json/tid hooks); without
            // it any linked Rust package archive fails with undefined crossbind_* symbols.
            ...linkLibs, ...rustSources,
            ...(isProd ? ['-O3'] : []),
            '-s', 'WASM=1', '-s', 'MODULARIZE=1', '-s', 'DYNAMIC_EXECUTION=0',
            '-s', 'RESERVED_FUNCTION_POINTERS=200', // '-s', 'FORCE_FILESYSTEM=1',
            '-s', 'ALLOW_MEMORY_GROWTH=1',
            // See the GROWABLE_ARRAYBUFFERS note in the browser block (Firefox/WebKit TextDecoder).
            '-s', 'GROWABLE_ARRAYBUFFERS=0',
            '-s', 'ENVIRONMENT=web',
            '-s', 'EXPORTED_RUNTIME_METHODS=["ENV", "getExceptionMessage"]',
            '-fwasm-exceptions',
            '-sEXPORT_EXCEPTION_HANDLING_HELPERS',
            '-o', `${state.config.paths.build}/${target.rawJsName}`,
            ...data,
        ], null, target);
        const t1 = performance.now();
        logger.doneStep(target, 'wasm');
        logger.startStep(target, 'js');
        await buildJs(target);
        logger.doneStep(target, 'js');
    }

    if (target.runtimeEnv === 'node') {
        logger.startStep(target, 'wasm');

        triggerExtensions('buildWasm', 'beforeBuildNodeJS', [emccFlags]);

        run('em++', [
            '-lembind',
            ...emccFlags,
            // '-s', 'FETCH', '-sJSPI', '-pthread', '-sPTHREAD_POOL_SIZE=5',
            '-s', 'FORCE_FILESYSTEM=1',
            ...linkLibs, ...rustSources, `${state.config.paths.cli}/assets/cpp-runtime/node.cpp`,
            ...(isProd ? ['-O3'] : []),
            '-s', 'WASM=1', '-s', 'MODULARIZE=1', '-s', 'DYNAMIC_EXECUTION=0',
            '-s', 'RESERVED_FUNCTION_POINTERS=200', // '-s', 'DISABLE_EXCEPTION_CATCHING=0', '-s', 'FORCE_FILESYSTEM=1',
            '-s', 'ALLOW_MEMORY_GROWTH=1',
            // See the GROWABLE_ARRAYBUFFERS note in the browser block (older Node V8 lacks it too).
            '-s', 'GROWABLE_ARRAYBUFFERS=0',
            '-s', 'WASMFS',
            '-s', 'NODE_HOST_ENV=1',
            '-s', 'ENVIRONMENT=node',
            '-s', 'EXPORTED_RUNTIME_METHODS=["FS", "ENV", "getExceptionMessage"]',
            '-fwasm-exceptions',
            '-sEXPORT_EXCEPTION_HANDLING_HELPERS',
            '-o', `${state.config.paths.build}/${target.rawJsName}`,
        ], null, target);
        logger.doneStep(target, 'wasm');
        logger.startStep(target, 'js');
        await buildJs(target);
        if (emccFlags.includes('FETCH')) {
            fs.appendFileSync(`${state.config.paths.build}/${target.jsName}`, 'var XMLHttpRequest = require(\'xhr2\');\n');
        }
        // fs.renameSync(`${state.config.paths.build}/${state.config.general.name}.js`, `${state.config.paths.build}/${state.config.general.name}.worker.node.js`);
        logger.doneStep(target, 'js');

        Object.entries(getData('data', target)).forEach(([key, value]) => {
            if (fs.existsSync(key)) {
                const dAssetPath = `${state.config.paths.build}/data/${value}`;
                if (!fs.existsSync(dAssetPath)) {
                    fs.mkdirSync(dAssetPath, { recursive: true });
                    fs.cpSync(key, dAssetPath, { recursive: true });
                }
            }
        });
    }

    if (fs.existsSync(`${state.config.paths.build}/${target.dataName}`)) {
        fs.renameSync(`${state.config.paths.build}/${target.dataName}`, `${state.config.paths.build}/${target.dataTxtName}`);
    }

    fs.writeFileSync(linkFingerprintFile, linkFingerprint);
    return true;
}
