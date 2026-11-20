// Stand-ins for GitHub and Apple as the Worker asks them, for the tests that sign in through the account's page: made-up
// people, and a key made for the run, in the form of Apple's .p8.
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

const DAY_MS = 24 * 3600 * 1000;
export const KEYS = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await webcrypto.subtle.exportKey('pkcs8', KEYS.privateKey)).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
export const APPLE_ENV = Object.freeze({
    APPLE_SERVICES_ID: 'dev.made-up.signin', APPLE_TEAM_ID: 'MADEUPTEAM', APPLE_KEY_ID: 'MADEUPKEY1', APPLE_PRIVATE_KEY: PEM,
});
// Made-up Apple ids, in the form of Apple's `sub`.
export const SUB = '000123.made0up0apple0id0for0tests.0456';
export const OTHER_SUB = '000123.made0up0apple0id0another0.0789';

export const jsonOf = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());
// The code a provider's page sends back holds what the start's address asked: Apple keeps the nonce with its code,
// GitHub the challenge with its own.
export const codeFor = (asked) => Buffer.from(JSON.stringify({
    nonce: asked.searchParams.get('nonce'), challenge: asked.searchParams.get('code_challenge'),
})).toString('base64url');

// Apple's token endpoint gives an id_token for the person `subject` with the nonce its code holds, and records each
// revoke.
export function apple({
    now, subject = SUB, claims = {}, status = 200, refresh = 'made-up-refresh-token', revokeStatus = 200, extra = { email: 'made-up@example.com' },
}) {
    const calls = { token: [], revoke: [] };
    const fetcher = async (url, init) => {
        const body = Object.fromEntries(new URLSearchParams(init.body));
        if (url === 'https://appleid.apple.com/auth/revoke') {
            calls.revoke.push(body);
            return new Response(null, { status: revokeStatus });
        }
        assert.equal(url, 'https://appleid.apple.com/auth/token');
        calls.token.push(body);
        if (status !== 200) return Response.json({ error: 'invalid_grant' }, { status });
        const { nonce } = jsonOf(body.code);
        const payload = {
            iss: 'https://appleid.apple.com', aud: APPLE_ENV.APPLE_SERVICES_ID, exp: Math.floor(now / 1000) + 600, iat: Math.floor(now / 1000), sub: subject, nonce, ...extra, ...claims,
        };
        const idToken = [{ alg: 'RS256', kid: 'made-up' }, payload].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
        return Response.json({
            access_token: 'made-up-access-token', token_type: 'Bearer', expires_in: 3600, id_token: `${idToken}.made-up-signature`, ...(refresh ? { refresh_token: refresh } : {}),
        });
    };
    return { fetcher, calls };
}

// GitHub's web flow, for the made-up account `person` created `ageDays` ago: a token for the verifier that made the
// challenge its code holds, as GitHub's PKCE has it.
export const github = ({ now, person = { id: 8000000001, login: 'made_up_dev' }, ageDays = 400 }) => async (url, init) => {
    if (url === 'https://github.com/login/oauth/access_token') {
        const body = JSON.parse(init.body);
        const { challenge } = jsonOf(body.code);
        return Response.json(challenge === createHash('sha256').update(body.code_verifier).digest('base64url') ? { access_token: 'gho_made_up' } : { error: 'bad_verification_code' });
    }
    assert.equal(url, 'https://api.github.com/user');
    return Response.json({ ...person, created_at: new Date(now - ageDays * DAY_MS).toISOString() });
};

// One fetcher for both: GitHub's addresses to GitHub's stand-in, the rest to Apple's.
export const both = (githubFetcher, appleFetcher) => (url, init) => (url.startsWith('https://github.com/') || url.startsWith('https://api.github.com/')
    ? githubFetcher(url, init) : appleFetcher(url, init));
