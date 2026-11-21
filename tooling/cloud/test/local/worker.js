// The Worker for test/local/run.mjs, under `wrangler dev` with no container (wrangler.jsonc beside it): worker/api.js
// on the run's local D1, with the quota in memory, no compiler, and stand-ins for GitHub and Apple that reach nothing
// outside. Three paths of its own, for the run alone: what Apple's stand-in saw, build seconds for an account, and how many
// objects the snapshots' local bucket holds under a prefix.
import { createAccounts } from '../../worker/accounts.js';
import { handleRequest } from '../../worker/api.js';
import { createDeviceCodes } from '../../worker/devices.js';
import { createProjectSessions } from '../../worker/project-sessions.js';
import { createQuota } from '../../worker/quota.js';
import { createSnapshots } from '../../worker/snapshots.js';
import { memoryStorage } from '../../scripts/memory-storage.mjs';

const DAY_MS = 24 * 3600 * 1000;
const quota = createQuota(memoryStorage());
const fromBase64Url = (text) => atob(text.replace(/-/g, '+').replace(/_/g, '/'));
const bytesOf = (text) => Uint8Array.from(fromBase64Url(text), (char) => char.charCodeAt(0));
const jsonOf = (part) => JSON.parse(fromBase64Url(part));
const base64Json = (value) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// What Apple's stand-in was asked: client secrets that held and that did not, and the refresh tokens revoked.
const appleSeen = { secrets: 0, refused: 0, revoked: [] };
const challengeOf = async (verifier) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// GitHub as the Worker asks it, for the made-up account the vars name. A web sign-in's code is the challenge the run's
// browser was sent with (run.mjs), and gets a token for the verifier that made it alone, as GitHub's PKCE has it; the
// CLI's device flow is approved at once.
async function github(url, init, env) {
    if (url === 'https://github.com/login/device/code') {
        return Response.json({
            device_code: 'made-up-device-code', user_code: 'MADE-UPCD', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1,
        });
    }
    if (url === 'https://github.com/login/oauth/access_token') {
        const body = JSON.parse(init.body);
        if (body.device_code) return Response.json({ access_token: 'gho_made_up_device' });
        const { challenge } = JSON.parse(fromBase64Url(body.code));
        return Response.json(challenge === await challengeOf(body.code_verifier ?? '') ? { access_token: 'gho_made_up_web' } : { error: 'bad_verification_code' });
    }
    if (url === 'https://api.github.com/user') {
        return Response.json({ id: Number(env.STANDIN_GITHUB_ID), login: env.STANDIN_GITHUB_LOGIN, created_at: new Date(Date.now() - 400 * DAY_MS).toISOString() });
    }
    throw new Error(`this run reaches nothing outside: ${url}`);
}

// Apple as the Worker asks it, for the made-up Apple id the vars name: the client secret checked as Apple checks it, an
// ES256 JWT of the run's key for this Services ID, team and key, and an id_token with the nonce its code holds.
async function apple(url, init, env) {
    const body = Object.fromEntries(new URLSearchParams(init.body));
    if (url === 'https://appleid.apple.com/auth/revoke') {
        appleSeen.revoked.push(body.token);
        return new Response(null, { status: 200 });
    }
    if (url !== 'https://appleid.apple.com/auth/token') throw new Error(`this run reaches nothing outside: ${url}`);
    const [header, claims, signature] = body.client_secret.split('.');
    const key = await crypto.subtle.importKey('spki', bytesOf(env.STANDIN_APPLE_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signed = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytesOf(signature), new TextEncoder().encode(`${header}.${claims}`));
    const said = jsonOf(claims);
    const now = Math.floor(Date.now() / 1000);
    if (!signed || jsonOf(header).kid !== env.APPLE_KEY_ID || said.iss !== env.APPLE_TEAM_ID || said.sub !== env.APPLE_SERVICES_ID
        || said.aud !== 'https://appleid.apple.com' || !(said.exp > now && said.exp - said.iat <= 300)) {
        appleSeen.refused += 1;
        return Response.json({ error: 'invalid_client' }, { status: 400 });
    }
    appleSeen.secrets += 1;
    const { nonce } = jsonOf(body.code);
    const idToken = `${base64Json({ alg: 'RS256', kid: 'made-up' })}.${base64Json({
        iss: 'https://appleid.apple.com', aud: env.APPLE_SERVICES_ID, sub: env.STANDIN_APPLE_SUB, nonce, iat: now, exp: now + 600, email: 'made-up@example.invalid',
    })}.made-up`;
    return Response.json({
        access_token: 'made-up-access', token_type: 'Bearer', expires_in: 3600, id_token: idToken, refresh_token: `made-up-refresh-${appleSeen.secrets}`,
    });
}

// A minute of build seconds this month for the account the stand-in's GitHub account or Apple ID signs in to.
async function addSeconds(env, provider) {
    const subject = provider === 'apple' ? env.STANDIN_APPLE_SUB : env.STANDIN_GITHUB_ID;
    await env.DB.prepare(`INSERT INTO build_usage (user_id, month, image, seconds) SELECT user_id, ?, 'web', 60 FROM identities
        WHERE provider = ? AND subject = ? AND unlinked_at IS NULL`).bind(new Date().toISOString().slice(0, 7), provider, subject).run();
    return new Response(null, { status: 204 });
}

export default {
    fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === '/__standin/apple') return Response.json(appleSeen);
        if (url.pathname === '/__standin/seconds' && request.method === 'POST') return addSeconds(env, url.searchParams.get('provider'));
        if (url.pathname === '/__standin/objects') return env.SNAPSHOTS.list({ prefix: url.searchParams.get('prefix') }).then(({ objects }) => Response.json({ count: objects.length }));
        return handleRequest(request, env, {
            limits: {
                api: env.API_LIMITER,
                login: env.LOGIN_LIMITER,
                runner: env.RUNNER_LIMITER,
                starts: env.STARTS_LIMITER,
                poll: env.POLL_LIMITER,
                code: env.CODE_LIMITER,
                snapshot: env.SNAPSHOT_LIMITER,
                upload: env.UPLOAD_LIMITER,
            },
            accounts: createAccounts(env.DB),
            devices: createDeviceCodes(env.DB),
            sessions: createProjectSessions(env.DB),
            snapshots: createSnapshots(env.DB, env.SNAPSHOTS),
            quota,
            compiler: { fetch: async () => Response.json({ error: 'This run has no compiler.' }, { status: 503 }) },
            fetcher: (url, init) => (url.startsWith('https://appleid.apple.com/') ? apple(url, init, env) : github(url, init, env)),
            waitUntil: (promise) => ctx.waitUntil(promise),
        });
    },
};
