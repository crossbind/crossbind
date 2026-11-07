import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import state from '../state/index.js';
import getOsUserAndGroupId from '../utils/getOsUserAndGroupId.js';
import pullDockerImage, { getDockerImage } from '../utils/pullDockerImage.js';
import replaceBasePathForDocker, { DOCKER_BASE } from '../utils/replaceBasePathForDocker.js';
import { DOCKER_RUN_SECURITY_ARGS } from '../utils/dockerSecurity.js';
import resolveAppHostRoot from '../utils/resolveAppHost.js';

// The key that signs a Windows app and its setup program, named by the environment alone so that no secret reaches a
// file or a command line: jsign's own options, which the windows image's jsign takes through the host's jsign.sh.
export const WINDOWS_SIGNING = {
    storetype: 'CROSSBIND_WINDOWS_SIGNING_STORETYPE',
    keystore: 'CROSSBIND_WINDOWS_SIGNING_KEYSTORE',
    alias: 'CROSSBIND_WINDOWS_SIGNING_ALIAS',
    storepass: 'CROSSBIND_WINDOWS_SIGNING_STOREPASS',
    keypass: 'CROSSBIND_WINDOWS_SIGNING_KEYPASS',
    certfile: 'CROSSBIND_WINDOWS_SIGNING_CERTFILE',
    tsaurl: 'CROSSBIND_WINDOWS_SIGNING_TSAURL',
};
// The store types of the image's jsign 7.6: files, which the container reads mounted, cloud key services, and hardware
// tokens, which it does not reach.
const FILE_STORES = ['PKCS12', 'JKS', 'JCEKS'];
const CLOUDS = ['AWS', 'AZUREKEYVAULT', 'DIGICERTONE', 'ESIGNER', 'GARASIGN', 'GOOGLECLOUD', 'HASHICORPVAULT', 'ORACLECLOUD', 'SIGNPATH', 'SIGNSERVER', 'TRUSTEDSIGNING'];
const TOKENS = ['PKCS11', 'CRYPTOCERTUM', 'ETOKEN', 'NITROKEY', 'OPENPGP', 'OPENSC', 'PIV', 'YUBIKEY'];
// Where the container reads the files the variables name.
const FILES = '/run/crossbind/signing';
const OUTPUT_LIMIT = 64 * 1024 * 1024;
const FAILURE_LINES = 40;

const listed = (names) => `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'}`;

function existingFile(name, env) {
    const file = path.resolve(env[name] ?? '');
    if (!env[name] || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`crossbind: ${name} names ${env[name] ? file : 'nothing'}, which is no file.`);
    }
    return file;
}

// The key a Windows app is signed with, or null without CROSSBIND_WINDOWS_SIGNING_STORETYPE: the app and its setup
// program are then not signed.
export function windowsSigning(env = process.env) {
    const set = Object.values(WINDOWS_SIGNING).filter((name) => env[name]);
    const storetype = env[WINDOWS_SIGNING.storetype]?.toUpperCase();
    if (!storetype) {
        if (set.length) throw new Error(`crossbind: ${listed(set)} set without ${WINDOWS_SIGNING.storetype}, the kind of key jsign signs a Windows app with.`);
        return null;
    }
    if (TOKENS.includes(storetype)) {
        throw new Error(`crossbind: ${WINDOWS_SIGNING.storetype} ${storetype} is a hardware token, which crossbind's windows container does not reach. Sign with a cloud's key service, as Azure Artifact Signing (TRUSTEDSIGNING) or Azure Key Vault (AZUREKEYVAULT), or with a PKCS#12 file.`);
    }
    if (![...FILE_STORES, ...CLOUDS].includes(storetype)) {
        throw new Error(`crossbind: ${WINDOWS_SIGNING.storetype} ${storetype} is no store type jsign takes: ${[...FILE_STORES, ...CLOUDS].join(', ')}.`);
    }
    const files = {};
    if (FILE_STORES.includes(storetype)) files.keystore = existingFile(WINDOWS_SIGNING.keystore, env);
    if (env[WINDOWS_SIGNING.certfile]) files.certfile = existingFile(WINDOWS_SIGNING.certfile, env);
    return { names: set, files };
}

// A command in crossbind's windows image, which sees the project's base, with the signing key's files mounted
// read-only under their own names and its other variables passed by name, so that their values stay off the command
// line. A failure names the tool it was, as the label.
export function inWindowsImage(command, workdir, signing = null, label = command[0]) {
    const { base } = state.config.paths;
    pullDockerImage('windows');
    const files = Object.entries(signing?.files ?? {});
    const mounted = files.map(([key]) => WINDOWS_SIGNING[key]);
    const args = [
        'run', '--rm', ...DOCKER_RUN_SECURITY_ARGS, '--user', getOsUserAndGroupId(), '-v', `${base}:${DOCKER_BASE}`,
        ...files.flatMap(([key, file]) => ['-v', `${file}:${FILES}/${key}:ro`, '-e', `${WINDOWS_SIGNING[key]}=${FILES}/${key}`]),
        ...(signing?.names ?? []).filter((name) => !mounted.includes(name)).flatMap((name) => ['-e', name]),
        // makensis reads its arguments in the locale's encoding, which the image leaves unset.
        '-e', 'LC_ALL=C.UTF-8',
        '-w', replaceBasePathForDocker(workdir, base),
        getDockerImage('windows'),
        ...replaceBasePathForDocker(command, base),
    ];
    const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: OUTPUT_LIMIT });
    if (result.error) throw new Error(`crossbind: cannot run docker for ${label}: ${result.error.message}`, { cause: result.error });
    if (result.status !== 0) {
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-FAILURE_LINES).join('\n');
        const end = result.signal ? `on ${result.signal}` : `with exit code ${result.status}`;
        throw new Error(`crossbind: ${label} failed in the windows image ${end}:\n${output}`);
    }
}

// The script the windows image signs a file with, which a setup program's build runs too.
export const jsignScript = () => `${resolveAppHostRoot()}/windows/jsign.sh`;

// Signs Windows executables in place with the key the environment names.
export function signWindows(files, signing) {
    inWindowsImage(['sh', jsignScript(), ...files], path.dirname(files[0]), signing, 'jsign');
}
