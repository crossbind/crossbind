import os from 'node:os';
import fs from 'node:fs';
import replace from 'replace';
import getData from './getData.js';
import run from './run.js';
import buildCargo from './buildCargo.js';
import { cargoTripleFor } from '../utils/cargoTarget.js';
import getCmakeParameters from './getCmakeParameters.js';
import triggerExtensions from './extensions.js';
import state from '../state/index.js';
import logger from '../utils/logger.js';
import { WASI_EMULATION_LIBS, WASI_LINK_LIBS, wasiCFlags, wasiCxxFlags } from '../utils/wasiToolchain.js';
import { getFilesFingerprint, getContentHash } from '../utils/hash.js';

const cpuCount = Math.max(1, os.cpus().length - 1);
const sharedPlatforms = ['android'];

export default function createLib(target, fileType, options = {}) {
    if (!target || !options || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error('invalid target or options');
    }

    if (target.platform === 'ios' && process.platform !== 'darwin') {
        return;
    }

    const buildType = target.buildType === 'release' ? 'Release' : 'Debug';
    const platformPrefix = `${fileType ? `${fileType}-` : ''}${buildType}`;
    const libdir = `${state.config.paths.build}/${platformPrefix}/prebuilt/${target.path}`;
    const buildPath = `${state.config.paths.build}/${platformPrefix}/${target.path}`;
    // wasi configure tool links need the runtime stubs; compiled below, referenced from LIBS.
    const wasiStubObj = `${buildPath}/crossbind-wasi-stubs.o`;

    // The lib dir is reused while the bridge list grows, so an early smaller nativeGlob build must not satisfy later sets: fingerprint the glob and miss on mismatch.
    const fingerprintFile = `${libdir}/crossbind-nativeglob.fingerprint`;
    const fingerprint = options.nativeGlob ? getFilesFingerprint(options.nativeGlob) : null;
    const fingerprintChanged = fingerprint !== null
        && (!fs.existsSync(fingerprintFile) || fs.readFileSync(fingerprintFile, { encoding: 'utf8' }) !== fingerprint);

    // Config emccFlags feed compile-time state too (CROSSBIND_JSPI below), so a flag change must miss this cache.
    const configEmccFlags = getData('binary', target)?.emccFlags || [];
    const flagsFingerprintFile = `${libdir}/crossbind-emccflags.fingerprint`;
    const flagsFingerprint = getContentHash(JSON.stringify(configEmccFlags));
    const flagsChanged = !fs.existsSync(flagsFingerprintFile)
        || fs.readFileSync(flagsFingerprintFile, { encoding: 'utf8' }) !== flagsFingerprint;

    // Rust packages build with cargo on the host and stage the .a like any other prebuilt; the
    // normal prebuilt-link machinery then links it for every platform (no SWIG bridge for Rust).
    // Runs BEFORE the existence cache below: cargo is the incremental cache, and an existence
    // skip would keep serving a stale staged .a after crate source edits.
    if (state.config.export?.type === 'cargo') {
        // Platforms with no cargo triple (wasi, ...) are skipped, so a plain `crossbind build`
        // still completes every other platform instead of dying on the first unsupported one.
        if (!cargoTripleFor(target)) {
            logger.info(`[${target.path}] cargo package skipped (no cargo triple for this platform)`);
            return false;
        }
        logger.startStep(target, fileType);
        const changed = buildCargo(target, libdir);
        if (fingerprint !== null) fs.writeFileSync(fingerprintFile, fingerprint);
        fs.writeFileSync(flagsFingerprintFile, flagsFingerprint);
        return changed;
    }

    if (!options.force && !fingerprintChanged && !flagsChanged && fs.existsSync(`${libdir}/lib`)) {
        logger.cachedStep(target, fileType);
        return false;
    }

    // Bridges guard _JSPI registrations behind CROSSBIND_JSPI (bridgeAsyncGuard); define it only when this target links with -sJSPI.
    const isJspiTarget = target.platform === 'wasm' && configEmccFlags.includes('-sJSPI');
    if (fileType === 'Bridge' && target.platform === 'wasm' && !isJspiTarget
        && options.nativeGlob?.some((f) => fs.existsSync(f) && fs.readFileSync(f, { encoding: 'utf8' }).includes('emscripten::async()'))) {
        logger.info(`[${target.path}] _JSPI bindings skipped: this target links without -sJSPI (add it to binary.emccFlags to enable them)`);
    }

    const buildEnv = { params: [] };
    let buildParams;
    const depPaths = state.config.allDependencyPaths[target.path];
    if (state.config.build.withBuildConfig) {
        const { getBuildParams, getExtraLibs } = state.config.build;
        buildEnv.console = true;
        const ext = sharedPlatforms.includes(target.platform) ? 'so' : 'a';
        buildParams = getBuildParams ? getBuildParams(target, depPaths, ext, buildPath) : [];
        if (state.config.build?.buildType !== 'configure') {
            const cmakeBuildType = sharedPlatforms.includes(target.platform) ? 'SHARED' : 'STATIC';
            // Upstream CMakeLists increasingly default BUILD_SHARED_LIBS=ON; on wasm that extra .so link fails under emsdk 6, so default to the platform's lib kind (recipe -D flags come later and can override).
            buildParams.unshift(`-DBUILD_SHARED_LIBS=${cmakeBuildType === 'SHARED' ? 'ON' : 'OFF'}`);
            buildParams.push(`-DCMAKE_PREFIX_PATH=${libdir}`, `-DCMAKE_FIND_ROOT_PATH=${libdir}`, `-DBUILD_TYPE=${cmakeBuildType}`);
        }

        const cFlags = Object.values(depPaths).filter(d => d.header).map((d) => `-I${d.header}`);
        const ldFlags = Object.values(depPaths).filter(d => d.libPath).map((d) => `-L${d.libPath}`);
        let dependLibs = '';
        if (state.config.build?.buildType === 'configure') {
            dependLibs = Object.keys(depPaths)
                .filter(d => d && d !== 'cmake')
                // A declared dep without a wasi archive (e.g. jpeg) would fail every configure probe.
                .filter(d => target.platform !== 'wasi' || fs.existsSync(depPaths[d].lib))
                .map((d) => `-l${d}`).join(' ');
        }

        const extraLibs = getExtraLibs ? getExtraLibs(target) : [];

        triggerExtensions('createLib', 'setFlagWithBuildConfig', [buildEnv, cFlags, ldFlags]);
        if (target.runtime === 'mt') {
            cFlags.push('-pthread');
            ldFlags.push('-pthread');
        }

        if (target.platform === 'wasm') {
            cFlags.push('-msimd128');
            ldFlags.push('-msimd128');
        }

        if (isJspiTarget) {
            cFlags.push('-DCROSSBIND_JSPI');
        }

        if (target.platform === 'wasm' && target.arch === 'wasm64') {
            cFlags.push('-sMEMORY64=1');
            ldFlags.push('-sMEMORY64=1');
        }

        buildEnv.params.push('-e', `CFLAGS=${cFlags.join(' ')}`);
        buildEnv.params.push('-e', `CXXFLAGS=${cFlags.join(' ')}`);
        buildEnv.params.push('-e', `LDFLAGS=${ldFlags.join(' ')} ${extraLibs.join(' ')}`);
        // Emulation archives must land in LIBS (after the objects), not LDFLAGS.
        const wasiStubLib = state.config.build?.buildType === 'configure' ? `${wasiStubObj} ` : '';
        const wasiLibs = target.platform === 'wasi' ? ` ${wasiStubLib}${WASI_EMULATION_LIBS.join(' ')}` : '';
        buildEnv.params.push('-e', `LIBS=${dependLibs} ${extraLibs.join(' ')}${wasiLibs}`);

        let configBuildEnv = state.config.build.env;
        if (configBuildEnv && typeof configBuildEnv === 'function') {
            configBuildEnv = configBuildEnv(target);
        }
        configBuildEnv?.forEach((e) => {
            buildEnv.params.push('-e', e);
        });
    } else {
        buildParams = getCmakeParameters(target, options);

        triggerExtensions('createLib', 'setFlagWithoutBuildConfig', [buildEnv]);

        if (target.runtime === 'mt') {
            buildEnv.params.push('-e', `CFLAGS=-pthread`);
            buildEnv.params.push('-e', `CXXFLAGS=-pthread`);
            buildEnv.params.push('-e', `LDFLAGS=-pthread`);
        }

        if (target.platform === 'wasm') {
            buildEnv.params.push('-e', `CFLAGS=-msimd128`);
            buildEnv.params.push('-e', `CXXFLAGS=-msimd128`);
            buildEnv.params.push('-e', `LDFLAGS=-msimd128`);
        }

        if (target.platform === 'wasm' && target.arch === 'wasm64') {
            buildEnv.params.push('-e', `CFLAGS=-sMEMORY64=1`);
            buildEnv.params.push('-e', `CXXFLAGS=-sMEMORY64=1`);
            buildEnv.params.push('-e', `LDFLAGS=-sMEMORY64=1`);
        }

        if (isJspiTarget) {
            buildEnv.params.push('-e', `CFLAGS=-DCROSSBIND_JSPI`);
            buildEnv.params.push('-e', `CXXFLAGS=-DCROSSBIND_JSPI`);
        }
    }

    logger.startStep(target, fileType);
    const t0 = performance.now();
    const cmakeDir = state.config.build.withBuildConfig ? `${state.config.paths.build}/source` : state.config.paths.cmakeDir;

    if (state.config.build?.beforeRun) {
        const dataList = state.config.build?.beforeRun(cmakeDir);
        dataList.forEach((data) => {
            run(data.program, data.parameters || [], platformPrefix, target, buildEnv);
        });
    }

    // stubs.c lives outside the docker mount (paths.cli); stage it into the build tree.
    const stageWasiStubs = () => {
        const staged = `${buildPath}/crossbind-wasi-stubs.c`;
        fs.mkdirSync(buildPath, { recursive: true });
        fs.copyFileSync(`${state.config.paths.cli}/assets/wasi-runtime/stubs.c`, staged);
        run(null, [
            'wasi-clang', ...wasiCFlags(), '-c', staged,
            '-o', wasiStubObj,
        ], platformPrefix, target, { console: buildEnv.console });
    };

    if (!options.bypassCmake) {
        if (state.config.build?.buildType === 'configure') {
            fs.cpSync(cmakeDir, buildPath, { recursive: true });
            if (state.config.build?.sourceReplaceList) {
                state.config.build.sourceReplaceList(target, depPaths)?.forEach(({ regex, replacement, paths }) => {
                    replace({
                        regex, replacement, paths: paths.map((p) => `${buildPath}/${p}`), recursive: false, silent: true,
                    });
                });
            }
            if (target.platform === 'wasi') {
                // LIBS references the stub object before the first configure link probe.
                stageWasiStubs();
            }
            run(null, [
                state.config.build?.configureProgram || './configure',
                ...buildParams,
                `--prefix=${libdir}`,
            ], platformPrefix, target, buildEnv);
        } else {
            if (target.platform === 'wasi') {
                // Upstream exe links (BUILD_APPS etc.) need the stubs + wasm-EH tail on CMAKE_EXE_LINKER_FLAGS so try_compile probes link the same way.
                stageWasiStubs();
                buildParams.push(`-DCMAKE_EXE_LINKER_FLAGS=${[...wasiCxxFlags(), wasiStubObj, ...WASI_LINK_LIBS].join(' ')}`);
            }
            run(null, [
                target.platform === 'ios' && state.config.build?.useIOSCMake ? 'ios-cmake' : 'cmake', cmakeDir,
                `-DCMAKE_BUILD_TYPE=${buildType}`,
                `-DCMAKE_INSTALL_PREFIX=${libdir}`,
                ...buildParams,
            ], platformPrefix, target, buildEnv);
        }
    }
    const t1 = performance.now();
    if (target.platform === 'ios' && state.config.build?.buildType !== 'configure') {
        const iOSCMakeBuilder = state.config.build?.useIOSCMake ? 'ios-cmake' : 'cmake';
        run(null, [iOSCMakeBuilder, '--build', '.', '-j', cpuCount, '--config', buildType, '--target', 'install'], platformPrefix, target, { console: buildEnv.console });
    } else {
        // Some upstream makefiles race when one -j invocation carries multiple goals (openssl's
        // install builds apps twice); recipes can split phases via build.makePhases.
        const makePhases = state.config.build?.makePhases || [['install']];
        makePhases.forEach((phase) => {
            run(null, ['make', `-j${cpuCount}`, ...phase], platformPrefix, target, { console: buildEnv.console });
        });
    }
    const t2 = performance.now();
    const cmakeMs = Math.round(t1 - t0);
    const buildMs = Math.round(t2 - t1);
    const detail = `cmake ${cmakeMs < 1000 ? `${cmakeMs}ms` : `${(cmakeMs / 1000).toFixed(1)}s`}, make ${buildMs < 1000 ? `${buildMs}ms` : `${(buildMs / 1000).toFixed(1)}s`}, j${cpuCount}`;
    logger.doneStep(target, fileType, detail);

    fs.mkdirSync(libdir, { recursive: true });
    if (fingerprint !== null) {
        fs.writeFileSync(fingerprintFile, fingerprint);
    }
    fs.writeFileSync(flagsFingerprintFile, flagsFingerprint);
    // Callers can force the final link when a lib actually rebuilt.
    return true;
}
