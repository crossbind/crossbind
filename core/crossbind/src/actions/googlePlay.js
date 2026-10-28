import fs from 'node:fs';
import { createSign } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Google Play's credentials, which the environment or ~/.crossbind.json names: a service account's e-mail, whose token
// the user's gcloud login buys with no key, or its JSON key.
export const PLAY = { key: 'CROSSBIND_GOOGLE_PLAY_KEY', serviceAccount: 'CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT' };
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications';
const IAM = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts';
// The longest a service account's token lasts.
const TOKEN_SECONDS = 3600;
// Play's answer for an app whose first release Play Console has not rolled out yet.
const DRAFT_APP = /status draft may be created on draft app/;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function readKey(file) {
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`crossbind: ${PLAY.key} names ${file}, which is no file.`);
    let key;
    try {
        key = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        throw new Error(`crossbind: ${file} (${PLAY.key}) is no JSON, so it is no service account key.`);
    }
    const missing = ['client_email', 'private_key', 'token_uri'].filter((field) => !key[field]);
    if (missing.length) throw new Error(`crossbind: ${file} (${PLAY.key}) has no ${missing.join(', ')}, so it is no service account key.`);
    return key;
}

// The credentials Play takes from this environment and machine, or null without any: one of the two kinds.
export function playCredentials(env = process.env, system = {}) {
    const file = env[PLAY.key] || system.GOOGLE_PLAY_KEY;
    const account = env[PLAY.serviceAccount] || system.GOOGLE_PLAY_SERVICE_ACCOUNT;
    if (file && account) {
        throw new Error(`crossbind: both ${PLAY.key} and ${PLAY.serviceAccount} are set, or their keys in ~/.crossbind.json: set one, the service account's e-mail to use your gcloud login, or its JSON key.`);
    }
    if (account) return { account };
    if (!file) return null;
    const key = readKey(file);
    return { account: key.client_email, key, file };
}

async function keyToken({ account, key }) {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account, scope: SCOPE, aud: key.token_uri, iat: now, exp: now + TOKEN_SECONDS })}`;
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
        body: JSON.stringify({ scope: [SCOPE] }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`crossbind: Google gave no token of ${account}: ${response.status} ${body.error?.message ?? ''}\nyour gcloud account needs the Service Account Token Creator role on it, and its project the IAM Service Account Credentials API.`);
    }
    return body.accessToken;
}

// An hour's token of Play's API for the service account.
export const playToken = (credentials) => (credentials.key ? keyToken(credentials) : accountToken(credentials));

function playError(status, message, method, url, appId, account) {
    const path = new URL(url).pathname.replace(/^.*\/applications\/[^/]+/, '') || '/';
    let text = `crossbind: Google Play answered ${method} ${path} with ${status}: ${message}`;
    if (status === 404 && path === '/edits') {
        text = `crossbind: Play Console has no app ${appId}: create it there, with ${appId} as its package name, as Play's API makes none.`;
    } else if (status === 403) {
        text = `crossbind: ${account} has no release rights for ${appId}: invite it in Play Console, under Users and permissions, with "Release apps to testing tracks" for the app.`;
    }
    return Object.assign(new Error(text), { status, playMessage: message });
}

// A caller of Play's API for one app, whose failures say what to do where they can.
async function playCaller(appId, credentials) {
    const token = await playToken(credentials);
    return async (method, url, body) => {
        const isBinary = Buffer.isBuffer(body);
        const response = await fetch(url, {
            method,
            headers: { authorization: `Bearer ${token}`, 'content-type': isBinary ? 'application/octet-stream' : 'application/json' },
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
        throw playError(response.status, message, method, url, appId, credentials.account);
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

// Uploads a bundle and releases it on a track, as status says, in one edit. An app never released takes a draft alone,
// which its first rollout in Play Console makes live, so its release becomes one.
export async function uploadBundle(appId, credentials, { aab, track, status }) {
    const call = await playCaller(appId, credentials);
    const edits = `${API}/${appId}/edits`;
    const edit = await call('POST', edits, {});
    try {
        const { versionCode } = await call('POST', `${UPLOAD}/${appId}/edits/${edit.id}/bundles?uploadType=media`, fs.readFileSync(aab));
        const release = async (releaseStatus) => {
            await call('PUT', `${edits}/${edit.id}/tracks/${track}`, { track, releases: [{ versionCodes: [String(versionCode)], status: releaseStatus }] });
            await call('POST', `${edits}/${edit.id}:commit`);
            return { versionCode, status: releaseStatus };
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
