import fs from 'node:fs';
import path from 'node:path';
import { createHash, createSign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { accessToken } from './googleSignIn.js';
import {
    PLAY_LISTING, isListed, lackedForNewListing, releaseNotesOf,
} from './playListing.js';

// Google Play's credentials, which the environment or ~/.crossbind.json names: a service account's e-mail, whose token
// the user's gcloud login buys with no key, or its JSON key; or, from the environment alone, an access token made
// elsewhere, as CI makes one with no key.
export const PLAY = { key: 'CROSSBIND_GOOGLE_PLAY_KEY', serviceAccount: 'CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT', token: 'CROSSBIND_GOOGLE_PLAY_TOKEN' };
export const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
// The secret the keychain keeps the user's Google sign-in for Play by.
const SIGN_IN = 'sign-in';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications';
const IAM = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts';
// The longest a service account's token lasts.
const TOKEN_SECONDS = 3600;
// Play's answer for an app whose first release Play Console has not rolled out yet.
const DRAFT_APP = /status draft may be created on draft app/;
// The rights in Play Console an account needs for a release on a testing track, on production, and for the listing.
const TESTING_RIGHTS = '"Release apps to testing tracks"';
const PRODUCTION_RIGHTS = '"Release to production, exclude devices, and use Play App Signing"';
const LISTING_RIGHTS = '"Manage store presence"';
// A production track, as a form factor's is too: wear:production.
const PRODUCTION = /(^|:)production$/;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

// A JSON key's own text, as CI's secrets give it, in place of its file's path.
const KEY_TEXT = /^\s*\{/;

// A service account key from its JSON, which `source` names where it is none, never repeating the text.
function parseKey(json, source, isText) {
    let key;
    try {
        key = JSON.parse(json);
    } catch {
        throw new Error(`crossbind: ${source} ${isText ? 'holds' : 'is'} no JSON, so it is no service account key.`);
    }
    const missing = ['client_email', 'private_key', 'token_uri'].filter((field) => !key[field]);
    if (missing.length) throw new Error(`crossbind: ${source} has no ${missing.join(', ')}, so it is no service account key.`);
    return key;
}

function readKey(file) {
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`crossbind: ${PLAY.key} names ${file}, which is no file.`);
    return parseKey(fs.readFileSync(file, 'utf8'), `${file} (${PLAY.key})`, false);
}

// The credentials Play takes from this environment and machine's settings, or null without any: one of the three kinds.
export function playCredentials(env = process.env, settings = { get: () => undefined }) {
    const file = env[PLAY.key] || settings.get('GOOGLE_PLAY_KEY');
    const account = env[PLAY.serviceAccount] || settings.get('GOOGLE_PLAY_SERVICE_ACCOUNT');
    const token = env[PLAY.token];
    if (file && account) {
        throw new Error(`crossbind: both ${PLAY.key} and ${PLAY.serviceAccount} are set, or their keys in ~/.crossbind.json: set one, the service account's e-mail to use your gcloud login, or its JSON key.`);
    }
    if (token && (file || account)) {
        throw new Error(`crossbind: ${PLAY.token} is set, and so is ${file ? PLAY.key : PLAY.serviceAccount} or its key in ~/.crossbind.json: set one.`);
    }
    if (token) return { token };
    if (account) return { account };
    if (!file) return null;
    if (KEY_TEXT.test(env[PLAY.key] ?? '')) {
        const key = parseKey(env[PLAY.key], PLAY.key, true);
        return { account: key.client_email, key, file: null };
    }
    const key = readKey(file);
    return { account: key.client_email, key, file };
}

// The user's Google sign-in for Play that this machine's keychain keeps, through the api's secrets, or null where it
// keeps none or Google no longer takes it.
export async function keptSignIn(secrets) {
    const refreshToken = secrets.get(SIGN_IN);
    if (!refreshToken) return null;
    try {
        await accessToken(refreshToken);
    } catch (error) {
        if (error.reason !== 'invalid_grant') throw error;
        console.log('crossbind: Google no longer takes the sign-in this machine keeps for Google Play, as when it was revoked.');
        return null;
    }
    return { refreshToken };
}

// Keeps the user's Google sign-in for Play in the system's keychain, and says whether it did.
export const keepSignIn = (secrets, refreshToken) => secrets.set(SIGN_IN, refreshToken);

async function keyToken({ account, key }) {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account, scope: PLAY_SCOPE, aud: key.token_uri, iat: now, exp: now + TOKEN_SECONDS })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
    const response = await fetch(key.token_uri, {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`crossbind: Google refused the token of ${account}: ${response.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
    return body.access_token;
}

// The user's own gcloud login buys an hour's token of the service account, so no key of it exists anywhere.
async function accountToken({ account }) {
    const own = spawnSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' });
    if (own.error || own.status !== 0) {
        throw new Error(`crossbind: gcloud gave no token of yours: sign in with gcloud auth login, or name the service account's JSON key with ${PLAY.key} instead.\n${(own.stderr || own.error?.message || '').trim()}`);
    }
    const response = await fetch(`${IAM}/${account}:generateAccessToken`, {
        method: 'POST',
        headers: { authorization: `Bearer ${own.stdout.trim()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ scope: [PLAY_SCOPE] }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`crossbind: Google gave no token of ${account}: ${response.status} ${body.error?.message ?? ''}\nyour gcloud account needs the Service Account Token Creator role on it, and its project the IAM Service Account Credentials API.`);
    }
    return body.accessToken;
}

// An hour's token of Play's API: the one from the environment, or one for the user's Google sign-in or for the service
// account.
export async function playToken(credentials) {
    if (credentials.token) return credentials.token;
    if (credentials.refreshToken) return accessToken(credentials.refreshToken);
    return credentials.key ? keyToken(credentials) : accountToken(credentials);
}

function playError(status, message, method, url, appId, credentials, rights) {
    const route = new URL(url).pathname.replace(/^.*\/applications\/[^/]+/, '') || '/';
    let text = `crossbind: Google Play answered ${method} ${route} with ${status}: ${message}`;
    if (status === 404 && route === '/edits') {
        text = `crossbind: Play Console has no app ${appId}: create it there, with ${appId} as its package name, as Play's API makes none.`;
    } else if (status === 401 && credentials.token) {
        text = `crossbind: Google Play takes ${PLAY.token} no more: it has expired, as access tokens do after an hour, or it is no access token; make it in the publish's own job.`;
    } else if (status === 403 && credentials.token && /insufficient authentication scopes/i.test(message)) {
        text = `crossbind: ${PLAY.token} lacks the scope ${PLAY_SCOPE}, which Google Play's API takes: ask for it where the token is made, as google-github-actions/auth's access_token_scopes does.`;
    } else if (status === 403 && credentials.refreshToken) {
        text = `crossbind: the Google account you signed in with has no release rights for ${appId}: sign in with one that has, or have it invited in Play Console, under Users and permissions, with ${rights.join(' and ')} for the app.`;
    } else if (status === 403) {
        const account = credentials.token ? `the account behind ${PLAY.token}` : credentials.account;
        text = `crossbind: ${account} has no release rights for ${appId}: invite it in Play Console, under Users and permissions, with ${rights.join(' and ')} for the app.`;
    }
    return Object.assign(new Error(text), { status, playMessage: message });
}

// A caller of Play's API for one app, whose failures say what to do where they can, naming the rights its calls take. A
// file's bytes go up as they are, of the type given.
async function playCaller(appId, credentials, rights = [TESTING_RIGHTS]) {
    const token = await playToken(credentials);
    return async (method, url, body, type = 'application/octet-stream') => {
        const isBinary = Buffer.isBuffer(body);
        const response = await fetch(url, {
            method,
            headers: { authorization: `Bearer ${token}`, 'content-type': isBinary ? type : 'application/json' },
            body: isBinary || body === undefined ? body : JSON.stringify(body),
        });
        const text = await response.text();
        if (response.ok) return text ? JSON.parse(text) : {};
        let message = text;
        try {
            message = JSON.parse(text).error?.message ?? text;
        } catch {
            // Not Google's JSON error, so the text is the message.
        }
        throw playError(response.status, message, method, url, appId, credentials, rights);
    };
}

// The highest versionCode Play has seen of an app, in its bundles, its APKs and its tracks' releases; 0 for none.
export async function highestVersionCode(appId, credentials) {
    const call = await playCaller(appId, credentials);
    const edits = `${API}/${appId}/edits`;
    const edit = await call('POST', edits, {});
    try {
        const { tracks = [] } = await call('GET', `${edits}/${edit.id}/tracks`);
        const { bundles = [] } = await call('GET', `${edits}/${edit.id}/bundles`);
        const { apks = [] } = await call('GET', `${edits}/${edit.id}/apks`);
        const released = tracks.flatMap(({ releases = [] }) => releases.flatMap(({ versionCodes = [] }) => versionCodes));
        return Math.max(0, ...[...bundles, ...apks].map(({ versionCode }) => versionCode), ...released.map(Number));
    } finally {
        await call('DELETE', `${edits}/${edit.id}`).catch(() => {});
    }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const contentTypeOf = (file) => (/\.png$/i.test(file) ? 'image/png' : 'image/jpeg');

// Puts a language's images of each type into an edit where Play shows others, or in another order, naming a file Play
// refuses, and says whether it did.
async function updateImages(call, { editUrl, uploadUrl }, language, images) {
    let isChanged = false;
    for (const [type, files] of Object.entries(images)) {
        const bytes = files.map((file) => fs.readFileSync(file));
        const { images: shown = [] } = await call('GET', `${editUrl}/listings/${language}/${type}`);
        if (shown.map((image) => image.sha256).join() === bytes.map(sha256).join()) continue;
        await call('DELETE', `${editUrl}/listings/${language}/${type}`);
        for (const [index, file] of files.entries()) {
            await call('POST', `${uploadUrl}/listings/${language}/${type}?uploadType=media`, bytes[index], contentTypeOf(file)).catch((error) => {
                throw Object.assign(new Error(`${error.message}\ncrossbind: it answered so for ${file}.`), { status: error.status, playMessage: error.playMessage });
            });
        }
        isChanged = true;
    }
    return isChanged;
}

// Puts into an edit what a project's listing has and Play's lacks: a language's texts where one differs, and its images.
// A language Play has no listing in takes the texts Play makes one of. Gives the languages it changed.
async function updateListings(call, urls, listings) {
    const listed = listings.filter(isListed);
    if (listed.length === 0) return [];
    const { listings: shown = [] } = await call('GET', `${urls.editUrl}/listings`);
    const changed = [];
    for (const listing of listed) {
        const { language, texts, images } = listing;
        const current = shown.find((one) => one.language === language);
        const lacked = current ? [] : lackedForNewListing(listing);
        if (lacked.length > 0) {
            throw new Error(`crossbind: Google Play has no listing in ${language} yet, which it makes of a title, a short and a full description: add ${lacked.join(', ')} to ${path.join(PLAY_LISTING, language)}.`);
        }
        const isTextNew = Object.entries(texts).some(([field, text]) => (current?.[field] ?? '') !== text);
        if (isTextNew) await call('PUT', `${urls.editUrl}/listings/${language}`, { ...current, ...texts, language });
        const isImageNew = await updateImages(call, urls, language, images);
        if (isTextNew || isImageNew) changed.push(language);
    }
    return changed;
}

// Uploads a bundle, with the zip of its native debug symbols if there is one, and releases it on a track, as status
// says, to the share of users userFraction gives while it is in progress, in one edit with the project's listing and
// the release's notes it has. An app never released takes a draft alone, which its first rollout in Play Console makes
// live, so its release becomes one. Gives the languages whose listing changed too.
export async function uploadBundle(appId, credentials, { aab, symbols = null, track, status, userFraction = null, listings = [] }) {
    const rights = [PRODUCTION.test(track) ? PRODUCTION_RIGHTS : TESTING_RIGHTS, ...(listings.some(isListed) ? [LISTING_RIGHTS] : [])];
    const call = await playCaller(appId, credentials, rights);
    const edits = `${API}/${appId}/edits`;
    const edit = await call('POST', edits, {});
    const uploadUrl = `${UPLOAD}/${appId}/edits/${edit.id}`;
    try {
        const { versionCode } = await call('POST', `${uploadUrl}/bundles?uploadType=media`, fs.readFileSync(aab));
        if (symbols) {
            await call('POST', `${uploadUrl}/apks/${versionCode}/deobfuscationFiles/nativeCode?uploadType=media`, fs.readFileSync(symbols));
        }
        const listed = await updateListings(call, { editUrl: `${edits}/${edit.id}`, uploadUrl }, listings);
        const releaseNotes = releaseNotesOf(listings, versionCode);
        const release = async (releaseStatus) => {
            const share = releaseStatus === 'inProgress' ? { userFraction } : {};
            const notes = releaseNotes.length > 0 ? { releaseNotes } : {};
            await call('PUT', `${edits}/${edit.id}/tracks/${track}`, { track, releases: [{ versionCodes: [String(versionCode)], status: releaseStatus, ...share, ...notes }] });
            await call('POST', `${edits}/${edit.id}:commit`);
            return { versionCode, status: releaseStatus, listed };
        };
        try {
            return await release(status);
        } catch (error) {
            if (status === 'draft' || !DRAFT_APP.test(error.playMessage ?? '')) throw error;
            return await release('draft');
        }
    } catch (error) {
        // An edit left open expires by itself; the first failure is the one to report.
        await call('DELETE', `${edits}/${edit.id}`).catch(() => {});
        throw error;
    }
}
