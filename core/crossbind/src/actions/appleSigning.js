import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The Developer ID that signs a macOS app and the App Store Connect API key Apple notarizes it with, named by the
// environment alone so that no secret reaches a file.
export const APPLE_SIGNING = {
    identity: 'CROSSBIND_APPLE_SIGNING_IDENTITY',
    key: 'CROSSBIND_APPLE_API_KEY',
    keyId: 'CROSSBIND_APPLE_API_KEY_ID',
    issuer: 'CROSSBIND_APPLE_API_ISSUER',
};
const NOTARY = [APPLE_SIGNING.key, APPLE_SIGNING.keyId, APPLE_SIGNING.issuer];

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

// The App Store Connect API key the environment names, with which Apple notarizes a macOS app and xcodebuild uploads an
// iOS one in place of Xcode's account, or null: all of it or none.
export function appStoreKey(env = process.env) {
    const set = NOTARY.filter((name) => env[name]);
    if (!set.length) return null;
    const missing = NOTARY.filter((name) => !env[name]);
    if (missing.length) throw new Error(`crossbind: ${listed(set)} set, but ${listed(missing)} not: an App Store Connect API key takes all three.`);
    const key = path.resolve(env[APPLE_SIGNING.key]);
    if (!fs.statSync(key, { throwIfNoEntry: false })?.isFile()) throw new Error(`crossbind: ${APPLE_SIGNING.key} names ${key}, which is no file.`);
    return { key, keyId: env[APPLE_SIGNING.keyId], issuer: env[APPLE_SIGNING.issuer] };
}

// The identity a macOS app is signed with and the key Apple notarizes it with, or null without an identity: the app is
// then signed ad hoc, which opens it on the Mac that built it alone, even with the key, which iOS uploads take too.
// codesign takes the identity's hash, which the renewed certificates of one name do not share.
export function appleSigning(env = process.env) {
    const identity = env[APPLE_SIGNING.identity];
    if (!identity) return null;
    const notary = appStoreKey(env);
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
