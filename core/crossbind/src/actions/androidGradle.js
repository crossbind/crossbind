import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import state from '../state/index.js';
import getOsUserAndGroupId from '../utils/getOsUserAndGroupId.js';
import pullDockerImage, { getDockerImage } from '../utils/pullDockerImage.js';
import { DOCKER_BASE, isUnderBase } from '../utils/replaceBasePathForDocker.js';
import { DOCKER_RUN_SECURITY_ARGS } from '../utils/dockerSecurity.js';
import { getContentHash } from '../utils/hash.js';
import { readSecret } from '../utils/keychain.js';
import { secretFile } from '../utils/secretFile.js';

const ROLE = 'android-app';
const PLATFORM = 'linux/amd64';
const KEYSTORE = '/tmp/crossbind/keystore';
const GRADLE = ['gradle', '--offline', '--no-watch-fs', '--console=plain', '-q'];
const OUTPUT_LIMIT = 64 * 1024 * 1024;
const FAILURE_LINES = 40;

// The upload key a release is signed with, named by the environment alone so that no secret reaches a file.
export const SIGNING = {
    keystore: 'CROSSBIND_ANDROID_KEYSTORE',
    alias: 'CROSSBIND_ANDROID_KEY_ALIAS',
    password: 'CROSSBIND_ANDROID_KEYSTORE_PASSWORD',
    keyPassword: 'CROSSBIND_ANDROID_KEY_PASSWORD',
};

const listed = (names) => `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'}`;
// A keystore's base64 text, as CI's secrets give it, in place of its file's path: no path runs to a hundred of base64's
// letters alone.
const KEYSTORE_TEXT = /^[A-Za-z0-9+/=\s]{100,}$/;

// The keystore of the upload key, or null for none: a release is then signed with the debug key. The keystore is its
// file, or its base64 text, which goes to a file for the image to mount.
export function releaseSigning(env = process.env) {
    if (!env[SIGNING.keystore]) {
        const stray = [SIGNING.alias, SIGNING.password, SIGNING.keyPassword].filter((name) => env[name]);
        if (stray.length) throw new Error(`crossbind: ${listed(stray)} set without ${SIGNING.keystore}, the keystore of the upload key.`);
        return null;
    }
    const missing = [SIGNING.alias, SIGNING.password].filter((name) => !env[name]);
    if (missing.length) throw new Error(`crossbind: ${SIGNING.keystore} is set, but ${listed(missing)} not.`);
    const given = env[SIGNING.keystore];
    const isText = !fs.existsSync(given) && KEYSTORE_TEXT.test(given);
    const file = isText ? secretFile('upload.keystore', Buffer.from(given.replace(/\s/g, ''), 'base64')) : path.resolve(given);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`crossbind: ${SIGNING.keystore} names ${file}, which is no file.`);
    return { file, names: [SIGNING.alias, SIGNING.password, SIGNING.keyPassword].filter((name) => env[name]) };
}

// This machine's upload key, which ~/.crossbind.json names, for a build whose environment names none: its file and alias,
// and its password from the environment, else the keychain, else none yet.
export function machineUploadKey(env = process.env, system = state.config.system ?? {}) {
    if (env[SIGNING.keystore] || !system.ANDROID_KEYSTORE) return null;
    return {
        keystore: system.ANDROID_KEYSTORE,
        alias: env[SIGNING.alias] || system.ANDROID_KEY_ALIAS || 'upload',
        password: env[SIGNING.password] || readSecret(path.resolve(system.ANDROID_KEYSTORE)),
    };
}

// The environment a build signs with this machine's upload key in.
export function uploadKeyEnv({ keystore, alias, password }) {
    if (!password) {
        throw new Error(`crossbind: this machine's upload key, ${keystore}, needs its password: set ${SIGNING.password}, or build on a terminal, which asks for it.`);
    }
    return { [SIGNING.keystore]: keystore, [SIGNING.alias]: alias, [SIGNING.password]: password };
}

// Gradle's caches and the Android tools' home outlive a container; the second keeps the debug key, which a new one would
// replace, so that a later build still installs over the last.
function homes() {
    const root = path.join(os.homedir(), '.crossbind', 'android');
    return [[path.join(root, 'gradle'), '/var/cache/crossbind/gradle'], [path.join(root, 'home'), '/var/cache/crossbind/android']];
}

// A container of crossbind's android-app image, with no network: the project under the build's base, the homes, and
// the keystore read-only, its passwords passed by name from this environment.
function containerArgs(signing) {
    return [
        ...DOCKER_RUN_SECURITY_ARGS, '--network', 'none', '--platform', PLATFORM, '--user', getOsUserAndGroupId(),
        '-v', `${state.config.paths.base}:${DOCKER_BASE}`,
        ...homes().flatMap(([host, container]) => {
            fs.mkdirSync(host, { recursive: true });
            return ['-v', `${host}:${container}`];
        }),
        ...(signing ? ['-v', `${signing.file}:${KEYSTORE}:ro`, '-e', `${SIGNING.keystore}=${KEYSTORE}`, ...signing.names.flatMap((name) => ['-e', name])] : []),
    ];
}

function docker(args, what, env = process.env) {
    const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: OUTPUT_LIMIT, env });
    if (result.error) throw new Error(`crossbind: cannot run docker for ${what}: ${result.error.message}`, { cause: result.error });
    if (result.status !== 0) {
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-FAILURE_LINES).join('\n');
        throw new Error(`crossbind: ${what} failed in the android-app image with exit code ${result.status}:\n${output}`);
    }
}

// The container sees the project's base alone, under its own POSIX path whatever the host's separators.
function inContainer(project) {
    const dir = path.resolve(project);
    if (!isUnderBase(dir, state.config.paths.base)) {
        throw new Error(`crossbind: the Android project ${dir} is outside ${state.config.paths.base}, the project's base and all the android-app container sees. Build the app into a directory under it.`);
    }
    return path.posix.join(DOCKER_BASE, ...path.relative(state.config.paths.base, dir).split(path.sep));
}

// An Android app as the files it ships: its release APK, and with an upload key, the environment's or this machine's,
// also the bundle Google Play takes, beside the Gradle project as <project>.apk and <project>.aab.
export function packageAndroidRelease(project) {
    const key = machineUploadKey();
    const env = key ? { ...process.env, ...uploadKeyEnv(key) } : process.env;
    const signing = releaseSigning(env);
    pullDockerImage(ROLE, PLATFORM);
    docker(['run', '--rm', ...containerArgs(signing), '-w', inContainer(project), getDockerImage(ROLE, PLATFORM),
        ...GRADLE, '--no-daemon', 'assembleRelease', ...(signing ? ['bundleRelease'] : [])], `packaging ${path.basename(project)}`, env);
    const outputs = `${project}/app/build/outputs`;
    fs.copyFileSync(`${outputs}/apk/release/app-release.apk`, `${project}.apk`);
    fs.rmSync(`${project}.aab`, { force: true });
    // The zip of native debug symbols Google Play takes, each ABI's libraries at its root, which the image's JDK makes.
    fs.rmSync(`${project}-symbols.zip`, { force: true });
    if (fs.existsSync(`${project}/symbols`)) {
        docker(['run', '--rm', ...containerArgs(null), '-w', inContainer(project), getDockerImage(ROLE, PLATFORM),
            'jar', '--create', '--no-manifest', '--file', `../${path.basename(project)}-symbols.zip`, '-C', 'symbols', '.'], `zipping the symbols of ${path.basename(project)}`);
    }
    if (signing) {
        fs.copyFileSync(`${outputs}/bundle/release/app-release.aab`, `${project}.aab`);
    } else {
        console.warn(`crossbind: ${path.basename(project)}.apk is signed with this machine's debug key: it installs for testing, and Google Play takes no app signed so. crossbind app upload-key makes an upload key, which signs it and makes the bundle too; or set ${SIGNING.keystore}, ${SIGNING.alias} and ${SIGNING.password} to sign it with yours.`);
    }
}

// During development one container per project, whose Gradle daemon stays warm from one build to the next; it goes with
// the process.
let devContainer = null;

function startDevContainer() {
    const name = `crossbind-android-app-${getContentHash(state.config.paths.project).slice(0, 12)}`;
    pullDockerImage(ROLE, PLATFORM);
    // One a crashed session left behind holds the name.
    spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
    docker(['run', '--detach', '--rm', '--init', '--name', name, ...containerArgs(null), getDockerImage(ROLE, PLATFORM), 'sleep', 'infinity'],
        'starting the development container');
    process.once('exit', () => spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' }));
    // A closed terminal ends the session through its exit hooks, as Ctrl-C does.
    process.once('SIGHUP', () => process.exit(129));
    return name;
}

// Builds an Android app's Gradle project as a debug APK, signed with the debug key the homes keep, and returns the APK.
export function buildApk(project) {
    devContainer ??= startDevContainer();
    docker(['exec', '-w', inContainer(project), devContainer, ...GRADLE, 'assembleDebug'], `building ${path.basename(project)}`);
    return path.join(project, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
}
