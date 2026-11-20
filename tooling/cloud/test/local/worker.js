// The Worker for test/local/run.mjs, under `wrangler dev` with no container (wrangler.jsonc beside it): worker/api.js
// on the run's local D1, with the quota in memory, no compiler, and a stand-in for GitHub that reaches nothing outside.
import { createAccounts } from '../../worker/accounts.js';
import { handleRequest } from '../../worker/api.js';
import { createQuota } from '../../worker/quota.js';
import { memoryStorage } from '../../scripts/memory-storage.mjs';

const DAY_MS = 24 * 3600 * 1000;
const quota = createQuota(memoryStorage());
const fromBase64Url = (text) => atob(text.replace(/-/g, '+').replace(/_/g, '/'));
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

export default {
    fetch(request, env, ctx) {
        return handleRequest(request, env, {
            limits: { api: env.API_LIMITER, login: env.LOGIN_LIMITER, runner: env.RUNNER_LIMITER },
            accounts: createAccounts(env.DB),
            quota,
            compiler: { fetch: async () => Response.json({ error: 'This run has no compiler.' }, { status: 503 }) },
            fetcher: (url, init) => github(url, init, env),
            waitUntil: (promise) => ctx.waitUntil(promise),
        });
    },
};
