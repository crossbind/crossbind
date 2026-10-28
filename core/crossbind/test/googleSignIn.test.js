import http from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The browser, which Google's sign-in page opens in once crossbind hands it the page's address.
let onOpen;
vi.mock('../src/utils/openUrl.js', () => ({ default: (url) => onOpen(url) }));

const { accessToken, signIn } = await import('../src/actions/googleSignIn.js');

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
// Google's token endpoint: the grants crossbind sends it, and its answer to them.
let grants;
let answer;

const opened = () => new Promise((resolve) => {
    onOpen = (url) => resolve(new URL(url).searchParams);
});
// The browser coming back to crossbind's port, as Google's page sends it.
const visit = (url) => new Promise((resolve, reject) => {
    http.get(url, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
            body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
});
const fields = (params, names) => Object.fromEntries(names.map((name) => [name, params.get(name)]));

beforeEach(() => {
    grants = [];
    answer = () => json(200, { access_token: 'access', refresh_token: 'refresh', scope: SCOPE, expires_in: 3599 });
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        grants.push({ url, grant: new URLSearchParams(String(init.body)) });
        return answer();
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a Google sign-in', () => {
    test("goes through the user's browser to a port of this machine, and trades the code for tokens with PKCE", async () => {
        const page = opened();
        const tokens = signIn(SCOPE);
        const query = await page;
        expect(fields(query, ['response_type', 'scope', 'code_challenge_method', 'prompt'])).toEqual({
            response_type: 'code', scope: SCOPE, code_challenge_method: 'S256', prompt: 'select_account',
        });
        expect(query.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(await visit(`${query.get('redirect_uri')}/?state=${query.get('state')}&code=the-code&scope=${SCOPE}`))
            .toEqual({ status: 200, body: 'crossbind is signed in. Close this tab and go back to the terminal.' });
        expect(await tokens).toMatchObject({ access_token: 'access', refresh_token: 'refresh', scope: SCOPE });

        const [{ url, grant }] = grants;
        expect(url).toBe('https://oauth2.googleapis.com/token');
        expect(fields(grant, ['grant_type', 'code', 'redirect_uri', 'client_id'])).toEqual({
            grant_type: 'authorization_code', code: 'the-code', redirect_uri: query.get('redirect_uri'), client_id: query.get('client_id'),
        });
        expect(grant.get('client_secret')).toBeTruthy();
        expect(createHash('sha256').update(grant.get('code_verifier')).digest('base64url')).toBe(query.get('code_challenge'));
    });

    test("turns away what is not Google's answer to it, and ends when the user cancels on Google's page", async () => {
        const page = opened();
        const tokens = signIn(SCOPE);
        const query = await page;
        expect((await visit(`${query.get('redirect_uri')}/favicon.ico`)).status).toBe(400);
        expect((await visit(`${query.get('redirect_uri')}/?state=another&code=forged`)).status).toBe(400);

        const failure = expect(tokens).rejects.toThrow("crossbind: Google's sign-in ended with access_denied.");
        expect(await visit(`${query.get('redirect_uri')}/?state=${query.get('state')}&error=access_denied`))
            .toEqual({ status: 200, body: 'crossbind is not signed in. Go back to the terminal.' });
        await failure;
        expect(grants).toEqual([]);
    });
});

describe("a Google sign-in's refresh token", () => {
    test("buys an hour's access token, and names Google's reason when it is refused", async () => {
        expect(await accessToken('refresh')).toBe('access');
        expect(fields(grants[0].grant, ['grant_type', 'refresh_token'])).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh' });
        answer = () => json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        await expect(accessToken('revoked')).rejects.toMatchObject({
            reason: 'invalid_grant', message: "crossbind: Google refused crossbind's sign-in: 400 invalid_grant Token has been expired or revoked.",
        });
    });
});
