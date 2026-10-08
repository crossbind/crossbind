import fs from 'node:fs';
import { writeNativeSourceStamp } from '../utils/nativeSourceStamp.js';
import { fileURLToPath } from 'node:url';
import run from './run.js';
import getLinkInputs from './getLinkInputs.js';
import getData from './getData.js';
import buildJs from './buildJs.js';
import triggerExtensions from './extensions.js';
import state from '../state/index.js';
import resolveEmbindRustRoot from '../utils/resolveEmbindRust.js';
import logger from '../utils/logger.js';
import { getContentHash, getFilesFingerprint } from '../utils/hash.js';
import { buildLinkLibArgs } from '../utils/linkLayout.js';
import { guardBigIntArguments, guardEmbindArguments } from '../utils/embindArgumentGuards.js';
import { separateCallArguments } from '../utils/embindCallArguments.js';
import { queueJspiCalls } from '../utils/embindJspiQueue.js';
import { spawnPthreadsFromMainScript } from '../utils/pthreadMainScript.js';

const GLUE_REWRITES = ['../utils/embindArgumentGuards.js', '../utils/embindCallArguments.js', '../utils/embindJspiQueue.js', '../utils/pthreadMainScript.js']
    .map((file) => fileURLToPath(new URL(file, import.meta.url)));

// embind's bigint converter turns any Number into a BigInt, so 2^53+1 silently becomes 2^53.
// A 64-bit parameter takes a BigInt or a Number that is a safe integer instead; the jsi adapter
// enforces the same rule natively. Each runtimeEnv links its own glue, so each one calls this.
function guardBigIntConversions(target) {
    const gluePath = `${state.config.paths.build}/${target.rawJsName}`;
    const { text, missed } = guardBigIntArguments(fs.readFileSync(gluePath, 'utf8'));
    fs.writeFileSync(gluePath, text);
    if (missed) {
        logger.error('bigint safe-integer rewrite missed (emscripten glue format changed?): 64-bit Number arguments round silently');
    }
}

// Wrong-typed integer and enum arguments cross as 0 in a release build (utils/embindArgumentGuards.js);
// each runtimeEnv links its own glue, so each one calls this after its link.
function guardArgumentConversions(target) {
    const gluePath = `${state.config.paths.build}/${target.rawJsName}`;
    const { text, missed } = guardEmbindArguments(fs.readFileSync(gluePath, 'utf8'));
    fs.writeFileSync(gluePath, text);
    if (missed.length) {
        logger.error(`embind argument rewrite missed ${missed.join(', ')} (emscripten glue format changed?): wrong-typed arguments cross as 0`);
    }
}

// Overlapping calls of one embind function free each other's arguments (utils/embindCallArguments.js);
// each runtimeEnv links its own glue, so each one calls this after its link.
function separateEmbindCalls(target) {
    const gluePath = `${state.config.paths.build}/${target.rawJsName}`;
    const { text, missed } = separateCallArguments(fs.readFileSync(gluePath, 'utf8'));
    fs.writeFileSync(gluePath, text);
    if (missed) {
        logger.error('embind per-call argument rewrite missed (emscripten glue format changed?): overlapping calls of one function free each other\'s arguments');
    }
}

// Suspended _JSPI calls that resume out of order overwrite each other's C stack (utils/embindJspiQueue.js);
// each runtimeEnv links its own glue, so each one calls this after its link.
function queueJspiEmbindCalls(target) {
    const gluePath = `${state.config.paths.build}/${target.rawJsName}`;
    const { text, missed } = queueJspiCalls(fs.readFileSync(gluePath, 'utf8'));
    fs.writeFileSync(gluePath, text);
    if (missed) {
        logger.error('embind _JSPI queue rewrite missed (emscripten glue format changed?): suspended _JSPI calls can overwrite each other\'s C stack');
    }
}

// A direct-mode mt init in a browser spawns its pthreads from "/undefined" (utils/pthreadMainScript.js).
function pointPthreadSpawn(target) {
    const gluePath = `${state.config.paths.build}/${target.rawJsName}`;
    const { text, missed } = spawnPthreadsFromMainScript(fs.readFileSync(gluePath, 'utf8'));
    fs.writeFileSync(gluePath, text);
    if (missed) {
        logger.error('pthread spawn rewrite missed (emscripten glue format changed?): mt builds may fetch /undefined workers');
    }
}

export default async function buildWasm(target, options = {}) {
    const isProd = target.buildType === 'release';

    // Cargo packages only stage their staticlib; the consuming app links and bundles it.
    if (state.config.export.type === 'cargo') {
        logger.info(`[${target.path}] wasm+js skipped (cargo package - staticlib only)`);
        return false;
    }

    const {
        libs, appRustLibs, wholeArchiveAll, wholeArchiveNames, rustKeepFlags, hasRust,
    } = getLinkInputs(target, {
        // wasm-ld's -u does NOT pull archive members (it just leaves an import);
        // --export forces the symbol to resolve, dragging the registration object in.
        keepFlag: (name) => `-Wl,--export=crossbind_keep_${name}`,
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
    // The adapter ships in @crossbind/core-embind-rust (declared by the consumer, resolved here).
    const rustSources = hasRust ? [`${resolveEmbindRustRoot()}/adapters/web.cpp`] : [];

    const binary = getData('binary', target);
    const emccFlags = [...(binary?.emccFlags || []), ...rustKeepFlags];
    // Rust code expects a native-sized stack (rustc's own wasm targets reserve 1 MiB) where
    // emscripten reserves 64 KiB, and a wasm stack has no guard page: an overflow overwrites static
    // data without a trap. A size set in the config stays; a debug build also checks for overflow.
    if (hasRust) {
        const set = emccFlags.join(' ');
        if (!/-s\s*(?:STACK_SIZE|TOTAL_STACK)=/.test(set)) emccFlags.push('-sSTACK_SIZE=1MB');
        if (!isProd && !/-s\s*STACK_OVERFLOW_CHECK=/.test(set)) emccFlags.push('-sSTACK_OVERFLOW_CHECK=1');
    }

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
        // The glue rewrites applied after the link count as the builder too.
        builder: getFilesFingerprint([fileURLToPath(import.meta.url), ...GLUE_REWRITES]),
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
            // The config's emccFlags follow the default level, so its -Oz or -Os wins (the last -O does).
            ...(isProd ? ['-O3'] : []),
            ...emccFlags,
            // '-lwebsocket.js', '-sPROXY_POSIX_SOCKETS', '-sWEBSOCKET_DEBUG=1', '-sJSPI', '-g', '-sWASMFS',
            '-s', 'FORCE_FILESYSTEM=1',
            '-sEXPORT_NAME=Module2', // '-pthread', '-sPTHREAD_POOL_SIZE=5',
            ...linkLibs, ...rustSources, `${state.config.paths.cli}/assets/cpp-runtime/browser.cpp`,
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
        pointPthreadSpawn(target);
        /* replace({
            regex: 'val === 10',
            replacement: 'false',
            paths: [`${state.config.paths.build}/${state.config.general.name}.js`],
            recursive: false,
            silent: true,
        }); */
        guardBigIntConversions(target);
        guardArgumentConversions(target);
        separateEmbindCalls(target);
        queueJspiEmbindCalls(target);
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
            // The config's emccFlags follow the default level, so its -Oz or -Os wins (the last -O does).
            ...(isProd ? ['-O3'] : []),
            ...emccFlags,
            '-sEXPORT_NAME=Module2',
            // rustSources carries the embind-rust adapter TU (emval/json/tid hooks); without
            // it any linked Rust package archive fails with undefined crossbind_* symbols.
            ...linkLibs, ...rustSources,
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
        guardBigIntConversions(target);
        guardArgumentConversions(target);
        separateEmbindCalls(target);
        queueJspiEmbindCalls(target);
        await buildJs(target);
        logger.doneStep(target, 'js');
    }

    if (target.runtimeEnv === 'node') {
        logger.startStep(target, 'wasm');

        triggerExtensions('buildWasm', 'beforeBuildNodeJS', [emccFlags]);

        run('em++', [
            '-lembind',
            // The config's emccFlags follow the default level, so its -Oz or -Os wins (the last -O does).
            ...(isProd ? ['-O3'] : []),
            ...emccFlags,
            // '-s', 'FETCH', '-sJSPI', '-pthread', '-sPTHREAD_POOL_SIZE=5',
            '-s', 'FORCE_FILESYSTEM=1',
            ...linkLibs, ...rustSources, `${state.config.paths.cli}/assets/cpp-runtime/node.cpp`,
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
        guardBigIntConversions(target);
        guardArgumentConversions(target);
        separateEmbindCalls(target);
        queueJspiEmbindCalls(target);
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
    writeNativeSourceStamp(`${state.config.paths.build}/${target.jsName}`, state.config.paths.native);
    return true;
}
