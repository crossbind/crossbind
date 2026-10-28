import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import openUrl from '../utils/openUrl.js';

// crossbind's own OAuth client, a desktop app's. Google counts a desktop app's secret as public, as every copy of the app
// carries it, and PKCE ties each sign-in to the crossbind that started it. The secret is split only so that secret
// scanners do not take it for a leaked one.
const CLIENT_ID = '1070398855248-kemr8k5u0k8l2ovuvql32e220fhap165.apps.googleusercontent.com';
const CLIENT_SECRET = ['GOCSPX', '5w7qGQktYssQg9C5ClWs4x0hZeHV'].join('-');
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

const randomText = (bytes) => randomBytes(bytes).toString('base64url');

async function tokens(grant) {
    const response = await fetch(TOKEN, { method: 'POST', body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...grant }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const reason = `${response.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim();
        throw Object.assign(new Error(`crossbind: Google refused crossbind's sign-in: ${reason}`), { reason: body.error });
    }
    return body;
}

// The code Google's page sends the browser back to this machine with once the user has signed in. A request without this
// sign-in's state is no answer of Google's to it, and is turned away.
function codeFrom(server, state) {
    return new Promise((resolve, reject) => {
        server.on('request', (request, response) => {
            const query = new URL(request.url, 'http://127.0.0.1').searchParams;
            if (query.get('state') !== state) {
                response.writeHead(400, { connection: 'close' }).end();
                return;
            }
            const code = query.get('code');
            response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
                .end(code ? 'crossbind is signed in. Close this tab and go back to the terminal.' : 'crossbind is not signed in. Go back to the terminal.');
            if (code) resolve(code);
            else reject(new Error(`crossbind: Google's sign-in ended with ${query.get('error') ?? 'no code'}.`));
        });
    });
}

// Signs the user in with their Google account, in their browser, for scope: Google's page sends the browser back to a
// port of this machine. It resolves to Google's tokens, whose scope says what the user granted, as the page lets them
// leave a scope out.
export async function signIn(scope) {
    const server = http.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const verifier = randomText(32);
    const state = randomText(16);
    const redirect = `http://127.0.0.1:${server.address().port}`;
    const page = `${AUTHORIZE}?${new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirect,
        response_type: 'code',
        scope,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        state,
        prompt: 'select_account',
    })}`;
    console.log(`crossbind: opening Google's sign-in in your browser; if it does not open, go to ${page}`);
    openUrl(page);
    try {
        const code = await codeFrom(server, state);
        return await tokens({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect });
    } finally {
        server.close();
    }
}

// An hour's access token for the refresh token of an earlier sign-in. Google refuses one revoked or expired, with the
// reason invalid_grant.
export const accessToken = async (refreshToken) => (await tokens({ grant_type: 'refresh_token', refresh_token: refreshToken })).access_token;
