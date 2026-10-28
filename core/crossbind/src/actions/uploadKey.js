import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SIGNING } from './androidGradle.js';
import pullDockerImage, { getDockerImage } from '../utils/pullDockerImage.js';
import { DOCKER_RUN_SECURITY_ARGS } from '../utils/dockerSecurity.js';
import getOsUserAndGroupId from '../utils/getOsUserAndGroupId.js';
import loadSystemConfig, { updateSystemConfig } from '../utils/systemConfig.js';
import { hasKeychain, readSecret, storeSecret } from '../utils/keychain.js';
import { PASSWORD_RULES, makePassword, passwordProblem } from '../utils/password.js';
import { askHidden, askLine, hasTerminal } from '../utils/ask.js';

const ROLE = 'android-app';
const PLATFORM = 'linux/amd64';
const ALIAS = 'upload';
// Nobody sees an upload key's name: an app installed from Google Play carries Google's signature.
const NAME = 'CN=Android upload key';
// Google Play wants a key valid past 2033; 10,000 days is 27 years.
const VALIDITY_DAYS = 10000;

// Where `crossbind app upload-key` makes this machine's upload key.
export const uploadKeyFile = () => path.join(os.homedir(), '.crossbind', 'keys', 'android-upload.p12');

// keytool in crossbind's android-app image, which an Android app's build pulls anyway: with no network, the key's folder
// alone, and the password by name in the environment, never on a command line.
function keytool(keystore, command, args, password, { isReadOnly = false } = {}) {
    pullDockerImage(ROLE, PLATFORM);
    const result = spawnSync('docker', [
        'run', '--rm', ...DOCKER_RUN_SECURITY_ARGS, '--network', 'none', '--platform', PLATFORM, '--user', getOsUserAndGroupId(),
        '-v', `${path.dirname(keystore)}:/keys${isReadOnly ? ':ro' : ''}`, '-e', SIGNING.password, getDockerImage(ROLE, PLATFORM),
        'keytool', command, '-keystore', `/keys/${path.basename(keystore)}`, ...args, '-storepass:env', SIGNING.password,
    ], { encoding: 'utf8', env: { ...process.env, [SIGNING.password]: password } });
    if (result.error) throw new Error(`crossbind: cannot run keytool in the ${ROLE} image: ${result.error.message}`, { cause: result.error });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

// The password the user types for a new key, held to the rules and typed twice the same.
async function typedPassword() {
    console.error(`The upload key's password needs:\n${PASSWORD_RULES.map((rule) => `  - ${rule}`).join('\n')}`);
    for (;;) {
        const password = await askHidden('Password: ');
        const problem = passwordProblem(password);
        if (problem) {
            console.error(`That one will not do: ${problem}.`);
        } else if (await askHidden('Again: ') === password) {
            return password;
        } else {
            console.error('The two did not match.');
        }
    }
}

// A new key's password: the environment's, else one crossbind makes or one the user types. Only a keychain keeps a made
// one, so without a keychain the user types their own.
async function newPassword(canKeep) {
    const given = process.env[SIGNING.password];
    if (given) {
        const problem = passwordProblem(given);
        if (problem) throw new Error(`crossbind: ${SIGNING.password} cannot lock an upload key: ${problem}.`);
        return { password: given, isMade: false };
    }
    if (!hasTerminal()) throw new Error(`crossbind: an upload key needs a password: run this on a terminal, which asks for one, or set ${SIGNING.password}.`);
    const choice = canKeep
        ? await askLine("The upload key's password:\n  1) make a strong one for me (recommended)\n  2) I will type my own\nChoose 1 or 2 [1]: ")
        : '2';
    if (choice.trim() !== '2') return { password: makePassword(), isMade: true };
    return { password: await typedPassword(), isMade: false };
}

// Makes a key this machine's upload key, its password kept in the system keychain where it can be.
function keep(keystore, alias, password, isKeychain) {
    const isKept = isKeychain && storeSecret(keystore, password);
    updateSystemConfig({ ANDROID_KEYSTORE: keystore, ANDROID_KEY_ALIAS: alias });
    console.log(isKept
        ? 'crossbind: the system keychain keeps its password, so builds sign without asking.'
        : `crossbind: builds ask for its password, as no keychain keeps it; set ${SIGNING.password} where no one can type it, as in CI.`);
}

// Makes this machine's upload key, which signs its Android apps' bundles for Google Play. It never makes one over a key
// the machine has.
export async function makeUploadKey({ isKeychain = true } = {}) {
    const system = loadSystemConfig();
    if (system.ANDROID_KEYSTORE) {
        throw new Error(`crossbind: this machine's upload key is ${system.ANDROID_KEYSTORE}, and crossbind never makes another over it, as Google Play takes an app's updates only signed with the key it knows. To make a new one anyway, drop it first with crossbind config delete ANDROID_KEYSTORE.`);
    }
    const file = uploadKeyFile();
    if (fs.existsSync(file)) {
        throw new Error(`crossbind: ${file} is there already, and crossbind never replaces an upload key: use it with crossbind app upload-key --use ${file}.`);
    }
    const canKeep = isKeychain && hasKeychain();
    const { password, isMade } = await newPassword(canKeep);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const made = keytool(file, '-genkeypair', ['-storetype', 'PKCS12', '-alias', ALIAS, '-keyalg', 'RSA', '-keysize', '2048',
        '-validity', String(VALIDITY_DAYS), '-dname', NAME], password);
    if (made.status !== 0) throw new Error(`crossbind: keytool did not make the upload key:\n${made.output}`);
    fs.chmodSync(file, 0o600);
    console.log(`crossbind: your upload key is ${file}.`);
    if (isMade) console.log(`crossbind: its password, shown this once: ${password}`);
    keep(file, ALIAS, password, canKeep);
    console.log(`crossbind: keep a copy of ${file} and of its password somewhere safe, as a password manager. Google keeps only the key's certificate: a lost key takes an upload key reset in Play Console, which takes effect 72 hours later.`);
}

// Makes a key the user has this machine's upload key, once it opens with its password and alias.
export async function useUploadKey(file, { alias = ALIAS, isKeychain = true } = {}) {
    const keystore = path.resolve(file);
    if (!fs.statSync(keystore, { throwIfNoEntry: false })?.isFile()) throw new Error(`crossbind: ${keystore} is no file.`);
    const password = process.env[SIGNING.password] || (hasTerminal() ? await askHidden(`Password of ${keystore}: `) : '');
    if (!password) throw new Error(`crossbind: ${keystore} needs its password: run this on a terminal, which asks for it, or set ${SIGNING.password}.`);
    const opened = keytool(keystore, '-list', ['-alias', alias], password, { isReadOnly: true });
    if (opened.status !== 0) throw new Error(`crossbind: ${keystore} did not open with that password and the alias ${alias}:\n${opened.output}`);
    console.log(`crossbind: this machine's upload key is ${keystore}, alias ${alias}.`);
    keep(keystore, alias, password, isKeychain);
}

// The password the keychain keeps for this machine's upload key, for another machine or CI.
export function showUploadKeyPassword() {
    const { ANDROID_KEYSTORE: keystore } = loadSystemConfig();
    if (!keystore) throw new Error('crossbind: this machine has no upload key: crossbind app upload-key makes one.');
    const password = readSecret(keystore);
    if (!password) throw new Error(`crossbind: no keychain keeps the password of ${keystore}.`);
    console.log(password);
}
