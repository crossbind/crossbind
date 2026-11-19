import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { secretFile } from '../utils/secretFile.js';

// The Developer ID that signs a macOS app and the App Store Connect API key Apple notarizes it with, as the environment
// names them; ~/.crossbind.json may name the key too, by its file, as it keeps no secret.
export const APPLE_SIGNING = {
    identity: 'CROSSBIND_APPLE_SIGNING_IDENTITY',
    key: 'CROSSBIND_APPLE_API_KEY',
    keyId: 'CROSSBIND_APPLE_API_KEY_ID',
    issuer: 'CROSSBIND_APPLE_API_ISSUER',
};
const NOTARY = [APPLE_SIGNING.key, APPLE_SIGNING.keyId, APPLE_SIGNING.issuer];
// App Store Connect gives a key's file as AuthKey_<key id>.p8, so the file's own name tells its ID.
const KEY_FILE = /^AuthKey_([A-Z0-9]{10})\.p8$/;
// A key's own text, as CI's secrets give it, in place of its file's path.
const KEY_TEXT = /^\s*-----BEGIN /;

const listed = (names) => `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'}`;

function tool(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error) throw new Error(`crossbind: cannot run ${command}: ${result.error.message}`, { cause: result.error });
    if (result.status !== 0) throw new Error(`crossbind: ${command} ${args[0]} failed with exit code ${result.status}:\n${`${result.stdout}${result.stderr}`.trim()}`);
    return result.stdout;
}

// The keychain's valid code signing identities, each a SHA-1 hash and a certificate's name.
function signingIdentities() {
    return tool('security', ['find-identity', '-v', '-p', 'codesigning']).split('\n')
        .map((line) => line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.*)"$/))
        .filter(Boolean)
        .map(([, hash, name]) => ({ hash, name }));
}

// A part of the App Store Connect API key, from the environment, else from ~/.crossbind.json under its name without
// CROSSBIND_, as crossbind config set keeps it: where it is set, and its value.
function keyPart(name, env, system) {
    const kept = name.replace(/^CROSSBIND_/, '');
    if (env[name]) return { from: name, value: env[name] };
    return system[kept] ? { from: `${kept} in ~/.crossbind.json`, value: system[kept] } : null;
}

// The App Store Connect API key the environment or ~/.crossbind.json names, with which Apple notarizes a macOS app and
// xcodebuild uploads an iOS one in place of Xcode's account, or null: all of it or none, but for its ID where its file's
// name tells it. The key is its file, or its text from the environment alone, which goes to a file as the tools take
// files.
export function appStoreKey(env = process.env, system = {}) {
    const parts = Object.fromEntries(NOTARY.map((name) => [name, keyPart(name, env, system)]));
    const set = NOTARY.filter((name) => parts[name]);
    if (!set.length) return null;
    const { from, value: given = '' } = parts[APPLE_SIGNING.key] ?? {};
    const isText = KEY_TEXT.test(given);
    if (isText && !env[APPLE_SIGNING.key]) {
        throw new Error(`crossbind: ${from} is a key's own text, which crossbind keeps in no file: set it to the path of the key's .p8 file, as crossbind config set APPLE_API_KEY <path> does, or give the text as ${APPLE_SIGNING.key}.`);
    }
    const keyId = parts[APPLE_SIGNING.keyId]?.value || (isText ? undefined : path.basename(given).match(KEY_FILE)?.[1]);
    const missing = NOTARY.filter((name) => !parts[name] && !(name === APPLE_SIGNING.keyId && keyId));
    if (missing.length) {
        const byName = missing.includes(APPLE_SIGNING.keyId) && !isText ? ', the ID unless its file keeps the name App Store Connect gives it, AuthKey_<key id>.p8' : '';
        const configHint = 'crossbind config set keeps each in ~/.crossbind.json, under its name without CROSSBIND_';
        throw new Error(`crossbind: ${listed(set.map((name) => parts[name].from))} set, but ${listed(missing)} not: an App Store Connect API key takes all three${byName}. ${configHint}.`);
    }
    const key = isText ? secretFile('AuthKey.p8', `${given.trim()}\n`) : path.resolve(given);
    if (!fs.statSync(key, { throwIfNoEntry: false })?.isFile()) throw new Error(`crossbind: ${from} names ${key}, which is no file.`);
    return { key, keyId, issuer: parts[APPLE_SIGNING.issuer].value };
}

// The identity a macOS app is signed with and the key Apple notarizes it with, or null without an identity: the app is
// then signed ad hoc, which opens it on the Mac that built it alone, even with the key, which iOS uploads take too.
// codesign takes the identity's hash, which the renewed certificates of one name do not share.
export function appleSigning(env = process.env, system = {}) {
    const identity = env[APPLE_SIGNING.identity];
    if (!identity) return null;
    const notary = appStoreKey(env, system);
    const found = signingIdentities().filter(({ hash, name }) => hash === identity.toUpperCase() || name.includes(identity));
    const matches = [...new Map(found.map((match) => [match.hash, match])).values()];
    if (!matches.length) throw new Error(`crossbind: ${APPLE_SIGNING.identity} names ${JSON.stringify(identity)}, which no valid code signing identity in the keychain is; \`security find-identity -v -p codesigning\` lists them.`);
    if (matches.length > 1) {
        throw new Error(`crossbind: ${APPLE_SIGNING.identity} names ${JSON.stringify(identity)}, which ${matches.length} identities in the keychain are: ${matches.map(({ hash, name }) => `${hash} "${name}"`).join(', ')}. Set it to one of their hashes.`);
    }
    const [{ hash, name }] = matches;
    if (notary && !name.startsWith('Developer ID Application:')) {
        throw new Error(`crossbind: Apple notarizes an app signed with a Developer ID Application certificate, which ${JSON.stringify(name)} is not.`);
    }
    return { identity: hash, notary };
}

// The ticket Apple issues can take a moment to reach the servers stapler asks for it.
function staple(app) {
    let result;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) spawnSync('sleep', ['15']);
        result = spawnSync('xcrun', ['stapler', 'staple', app], { encoding: 'utf8' });
        if (result.status === 0) return;
    }
    throw new Error(`crossbind: xcrun stapler failed with exit code ${result.status}:\n${`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()}`);
}

// Apple notarizes a signed app sent to it as a zip, which takes a few minutes; the ticket stapled to the app then opens
// it on any Mac, offline too.
export function notarizeApp(app, notary) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-notary-'));
    const zip = path.join(dir, `${path.basename(app)}.zip`);
    const key = ['--key', notary.key, '--key-id', notary.keyId, '--issuer', notary.issuer];
    try {
        tool('ditto', ['-c', '-k', '--keepParent', app, zip]);
        console.log(`crossbind: Apple is notarizing ${path.basename(app)}, which takes a few minutes.`);
        // notarytool's verdict is in its JSON, whatever its exit code.
        const submit = spawnSync('xcrun', ['notarytool', 'submit', zip, ...key, '--wait', '--timeout', '2h', '--output-format', 'json'], { encoding: 'utf8' });
        let verdict;
        try {
            verdict = JSON.parse(submit.stdout);
        } catch (error) {
            throw new Error(`crossbind: xcrun notarytool failed with exit code ${submit.status}:\n${`${submit.stdout ?? ''}${submit.stderr ?? ''}`.trim() || submit.error?.message}`, { cause: error });
        }
        const { id, status, message } = verdict;
        if (status !== 'Accepted') {
            const log = spawnSync('xcrun', ['notarytool', 'log', id, ...key], { encoding: 'utf8' }).stdout ?? '';
            throw new Error(`crossbind: Apple did not notarize ${path.basename(app)} (${status}${message ? `: ${message}` : ''}). Its log:\n${log.trim()}`);
        }
        staple(app);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
