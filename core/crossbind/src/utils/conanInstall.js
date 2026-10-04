import fs from 'node:fs';
import upath from 'upath';
import withDirLock from './dirLock.js';
import logger from './logger.js';
import loadJson from './loadJson.js';
import writeIfChanged from './writeIfChanged.js';
import { getContentHash } from './hash.js';
import { getDockerImage, imageRoleFor } from './pullDockerImage.js';
import runConan, {
    clearConanWork, conanRoot, conanRunner, createConanWork, localToolchainIdentity, removeConanWork, toHostPath,
} from './runConan.js';
import { hostProfile, settingsUser, BUILD_PROFILE } from './conanProfile.js';
import { conanRequires, conanOptionArgs, conanDependenciesKey } from './conanDependencies.js';
import {
    conanPackagesOf, stageConanPackage, writeConanManifest, readConanManifest, isControlCharacter,
} from './conanStage.js';
import { conanStageDir } from './conanImport.js';

// Bumped when the stage changes shape, so a stage an older crossbind made is made again.
const CONAN_STAGE_FORMAT = 3;
// Enough of a failed build's log to reach the error conan ends it with.
const LOG_TAIL_LINES = 60;

const lockFileOf = (config) => upath.join(config.paths.project, 'conan.lock');
const stampFileOf = (stageDir, target) => upath.join(stageDir, 'stamps', `${target.path}.json`);
const logFileOf = (stageDir, target) => upath.join(stageDir, 'logs', `${target.path}.log`);
const printable = (text) => [...text].filter((char) => char === '\n' || char === '\t' || !isControlCharacter(char)).join('');

// What a staged target was made from. The toolchain is the image, or the host's compiler and conan where
// conan runs on the host (RUNNER=LOCAL, and iOS always): the profile asks that compiler for its version,
// so a new one is a new package id and must restage.
function stampKey(config, target) {
    const lock = lockFileOf(config);
    return getContentHash(JSON.stringify({
        format: CONAN_STAGE_FORMAT,
        dependencies: config.conanDependencies,
        host: hostProfile(target),
        build: BUILD_PROFILE,
        toolchain: conanRunner(config, target) === 'LOCAL' ? localToolchainIdentity(target) : getDockerImage(imageRoleFor(target)),
        lock: fs.existsSync(lock) ? fs.readFileSync(lock, 'utf8') : null,
    }));
}

// The target's manifest names the dependencies it was staged for.
const isStaged = (config, stageDir, target) => loadJson(stampFileOf(stageDir, target))?.key === stampKey(config, target)
    && readConanManifest(stageDir, conanDependenciesKey(config.conanDependencies), target.path) !== null;

function conanFailure(target, result, logFile) {
    if (result.error && result.error.code !== 'ENOBUFS') {
        return new Error(`crossbind: could not run conan for ${target.path} (${result.error.message}).`);
    }
    let ending = `failed (exit code ${result.status})`;
    if (result.error) ending = 'was stopped: it printed more than crossbind reads';
    else if (result.signal) ending = `was stopped by ${result.signal}`;
    const tail = printable(`${result.stderr ?? ''}`).trim().split('\n').slice(-LOG_TAIL_LINES).join('\n');
    return new Error(`crossbind: conan install for ${target.path} ${ending}. Its whole log is in ${logFile}.\n${tail}`);
}

// The parsed file, or null. The parse error is left out: it quotes the text, which recipes can write.
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

// The lockfile comes back from where the recipes ran, so only a lockfile goes into the project.
function lockfileText(file) {
    const lock = readJson(file);
    if (typeof lock?.version !== 'string') {
        throw new Error('crossbind: conan wrote no lockfile crossbind can read, so conan.lock is left as it was.');
    }
    return `${JSON.stringify(lock, null, 4)}\n`;
}

function installTarget(config, stageDir, target) {
    const dependencies = config.conanDependencies;
    const lock = lockFileOf(config);
    const hasLock = fs.existsSync(lock);
    const stampFile = stampFileOf(stageDir, target);
    const logFile = logFileOf(stageDir, target);
    // A restage that stops halfway must not pass for a finished one.
    fs.rmSync(stampFile, { force: true });
    const work = createConanWork(conanRunner(config, target));
    const label = `conan ${target.path}`;
    logger.startTask(label);
    try {
        fs.writeFileSync(upath.join(work.dir, 'host.profile'), hostProfile(target));
        fs.writeFileSync(upath.join(work.dir, 'build.profile'), BUILD_PROFILE);
        const settings = settingsUser(target);
        if (settings) fs.writeFileSync(upath.join(work.dir, 'home', 'settings_user.yml'), settings);
        if (hasLock) fs.copyFileSync(lock, upath.join(work.dir, 'input.lock'));
        const result = runConan([
            'install',
            ...conanRequires(dependencies).flatMap((reference) => ['--requires', reference]),
            ...conanOptionArgs(dependencies),
            '-pr:h', work.conanPath('host.profile'),
            '-pr:b', work.conanPath('build.profile'),
            '--output-folder', work.conanPath('output'),
            '--build=missing',
            '--format=json',
            // A file, since a build tool writing to stdout would end up inside the JSON.
            '--out-file', work.conanPath('graph.json'),
            // Unless told which lockfile to use, conan takes any conan.lock in its working directory.
            ...(hasLock ? ['--lockfile', work.conanPath('input.lock'), '--lockfile-partial'] : ['--lockfile=']),
            '--lockfile-out', work.conanPath('resolution.lock'),
        ], { config, target, work });
        writeIfChanged(logFile, `${result.stderr ?? ''}`);
        if (result.error || result.status !== 0) throw conanFailure(target, result, logFile);

        const graph = readJson(upath.join(work.dir, 'graph.json'))?.graph;
        if (!graph) throw new Error(`crossbind: conan install wrote no graph crossbind can read. Its log is in ${logFile}.`);
        const packages = conanPackagesOf(graph);
        const distCmake = fs.readFileSync(upath.join(config.paths.cli, 'assets', 'cmake', 'dist.cmake'), 'utf8');
        packages.forEach((pkg) => stageConanPackage(pkg, {
            stageDir, targetPath: target.path, toHost: (reported) => toHostPath(reported, work), store: work.store, distCmake,
        }));
        writeConanManifest(stageDir, target.path, {
            key: conanDependenciesKey(dependencies),
            packages: packages.map(({
                packageFolder, includedirs, libdirs, ...entry
            }) => entry),
        });
        writeIfChanged(lock, lockfileText(upath.join(work.dir, 'resolution.lock')));
        writeIfChanged(stampFile, `${JSON.stringify({ key: stampKey(config, target) })}\n`);
        logger.doneTask(label, packages.map((pkg) => `${pkg.name} ${pkg.version}`).join(', '));
    } finally {
        // Not over the error that ended the run; the next install clears what is left.
        try {
            removeConanWork(work);
        } catch (e) {
            logger.info(`crossbind: could not remove ${work.dir} (${e.message}).`);
        }
    }
}

// Installs the declared Conan packages for every target not staged from the same inputs yet, and
// says whether it staged any, so the caller attaches the new manifest.
export default async function installConanPackages(config, targets) {
    if (Object.keys(config.conanDependencies ?? {}).length === 0) return false;
    const stageDir = conanStageDir(config.paths.cache);
    const pending = targets.filter((target) => !isStaged(config, stageDir, target));
    if (pending.length === 0) return false;
    for (const runner of new Set(pending.map((target) => conanRunner(config, target)))) {
        // A conan store takes one writer at a time, and every project on the machine shares it.
        await withDirLock(`${conanRoot(runner)}-install.lock`, async () => {
            clearConanWork(runner);
            pending.filter((target) => conanRunner(config, target) === runner && !isStaged(config, stageDir, target))
                .forEach((target) => installTarget(config, stageDir, target));
        });
    }
    return true;
}
