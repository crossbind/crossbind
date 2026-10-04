import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import virtual from '@rollup/plugin-virtual';
import run from './run.js';
import getLinkInputs from './getLinkInputs.js';
import getData from './getData.js';
import { suppressNodeBuiltinWarnings } from './buildJs.js';
import state from '../state/index.js';
import logger from '../utils/logger.js';
import { getContentHash, getFilesFingerprint } from '../utils/hash.js';
import { buildLinkLibArgs } from '../utils/linkLayout.js';
import resolveEmbindNapiRoot, { resolveEmbindJsiRoot } from '../utils/resolveEmbindNapi.js';
import scopedEmbind from '../utils/scopedEmbind.js';
import resolveEmbindRustRoot from '../utils/resolveEmbindRust.js';
import toolchainNoticesDir from '../utils/toolchainNotices.js';

const cpuCount = Math.max(1, os.cpus().length - 1);
const WINDOWS_IMAGE_NOTICES = '/opt/licenses/llvm-mingw';

function filesUnder(dirs) {
    return dirs.flatMap((dir) => (fs.existsSync(dir)
        ? fs.readdirSync(dir, { recursive: true })
            .map((file) => `${dir}/${file}`)
            .filter((file) => fs.statSync(file).isFile())
        : []));
}

function linkInputs(target) {
    const {
        libs, wholeArchiveAll, wholeArchiveNames, rustKeepFlags, hasRust,
    } = getLinkInputs(target, {
        // The linker loads the archive member that defines a -u symbol; Mach-O prefixes C names with _.
        keepFlag: (name) => `-Wl,-u,${target.platform === 'darwin' ? '_' : ''}crossbind_keep_${name}`,
    });
    const linkArgs = [
        ...buildLinkLibArgs(libs, { wholeArchiveAll, wholeArchiveNames, forceLoad: target.platform === 'darwin' }),
        ...rustKeepFlags,
        // The system libraries the archives need, declared by the packages that bring them in.
        ...(getData('binary', target)?.addonFlags ?? []),
    ];
    // The addon runs embind-jsi, so Rust packages bind through the adapter React Native links.
    const extraSources = hasRust ? [`${resolveEmbindRustRoot()}/adapters/jsi.cpp`] : [];
    return { libs, linkArgs, extraSources };
}

function envOf(target) {
    return Object.fromEntries(Object.entries(getData('env', target))
        .map(([key, value]) => [key, typeof value === 'function' ? value(state, target) : value]));
}

// A package publishes its addons in <package>-<platform>-<arch> by listing them as optional
// dependencies, which is also how npm learns to install only the one for its machine.
function addonPackagePattern(served) {
    const { name, optionalDependencies = {} } = state.config.package ?? {};
    return name && served.some((t) => Object.hasOwn(optionalDependencies, `${name}-${t.platform}-${t.arch}`))
        ? `${name}-{platform}-{arch}`
        : null;
}

// One loader serves every addon of a build type, so each addon's env is keyed the way the loader
// looks it up at runtime rather than taken from whichever arch happened to build last.
export function nodeLoaderConfig(target) {
    const served = state.targets.filter((t) => t.addonPattern && t.jsName === target.jsName);
    const addonPackage = addonPackagePattern(served);
    return {
        env: Object.fromEntries(served.map((t) => [`${t.platform}-${t.arch}`, envOf(t)])),
        general: { name: state.config.general.name },
        paths: { addon: target.addonPattern, ...(addonPackage ? { addonPackage } : {}) },
    };
}

// The loader hands the addon dist/data by default, as the wasm build does. A relinked addon may come
// from updated dependencies, so its data is copied again rather than kept.
export function publishNodeData(target, { refresh }) {
    Object.entries(getData('data', target)).forEach(([source, name]) => {
        const published = `${state.config.paths.output}/data/${name}`;
        if (!fs.existsSync(source) || (!refresh && fs.existsSync(published))) {
            return;
        }
        fs.rmSync(published, { recursive: true, force: true });
        fs.cpSync(source, published, { recursive: true });
    });
}

async function bundleLoader(target, napiRoot, loaderConfig) {
    const systemConfig = `export default ${JSON.stringify(loaderConfig)};`;
    const bundle = await rollup({
        input: `${napiRoot}/js/loader.js`,
        plugins: [
            virtual({ 'crossbind/systemConfig': systemConfig }), scopedEmbind(`${resolveEmbindJsiRoot()}/js/embind.js`), nodeResolve(), commonjs(),
        ],
        onwarn: suppressNodeBuiltinWarnings,
    });
    await bundle.write({ file: `${state.config.paths.build}/${target.jsName}`, format: 'cjs', exports: 'default' });
    await bundle.close();
}

// Links one Node-API addon from the project's archives and bundles the loader that picks the
// addon matching the running process.
export default async function buildNode(target, options = {}) {
    if (target.platform === 'darwin' && process.platform !== 'darwin') {
        logger.info(`[${target.path}] addon skipped (macOS addons build on a macOS host)`);
        return false;
    }
    if (state.config.export.type === 'cargo') {
        logger.info(`[${target.path}] addon skipped (cargo package - staticlib only)`);
        return false;
    }

    const buildType = target.buildType === 'release' ? 'Release' : 'Debug';
    const { build } = state.config.paths;
    const napiRoot = resolveEmbindNapiRoot();
    const jsiRoot = resolveEmbindJsiRoot();
    const { libs, linkArgs, extraSources } = linkInputs(target);
    const loaderConfig = nodeLoaderConfig(target);

    const fingerprintFile = `${build}/${target.addonName}.fingerprint`;
    const fingerprint = getContentHash(JSON.stringify({
        builder: getFilesFingerprint([fileURLToPath(import.meta.url)]),
        linkArgs,
        libs: libs.map((lib) => {
            const stat = fs.existsSync(lib) ? fs.statSync(lib) : null;
            return { lib, size: stat ? stat.size : null, mtimeMs: stat ? stat.mtimeMs : null };
        }),
        loaderConfig,
        runtime: getFilesFingerprint(filesUnder([
            `${napiRoot}/cpp`, `${napiRoot}/js`, `${napiRoot}/third_party`, `${jsiRoot}/cpp/src`, `${jsiRoot}/js`,
        ])),
        extraSources: getFilesFingerprint(extraSources),
    }));
    const isLinkChanged = !fs.existsSync(fingerprintFile)
        || fs.readFileSync(fingerprintFile, { encoding: 'utf8' }) !== fingerprint;
    if (!options.force && !isLinkChanged
        && fs.existsSync(`${build}/${target.addonName}`) && fs.existsSync(`${build}/${target.jsName}`)) {
        logger.cachedStep(target, 'addon');
        return false;
    }

    const platformPrefix = `Node-${buildType}`;
    logger.startStep(target, 'addon');
    run(null, [
        'cmake', `${napiRoot}/cpp`,
        `-DCMAKE_BUILD_TYPE=${buildType}`,
        `-DCROSSBIND_ADDON_FILE=${target.addonName}`,
        `-DCROSSBIND_JSI_ROOT=${jsiRoot}`,
        `-DCROSSBIND_EXTRA_SOURCES=${extraSources.join(';')}`,
        `-DCROSSBIND_LINK_ARGS=${linkArgs.join(';')}`,
        `-DCROSSBIND_LINK_DEPENDS=${libs.join(';')}`,
    ], platformPrefix, target);
    run(null, ['cmake', '--build', '.', '-j', String(cpuCount)], platformPrefix, target);
    if (target.platform === 'win32') {
        // The mingw-w64 runtime and winpthreads in the addon ask for their notices in binary
        // distributions. The windows image carries them; a host toolchain may not.
        const notices = toolchainNoticesDir('win32');
        run(null, ['sh', '-c', `if [ -d ${WINDOWS_IMAGE_NOTICES} ]; then mkdir -p ${notices} && cp ${WINDOWS_IMAGE_NOTICES}/* ${notices}/; fi`], null, target);
    }
    fs.copyFileSync(`${build}/${platformPrefix}/${target.path}/${target.addonName}`, `${build}/${target.addonName}`);
    logger.doneStep(target, 'addon');

    logger.startStep(target, 'js');
    await bundleLoader(target, napiRoot, loaderConfig);
    logger.doneStep(target, 'js');

    fs.writeFileSync(fingerprintFile, fingerprint);
    return true;
}
