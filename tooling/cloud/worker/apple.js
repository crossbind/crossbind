import { log } from './http.js';
import { fromBase64Url, toBase64Url } from './session.js';

// Sign in with Apple on the web, as Apple's REST API has it: no scope, so Apple hands over its id for the person,
// `sub`, which is all that is read; the refresh token a sign-in gives is revoked at once, so none is kept. Its four
// values are secrets, as GitHub's client id is: the Services ID, the Team ID, the key's id and the key (its .p8).

const APPLE_ORIGIN = 'https://appleid.apple.com';
const AUTHORIZE_URL = `${APPLE_ORIGIN}/auth/authorize`;
const TOKEN_URL = `${APPLE_ORIGIN}/auth/token`;
const REVOKE_URL = `${APPLE_ORIGIN}/auth/revoke`;
// A client secret lives for the one sign-in that makes it; Apple takes up to six months.
export const CLIENT_SECRET_SECONDS = 300;
const MAX_SUBJECT_LENGTH = 255;
const utf8 = new TextEncoder();

export const isAppleConfigured = (env) => Boolean(env.APPLE_SERVICES_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY && env.SESSION_SECRET);

const base64Json = (value) => toBase64Url(utf8.encode(JSON.stringify(value)));
// The nonce binds Apple's answer to this browser: the secret it is made from waits in the state cookie.
const nonceOf = async (secret) => toBase64Url(await crypto.subtle.digest('SHA-256', utf8.encode(secret)));
const form = (fields) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });

export async function appleAuthorizeUrl(env, redirectUri, state, secret) {
    const url = new URL(AUTHORIZE_URL);
    Object.entries({
        client_id: env.APPLE_SERVICES_ID, redirect_uri: redirectUri, response_type: 'code', response_mode: 'query', state, nonce: await nonceOf(secret),
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.href;
}

// The ES256 JWT Apple takes as the client secret, signed with the Sign in with Apple key, a PEM of PKCS #8.
export async function clientSecret(env, now) {
    const der = fromBase64Url(env.APPLE_PRIVATE_KEY.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const issued = Math.floor(now / 1000);
    const unsigned = `${base64Json({ alg: 'ES256', kid: env.APPLE_KEY_ID })}.${base64Json({
        iss: env.APPLE_TEAM_ID, iat: issued, exp: issued + CLIENT_SECRET_SECONDS, aud: APPLE_ORIGIN, sub: env.APPLE_SERVICES_ID,
    })}`;
    return `${unsigned}.${toBase64Url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8.encode(unsigned)))}`;
}

// Nothing of Apple's answer reaches a log line: a message here never quotes it.
function claimsOf(idToken) {
    try {
        return JSON.parse(new TextDecoder().decode(fromBase64Url(idToken.split('.')[1])));
    } catch {
        throw new Error('Apple sent no id_token that reads');
    }
}

async function revoke(env, client, token, fetcher) {
    try {
        const response = await fetcher(REVOKE_URL, form({
            client_id: env.APPLE_SERVICES_ID, client_secret: client, token, token_type_hint: 'refresh_token',
        }));
        if (!response.ok) log({ event: 'apple-revoke-failed', status: response.status });
    } catch (error) {
        log({ event: 'apple-revoke-failed', message: error.message });
    }
}

// Apple's id for the person whose code this is. The code is exchanged at Apple's token endpoint over TLS, so the
// id_token's signature is not checked (OpenID Connect Core 3.1.3.7); its claims are: Apple's issuer, this Services ID,
// not expired, and the nonce of this browser's secret. The refresh token is revoked whatever the claims say.
export async function appleIdentity(env, {
    code, secret, redirectUri, fetcher, now,
}) {
    const client = await clientSecret(env, now);
    const response = await fetcher(TOKEN_URL, form({
        client_id: env.APPLE_SERVICES_ID, client_secret: client, code, grant_type: 'authorization_code', redirect_uri: redirectUri,
    }));
    if (!response.ok) throw new Error(`Apple answered ${response.status}`);
    const tokens = await response.json().catch(() => ({}));
    try {
        const claims = claimsOf(tokens.id_token);
        if (claims.iss !== APPLE_ORIGIN || claims.aud !== env.APPLE_SERVICES_ID || !(claims.exp * 1000 > now) || claims.nonce !== await nonceOf(secret)) {
            throw new Error('Apple\'s id_token is not for this sign-in');
        }
        if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > MAX_SUBJECT_LENGTH) throw new Error('Apple sent no user');
        return { identity: { provider: 'apple', subject: claims.sub, login: '' } };
    } finally {
        if (typeof tokens.refresh_token === 'string') await revoke(env, client, tokens.refresh_token, fetcher);
    }
}
