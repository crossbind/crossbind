import fs from 'node:fs';
import run from './run.js';
import getDependLibs from './getDependLibs.js';
import getData from './getData.js';
import state from '../state/index.js';
import logger from '../utils/logger.js';
import { getContentHash, getFilesFingerprint } from '../utils/hash.js';
import { buildLinkLibArgs } from '../utils/linkLayout.js';
import { wasiCxxFlags, WASI_LINK_LIBS } from '../utils/wasiToolchain.js';

// Links a platform:'wasi' target into one command module: main() is the entry, deps are DCE'd, data lands as a real dir for --dir preopens.
export default async function buildWasiCommand(target, options = {}) {
    const isProd = target.buildType === 'release';
    const buildType = isProd ? 'Release' : 'Debug';

    if (state.config.export?.type === 'cargo') {
        logger.info(`[${target.path}] wasi command skipped (cargo packages have no cargo wasi triple)`);
        return false;
    }

    const sourceLibCandidates = [
        `${state.config.paths.build}/Source-${buildType}/${target.path}/lib${state.config.general.name}.a`,
        `${state.config.paths.output}/prebuilt/${target.path}/lib/lib${state.config.general.name}.a`,
    ];
    const libs = [
        ...getDependLibs(target),
        sourceLibCandidates.find((lib) => fs.existsSync(lib)) ?? sourceLibCandidates[0],
    ];

    const binary = getData('binary', target);
    const wasiFlags = binary?.wasiFlags || [];

    const wholeArchiveAll = state.config.export.wholeArchive === true;
    const wholeArchiveNames = new Set();
    state.config.dependencyParameters.getCmakeDepends(target).forEach((dep) => {
        if (dep.export.wholeArchive === true) {
            (dep.export.libName || []).forEach((name) => wholeArchiveNames.add(name));
        }
    });
    // crt1 references main only weakly: the source archive must be force-included.
    const linkLibs = buildLinkLibArgs(libs, { wholeArchiveAll, wholeArchiveNames });

    const stubs = `${state.config.paths.cli}/assets/wasi-runtime/stubs.c`;
    const linkFingerprintFile = `${state.config.paths.build}/${target.wasmName}.fingerprint`;
    const linkFingerprint = getContentHash(JSON.stringify({
        linkLayout: 'wasi-v2',
        wasiFlags,
        wholeArchiveAll,
        wholeArchiveNames: [...wholeArchiveNames].sort(),
        libs: libs.map((lib) => {
            const stat = fs.existsSync(lib) ? fs.statSync(lib) : null;
            return { lib, size: stat ? stat.size : null, mtimeMs: stat ? stat.mtimeMs : null };
        }),
        data: getData('data', target),
        runtime: getFilesFingerprint([stubs]),
    }));
    const linkChanged = !fs.existsSync(linkFingerprintFile)
        || fs.readFileSync(linkFingerprintFile, { encoding: 'utf8' }) !== linkFingerprint;

    if (!options.force && !linkChanged && fs.existsSync(`${state.config.paths.build}/${target.wasmName}`)) {
        logger.cachedStep(target, 'wasi command');
        return false;
    }

    logger.startStep(target, 'wasi command');
    const t0 = performance.now();
    // stubs.c lives outside the docker mount (paths.cli); stage it next to the artifact.
    const stagedStubs = `${state.config.paths.build}/crossbind-wasi-stubs.c`;
    fs.mkdirSync(state.config.paths.build, { recursive: true });
    fs.copyFileSync(stubs, stagedStubs);
    run(null, [
        'wasi-clang++',
        stagedStubs,
        ...wasiCxxFlags(),
        ...(isProd ? ['-O3'] : ['-O0']),
        ...wasiFlags,
        ...linkLibs,
        ...WASI_LINK_LIBS,
        '-o', `${state.config.paths.build}/${target.wasmName}`,
    ], null, target);
    const ms = Math.round(performance.now() - t0);
    logger.doneStep(target, 'wasi command', ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

    // Dep data lands as a real folder next to the artifact for --dir preopens.
    Object.entries(getData('data', target)).forEach(([key, value]) => {
        if (fs.existsSync(key)) {
            const dataPath = `${state.config.paths.build}/data/${value}`;
            if (!fs.existsSync(dataPath)) {
                fs.mkdirSync(dataPath, { recursive: true });
                fs.cpSync(key, dataPath, { recursive: true });
            }
        }
    });

    fs.writeFileSync(linkFingerprintFile, linkFingerprint);
    return true;
}
