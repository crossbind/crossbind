import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import run from './run.js';
import getLinkInputs from './getLinkInputs.js';
import getData from './getData.js';
import state from '../state/index.js';
import logger from '../utils/logger.js';
import { getContentHash, getFilesFingerprint } from '../utils/hash.js';
import { buildLinkLibArgs } from '../utils/linkLayout.js';

const cpuCount = Math.max(1, os.cpus().length - 1);
const PROJECT_SOURCE = fileURLToPath(new URL('../assets/cmake/command', import.meta.url));
const PROJECT_FILES = ['CMakeLists.txt', 'command.cpp'];

const statOf = (lib) => {
    const stat = fs.existsSync(lib) ? fs.statSync(lib) : null;
    return { lib, size: stat ? stat.size : null, mtimeMs: stat ? stat.mtimeMs : null };
};

// The CLI may sit outside the docker mount, so the project is copied next to the build.
function stageProject(build) {
    const projectDir = `${build}/crossbind-command`;
    fs.mkdirSync(projectDir, { recursive: true });
    PROJECT_FILES.forEach((file) => fs.copyFileSync(`${PROJECT_SOURCE}/${file}`, `${projectDir}/${file}`));
    return projectDir;
}

function linkInputs(target) {
    const { libs, wholeArchiveAll, wholeArchiveNames } = getLinkInputs(target, { keepFlag: () => '', withBridge: false });
    const linkArgs = [
        ...buildLinkLibArgs(libs, { wholeArchiveAll, wholeArchiveNames, forceLoad: target.platform === 'darwin' }),
        // The system libraries the archives need, declared by the packages that bring them in.
        ...(getData('binary', target)?.addonFlags ?? []),
    ];
    return { libs, linkArgs };
}

// Links the project's main() and the archives it reaches into one executable.
export default async function buildNativeCommand(target, options = {}) {
    if (target.platform === 'darwin' && process.platform !== 'darwin') {
        logger.info(`[${target.path}] native command skipped (macOS executables link on a macOS host)`);
        return false;
    }
    if (state.config.export.type === 'cargo') {
        logger.info(`[${target.path}] native command skipped (cargo package - staticlib only)`);
        return false;
    }

    const buildType = target.buildType === 'release' ? 'Release' : 'Debug';
    const { build } = state.config.paths;
    const { libs, linkArgs } = linkInputs(target);
    const isStatic = target.platform === 'linuxmusl';

    const fingerprintFile = `${build}/${target.commandName}.fingerprint`;
    const fingerprint = getContentHash(JSON.stringify({
        builder: getFilesFingerprint([fileURLToPath(import.meta.url), ...PROJECT_FILES.map((file) => `${PROJECT_SOURCE}/${file}`)]),
        linkArgs,
        isStatic,
        libs: libs.map(statOf),
    }));
    const isLinkChanged = !fs.existsSync(fingerprintFile) || fs.readFileSync(fingerprintFile, 'utf8') !== fingerprint;
    if (!options.force && !isLinkChanged && fs.existsSync(`${build}/${target.commandName}`)) {
        logger.cachedStep(target, 'native command');
        return false;
    }

    const platformPrefix = `Native-${buildType}`;
    logger.startStep(target, 'native command');
    run(null, [
        'cmake', stageProject(build),
        `-DCMAKE_BUILD_TYPE=${buildType}`,
        `-DCROSSBIND_COMMAND_FILE=${target.commandName}`,
        `-DCROSSBIND_LINK_ARGS=${linkArgs.join(';')}`,
        `-DCROSSBIND_LINK_DEPENDS=${libs.join(';')}`,
        `-DCROSSBIND_STATIC=${isStatic ? 'ON' : 'OFF'}`,
    ], platformPrefix, target);
    run(null, ['cmake', '--build', '.', '-j', String(cpuCount)], platformPrefix, target);
    fs.copyFileSync(`${build}/${platformPrefix}/${target.path}/${target.commandName}`, `${build}/${target.commandName}`);
    logger.doneStep(target, 'native command');

    fs.writeFileSync(fingerprintFile, fingerprint);
    return true;
}
