import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import run from './run.js';
import state from '../state/index.js';
import { appId, appUpdater } from '../utils/appOptions.js';
import { configChangesOf } from '../utils/configChanges.js';

// The private key that signs a desktop app's updates, named by the environment alone so that no secret reaches a file.
export const UPDATER_KEY = 'CROSSBIND_UPDATER_PRIVATE_KEY';
// The fixed DER around an Ed25519 key's 32 bytes, private and public.
const PRIVATE_DER = Buffer.from('302e020100300506032b657004220420', 'hex');
const PUBLIC_DER = Buffer.from('302a300506032b6570032100', 'hex');

const publicKeyOf = (privateKey) => crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(PUBLIC_DER.length);

// A new key pair: the public key for app.updater.publicKey, the private one for CROSSBIND_UPDATER_PRIVATE_KEY.
export function newUpdaterKey() {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
        publicKey: publicKeyOf(privateKey).toString('base64'),
        privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PRIVATE_DER.length).toString('base64'),
    };
}

// The key a build signs updates with, or null without CROSSBIND_UPDATER_PRIVATE_KEY, or where a publish's changes to the
// config removed app.updater for its build. It has to be the private half of app.updater.publicKey, or the app would
// refuse what it signs.
export function updaterSigning(env = process.env) {
    if (!env[UPDATER_KEY]) return null;
    const updater = appUpdater(state.config);
    const changes = configChangesOf(env);
    if (!updater && changes && (changes.app === null || changes.app?.updater === null)) return null;
    if (!updater) throw new Error(`crossbind: ${UPDATER_KEY} is set, but crossbind.config.js has no app.updater, which tells an app where its updates are.`);
    const seed = Buffer.from(env[UPDATER_KEY], 'base64');
    if (seed.length !== 32) throw new Error(`crossbind: ${UPDATER_KEY} is no Ed25519 private key, which \`crossbind app updater-key\` prints.`);
    const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PRIVATE_DER, seed]), format: 'der', type: 'pkcs8' });
    if (!publicKeyOf(privateKey).equals(updater.publicKey)) {
        throw new Error(`crossbind: ${UPDATER_KEY} is not the private key of app.updater.publicKey, so the app would refuse the updates it signs.`);
    }
    return { privateKey, version: updater.version };
}

// What an update's signature covers: the app's id, the platform and arch it is for, its version and its file's SHA-512,
// so that no file passes for another app's, platform's or version's. The host checks the same text.
export function signedText(id, target, version, file) {
    const hash = crypto.createHash('sha512').update(fs.readFileSync(file)).digest('hex');
    return `crossbind update\n${id}\n${target}\n${version}\n${hash}\n`;
}

// The installer whose first file a Linux or Windows app updates itself from: an archive of the app's folder, which the
// host unpacks with tar, and a setup program, which it runs with /S /UPDATE /D=<the app's folder>.
export const UPDATE_INSTALLERS = { linux: 'tar-gz', win32: 'nsis' };

// The file a desktop app updates itself from, beside it: a macOS app as a zip, which keeps its signature and Apple's
// ticket, and a Linux or Windows app's of its installers.
function updateFile(app, target, installers) {
    const installer = UPDATE_INSTALLERS[target.platform];
    if (installer) {
        const file = installers.find(({ name }) => name === installer)?.files[0];
        if (!file) throw new Error(`crossbind: the ${installer} installer made no file of ${app} for its update.`);
        return file;
    }
    const zip = path.join(path.dirname(app), `${state.config.general.name}-darwin-${target.arch}.app.zip`);
    fs.rmSync(zip, { force: true });
    run(null, ['ditto', '-c', '-k', '--keepParent', app, zip], null, target);
    return zip;
}

// With a key in the environment, the update a desktop app finds at app.updater.url, beside the app: its file, and the
// manifest that gives its version, the file's name and its signature, <name>-<platform>-<arch>.update.json. It returns
// the two, or null without a key.
export default function writeUpdate(app, target, installers = []) {
    const signing = updaterSigning();
    if (!signing) return null;
    const file = updateFile(app, target, installers);
    const name = `${target.platform}-${target.arch}`;
    const signature = crypto.sign(null, Buffer.from(signedText(appId(state.config), name, signing.version, file)), signing.privateKey).toString('base64');
    const manifest = { version: signing.version, file: path.basename(file), signature };
    const written = path.join(path.dirname(app), `${state.config.general.name}-${name}.update.json`);
    fs.writeFileSync(written, `${JSON.stringify(manifest, null, 2)}\n`);
    return { manifest: written, file };
}
