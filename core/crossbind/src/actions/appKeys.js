import path from 'node:path';
import extensionApi from './extensionApi.js';
import { SIGNING } from './androidGradle.js';
import { extensionStep } from '../utils/appExtensions.js';
import { readSecret } from '../utils/keychain.js';
import loadSystemConfig from '../utils/systemConfig.js';

const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]);

// Where the password of this machine's upload key is.
function passwordPlace(env, keystore) {
    if (env[SIGNING.password]) return `${SIGNING.password} holds its password`;
    return readSecret(path.resolve(keystore)) ? 'its password in the keychain' : 'its password asked for at each build';
}

// Where this machine's upload key is, as crossbind app key says it: the keystore the environment names, else the one
// this machine's settings keep, with its alias and where its password is.
export function uploadKeyLine(env = process.env, system = loadSystemConfig()) {
    if (env[SIGNING.keystore]) return `${SIGNING.keystore} names ${env[SIGNING.keystore]}, with its alias and password in the environment`;
    if (!system.ANDROID_KEYSTORE) return 'none on this machine; crossbind app key upload makes one, or takes yours with --use';
    return `${system.ANDROID_KEYSTORE}, alias ${env[SIGNING.alias] || system.ANDROID_KEY_ALIAS || 'upload'}, ${passwordPlace(env, system.ANDROID_KEYSTORE)}`;
}

// Says which keys sign the app and where each is kept: this machine's upload key, and each key an extension adds, as
// its state tells, else that crossbind app key <name> makes it. A key named that none makes stops it, naming those that
// are.
export default async function appKeys(name, keys = []) {
    if (name !== undefined) throw new Error(`crossbind: crossbind app key makes ${listed(['upload', ...keys.map((key) => key.name)])}, not ${name}.`);
    console.log(`upload: ${uploadKeyLine()}`);
    for (const { extension, name: kind, key } of keys) {
        const lines = key.state
            ? await extensionStep(extension, `key ${kind}'s state`, () => key.state(extensionApi(extension, { platform: null, isGuided: false })))
            : [`crossbind app key ${kind} makes it`];
        lines.forEach((line) => console.log(`${kind}: ${line}`));
    }
}
