import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// The private key that signs a desktop app's updates, named by the environment alone so that no secret reaches a file.
export const UPDATER_KEY = 'CROSSBIND_UPDATER_PRIVATE_KEY';
// The fixed DER around an Ed25519 key's 32 bytes, private and public.
const PRIVATE_DER = Buffer.from('302e020100300506032b657004220420', 'hex');
const PUBLIC_DER = Buffer.from('302a300506032b6570032100', 'hex');
// The names an update goes by, of the platforms as the host knows them.
const HOST_PLATFORMS = { macos: 'darwin', linux: 'linux', windows: 'win32' };
// The installer whose first file a Linux or Windows app updates itself from: an archive of the app's folder, which the
// host unpacks with tar, and a setup program, which it runs with /S /UPDATE /D=<the app's folder>.
const UPDATE_INSTALLERS = { linux: 'tar-gz', windows: 'nsis' };
const PLATFORM_NAMES = { linux: 'Linux', windows: 'Windows' };

// Semver's version: three numbers, then a prerelease and build metadata of dot-separated identifiers.
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
// What an update's files are named after: characters an address carries as they are, and no leading dot.
const UPDATE_NAME = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
// The Ed25519 public keys of the points of small order, whatever the sign of x, whose signatures anyone can forge: the
// list libsodium's ge25519_has_small_order checks.
const SMALL_ORDER_KEYS = [
    '0000000000000000000000000000000000000000000000000000000000000000',
    '0100000000000000000000000000000000000000000000000000000000000000',
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
    'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
].map((hex) => Buffer.from(hex, 'hex'));

const isSmallOrder = (key) => SMALL_ORDER_KEYS.some((point) => key.subarray(0, 31).equals(point.subarray(0, 31)) && (key[31] & 0x7f) === point[31]);

// Where a desktop app finds its updates, the key their signatures are checked with, and the version they are newer than:
// package.json's, which semver orders. Null without app.updater.
export function appUpdater(api) {
    const { updater } = api.config.app;
    if (updater === undefined) return null;
    const keys = 'url and publicKey';
    if (updater === null || typeof updater !== 'object' || Array.isArray(updater)) {
        throw new Error(`crossbind: app.updater ${JSON.stringify(updater)} is no object of ${keys}, as { url: 'https://example.com/updates/<name>-{platform}-{arch}.update.json', publicKey: '…' } is.`);
    }
    const unknown = Object.keys(updater).filter((key) => !['url', 'publicKey'].includes(key));
    if (unknown.length > 0) throw new Error(`crossbind: app.updater takes ${keys}; ${unknown.join(', ')} is none of them.`);
    const url = URL.canParse(updater.url) ? new URL(updater.url) : null;
    const isLocal = url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    // The host takes the address as a C string, as it is written, and the update's file from beside the manifest.
    if (!url || !(url.protocol === 'https:' || isLocal) || /[^\x21-\x7e]|["\\]/.test(updater.url) || url.pathname.endsWith('/')) {
        throw new Error(`crossbind: app.updater.url ${JSON.stringify(updater.url)} is no https address of a manifest, as https://example.com/updates/<name>-{platform}-{arch}.update.json is; http serves localhost alone.`);
    }
    const publicKey = Buffer.from(typeof updater.publicKey === 'string' ? updater.publicKey : '', 'base64');
    if (publicKey.length !== 32 || publicKey.toString('base64') !== updater.publicKey) {
        throw new Error(`crossbind: app.updater.publicKey ${JSON.stringify(updater.publicKey)} is no Ed25519 public key, which \`crossbind app updater-key\` prints.`);
    }
    if (isSmallOrder(publicKey)) {
        throw new Error(`crossbind: app.updater.publicKey ${JSON.stringify(updater.publicKey)} is a key anyone can forge signatures for, which no key pair has. Use the one \`crossbind app updater-key\` prints.`);
    }
    const { version } = api.app;
    if (typeof version !== 'string' || !SEMVER.test(version)) {
        throw new Error(`crossbind: package.json's version ${JSON.stringify(version)} is no semver version, as 1.2.3 and 1.2.3-beta.1 are, which an app that updates needs to tell a newer one.`);
    }
    if (!UPDATE_NAME.test(api.project.name)) {
        throw new Error(`crossbind: general.name ${JSON.stringify(api.project.name)} names an app's update files, which an app fetches by name: letters, digits, and . _ ~ - alone, not starting with a dot. Change general.name in crossbind.config.js.`);
    }
    return { url: updater.url, publicKey: updater.publicKey, version };
}

const publicKeyOf = (privateKey) => crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(PUBLIC_DER.length);

// A new key pair: the public key for app.updater.publicKey, the private one for CROSSBIND_UPDATER_PRIVATE_KEY.
export function newUpdaterKey() {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
        publicKey: publicKeyOf(privateKey).toString('base64'),
        privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PRIVATE_DER.length).toString('base64'),
    };
}

// The key a build signs updates with, or null without CROSSBIND_UPDATER_PRIVATE_KEY, or where a publisher's build removed
// app.updater. It has to be the private half of app.updater.publicKey, or the app would refuse what it signs.
export function updaterSigning(api, env = process.env) {
    if (!env[UPDATER_KEY]) return null;
    const updater = appUpdater(api);
    const changes = api.publisherChanges;
    if (!updater && changes && (changes.app === null || changes.app?.updater === null)) return null;
    if (!updater) throw new Error(`crossbind: ${UPDATER_KEY} is set, but crossbind.config.js has no app.updater, which tells an app where its updates are.`);
    const seed = Buffer.from(env[UPDATER_KEY], 'base64');
    if (seed.length !== 32) throw new Error(`crossbind: ${UPDATER_KEY} is no Ed25519 private key, which \`crossbind app updater-key\` prints.`);
    const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PRIVATE_DER, seed]), format: 'der', type: 'pkcs8' });
    if (!publicKeyOf(privateKey).equals(Buffer.from(updater.publicKey, 'base64'))) {
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

// What stops a build whose update could not be made: a key that could not sign it, or an app.installers that leaves out
// the installer whose file a Linux or Windows app updates itself from.
export function checkUpdate(api, { installers }) {
    updaterSigning(api);
    const needed = UPDATE_INSTALLERS[api.platform];
    if (!needed || !appUpdater(api) || installers.includes(needed)) return;
    const updates = `a ${PLATFORM_NAMES[api.platform]} app with app.updater updates itself from what its ${needed} installer makes`;
    if (api.config.app.without?.includes(needed)) throw new Error(`crossbind: ${updates}, which app.without leaves out: take ${needed} out of it, or remove app.updater.`);
    // A publisher's build may narrow the installers its store takes.
    if (api.publisherChanges?.app?.installers !== undefined) {
        throw new Error(`crossbind: ${updates}, which the publisher's build leaves out of app.installers: its build lists ${needed} too, or removes app.updater with { app: { updater: null } }.`);
    }
    throw new Error(`crossbind: ${updates}, which app.installers leaves out: list ${needed} in it, or remove app.updater.`);
}

// The file a desktop app updates itself from, beside it: a macOS app as a zip, which keeps its signature and Apple's
// ticket, and a Linux or Windows app's of its installers.
function updateFile(api, app, arch, made) {
    const installer = UPDATE_INSTALLERS[api.platform];
    if (installer) {
        const file = made.find(({ name }) => name === installer)?.files[0];
        if (!file) throw new Error(`crossbind: the ${installer} installer made no file of ${app} for its update.`);
        return file;
    }
    const zip = path.join(path.dirname(app), `${api.project.name}-darwin-${arch}.app.zip`);
    fs.rmSync(zip, { force: true });
    api.run(['ditto', '-c', '-k', '--keepParent', app, zip], { cwd: path.dirname(app) });
    return zip;
}

// With a key in the environment, the update a desktop app finds at app.updater.url, beside the app: its file, and after
// it, as a publisher puts them up in this order, the manifest that gives its version, the file's name and its signature,
// <name>-<platform>-<arch>.update.json. Without a key, none.
export function makeUpdate(api, { app, arch, made }) {
    const signing = updaterSigning(api);
    if (!signing) return [];
    const file = updateFile(api, app, arch, made);
    const target = `${HOST_PLATFORMS[api.platform]}-${arch}`;
    const signature = crypto.sign(null, Buffer.from(signedText(api.app.id, target, signing.version, file)), signing.privateKey).toString('base64');
    const manifest = path.join(path.dirname(app), `${api.project.name}-${target}.update.json`);
    fs.writeFileSync(manifest, `${JSON.stringify({ version: signing.version, file: path.basename(file), signature }, null, 2)}\n`);
    return [file, manifest];
}
