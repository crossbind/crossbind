// crossbind cloud as crossbind app preview asks it, on this machine and for one run alone: the made-up account the run
// signs in as, and the session the preview lists for it, each call recorded; and a home of the run's own, whose
// credentials sign in to it, so that no sign-in of this machine's is read or used.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ACCOUNT = Object.freeze({ id: '1099511627777', name: 'made-up-e2e' });
export const TOKEN = `cbt_${'e'.repeat(43)}`;
const SESSION = /^\/v1\/sessions\/[A-Za-z0-9_-]{22}$/;

export async function standInCloud() {
    const calls = [];
    const server = createServer((asked, answer) => {
        let text = '';
        asked.on('data', (chunk) => { text += chunk; });
        asked.on('end', () => {
            calls.push({ call: `${asked.method} ${asked.url}`, authorization: asked.headers.authorization, body: text ? JSON.parse(text) : undefined });
            const send = (status, body) => answer.writeHead(status, { 'content-type': 'application/json' }).end(body === undefined ? undefined : JSON.stringify(body));
            if (asked.headers.authorization !== `Bearer ${TOKEN}`) send(401, { error: 'Sign in with crossbind login.' });
            else if (asked.method === 'GET' && asked.url === '/v1/account') send(200, ACCOUNT);
            else if (asked.method === 'PUT' && SESSION.test(asked.url)) send(200, { id: asked.url.split('/').pop(), expiresAt: new Date(Date.now() + 600_000).toISOString() });
            else if (asked.method === 'DELETE' && SESSION.test(asked.url)) send(204);
            else send(404, { error: 'Not found.' });
        });
    });
    await new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', done);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const home = mkdtempSync(join(tmpdir(), 'crossbind-e2e-home-'));
    mkdirSync(join(home, '.crossbind'));
    writeFileSync(join(home, '.crossbind', 'credentials.json'), JSON.stringify({ [url]: { token: TOKEN, login: ACCOUNT.name } }));
    return {
        calls,
        // What crossbind app preview runs with: this cloud, and the home that signs in to it.
        env: { CROSSBIND_CLOUD_URL: url, HOME: home, USERPROFILE: home },
        close() {
            server.close();
            rmSync(home, { recursive: true, force: true });
        },
    };
}
