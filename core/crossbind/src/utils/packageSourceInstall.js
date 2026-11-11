import fs from 'node:fs';
import upath from 'upath';
import withDirLock from './dirLock.js';
import logger from './logger.js';
import loadJson from './loadJson.js';
import writeIfChanged from './writeIfChanged.js';
import { getContentHash } from './hash.js';
import { getDockerImage, imageRoleFor } from './pullDockerImage.js';
import { extensionStep, isJsonValue, stepFailure } from './appExtensions.js';
import {
    assertRunsOnHost, assertRunsRemotely, clearSourceWork, createSourceProbe, createSourceWork, localCompilerIdentity,
    removeSourceWork, sourceRoot, sourceRunner, toHostPath,
} from './runPackageSource.js';
import packageSourceApi from './packageSourceApi.js';
import { TOOLCHAIN_PLATFORMS, targetToolchain } from './targetToolchain.js';
import {
    declaredSources, dependenciesKey, declarationOf, dependenciesOf,
} from './packageSources.js';
import {
    installedPackages, stagePackage, writeSourceManifest, readSourceManifest,
} from './packageSourceStage.js';
import { sourceStageDir } from './packageSourceImport.js';

// Bumped when the stage changes shape, so a stage an older crossbind made is made again.
const STAGE_FORMAT = 4;
const MAX_LOCK_LENGTH = 8 * 1024 * 1024;

const lockFileOf = (config, name) => upath.join(config.paths.project, `${name}.lock`);
const stampFileOf = (stageDir, target) => upath.join(stageDir, 'stamps', `${target.path}.json`);
const logFileOf = (stageDir, target) => upath.join(stageDir, 'logs', `${target.path}.log`);
const lockOf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
// A source gets a copy: what it does to one changes nothing of crossbind's.
const copyOf = (value) => JSON.parse(JSON.stringify(value));

// What crossbind builds the target with, which a source builds its packages to match.
function toolchainOf(name, target) {
    const toolchain = targetToolchain(target);
    if (toolchain) return toolchain;
    const names = TOOLCHAIN_PLATFORMS;
    throw new Error(`crossbind: ${name}: imports build for ${names.slice(0, -1).join(', ')} and ${names.at(-1)} so far; ${target.platform} is not supported yet, so its build cannot use ${declarationOf(name)}.`);
}

// What a source says its packages are made from beside what crossbind knows of.
function inputsOf(source, config, target, toolchain) {
    const { name, packageSource } = source;
    if (!packageSource.inputs) return null;
    const api = packageSourceApi({
        source, config, target, work: createSourceProbe(name, sourceRunner(config, target)),
    });
    let inputs;
    try {
        inputs = packageSource.inputs(api, { dependencies: copyOf(dependenciesOf(config, name)), toolchain: copyOf(toolchain) });
    } catch (error) {
        throw stepFailure(name, 'inputs', error);
    }
    if (!isJsonValue(inputs)) throw new Error(`crossbind: ${name}'s inputs gives no JSON value, whose change is what stages its packages again.`);
    return inputs;
}

// What a staged target was made from. The identity is the image, or the host's compiler where the tool runs on
// the host (RUNNER=LOCAL, and iOS and macOS always): packages build with that compiler, so a new one must restage.
function stampKey(source, config, target) {
    const { name } = source;
    const toolchain = toolchainOf(name, target);
    return getContentHash(JSON.stringify({
        format: STAGE_FORMAT,
        source: name,
        dependencies: dependenciesOf(config, name),
        toolchain,
        identity: sourceRunner(config, target) === 'LOCAL' ? localCompilerIdentity(target) : getDockerImage(imageRoleFor(target)),
        lock: lockOf(lockFileOf(config, name)),
        inputs: inputsOf(source, config, target, toolchain),
    }));
}

// The target's manifest names the dependencies it was staged for.
const isStaged = (source, config, stageDir, target) => loadJson(stampFileOf(stageDir, target))?.key === stampKey(source, config, target)
    && readSourceManifest(source.name, stageDir, dependenciesKey(dependenciesOf(config, source.name)), target.path) !== null;

// The lock comes back from where the recipes ran, and every later build reads it again. The source says whether
// it is a lock; crossbind takes text alone, of no more than a lock gets.
function writeLock(name, file, lock) {
    if (lock === null || lock === undefined) return;
    if (typeof lock !== 'string' || lock.length > MAX_LOCK_LENGTH || lock.includes('\0')) {
        throw new Error(`crossbind: ${name}'s install gives no lock crossbind can keep, which is text of 8 MiB at most, so ${name}.lock is left as it was.`);
    }
    writeIfChanged(file, lock);
}

async function installTarget(source, config, stageDir, target) {
    const { name, packageSource } = source;
    const dependencies = dependenciesOf(config, name);
    const lockFile = lockFileOf(config, name);
    const stampFile = stampFileOf(stageDir, target);
    const logFile = logFileOf(stageDir, target);
    const runner = sourceRunner(config, target);
    const toolchain = toolchainOf(name, target);
    if (runner === 'LOCAL') assertRunsOnHost(name, target);
    if (runner === 'REMOTE') assertRunsRemotely(source);
    // A restage that stops halfway must not pass for a finished one.
    fs.rmSync(stampFile, { force: true });
    const work = createSourceWork(name, runner);
    const label = `${name} ${target.path}`;
    logger.startTask(label);
    try {
        const api = packageSourceApi({
            source, config, target, work, logFile,
        });
        const installed = await extensionStep(name, 'install', () => packageSource.install(api, {
            dependencies: copyOf(dependencies), toolchain: copyOf(toolchain), lock: lockOf(lockFile),
        }));
        const packages = installedPackages(name, installed?.packages);
        const distCmake = fs.readFileSync(upath.join(config.paths.cli, 'assets', 'cmake', 'dist.cmake'), 'utf8');
        packages.forEach((pkg) => stagePackage(name, pkg, {
            stageDir, targetPath: target.path, toHost: (reported) => toHostPath(reported, work), store: work.store, distCmake,
        }));
        writeSourceManifest(stageDir, target.path, {
            key: dependenciesKey(dependencies),
            packages: packages.map(({
                packageFolder, includedirs, libdirs, ...entry
            }) => entry),
        });
        writeLock(name, lockFile, installed.lock);
        writeIfChanged(stampFile, `${JSON.stringify({ key: stampKey(source, config, target) })}\n`);
        logger.doneTask(label, packages.map((pkg) => `${pkg.name} ${pkg.version}`).join(', '));
    } finally {
        // Not over the error that ended the run; the next install clears what is left.
        try {
            removeSourceWork(work);
        } catch (e) {
            logger.info(`crossbind: could not remove ${work.dir} (${e.message}).`);
        }
    }
}

async function installSource(source, config, targets) {
    const { name } = source;
    const stageDir = sourceStageDir(config.paths.cache, name);
    const pending = targets.filter((target) => !isStaged(source, config, stageDir, target));
    if (pending.length === 0) return false;
    for (const runner of new Set(pending.map((target) => sourceRunner(config, target)))) {
        // A store takes one writer at a time, and every project on the machine shares it.
        await withDirLock(`${sourceRoot(name, runner)}-install.lock`, async () => {
            clearSourceWork(name, runner);
            for (const target of pending.filter((candidate) => sourceRunner(config, candidate) === runner)) {
                // Another build may have staged it while this one waited for the store.
                if (!isStaged(source, config, stageDir, target)) await installTarget(source, config, stageDir, target);
            }
        });
    }
    return true;
}

// Installs the packages a project declares of each source for every target not staged from the same inputs
// yet, and says whether it staged any, so the caller attaches the new manifests.
export default async function installPackageSources(config, targets) {
    let hasStaged = false;
    for (const source of declaredSources(config)) {
        hasStaged = await installSource(source, config, targets) || hasStaged;
    }
    return hasStaged;
}
