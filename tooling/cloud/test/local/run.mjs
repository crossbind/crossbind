// The account's page against a local Worker: `wrangler dev` of wrangler.jsonc beside this file, on a local D1 made for
// the run, and Chromium signing in on /login through a stand-in for GitHub's page, signing devices out, signing out
// everywhere and deleting the account, while the site, an origin of the same site as the API's, is refused. Made-up
// accounts alone; Chromium resolves no name but localhost, so nothing leaves this machine, a redirect included.
// Chromium comes from the workspace's Playwright.
// usage: node test/local/run.mjs
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '../..');
const CONFIG = path.join(HERE, 'wrangler.jsonc');
// The GitHub account the stand-in answers for (wrangler.jsonc).
const NAME = 'made_up_local';
const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const SIGN_IN_STARTS = new Set(['/account/login/github', '/playground/login/github']);
const READY_MS = 60_000;
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const results = [];
function check(name, ok, detail) {
    results.push(ok);
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}\n`);
}

const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer().on('error', reject).listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => resolve(port));
    });
});
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const refOf = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16);

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cloud-local-'));
const [apiPort, sitePort] = [await freePort(), await freePort()];
const API = `http://localhost:${apiPort}`;
// The site, another origin of the API's own site as crossbind.dev is to api.crossbind.dev: the browser sends the API's
// cookie with its requests, and the Worker takes it for the playground (ALLOWED_ORIGINS) and for nothing of the account.
const SITE = `http://localhost:${sitePort}`;
const PLAYGROUND = `${SITE}/playground/`;
const wranglerArgs = (args) => ['exec', 'wrangler', ...args, '--config', CONFIG, '--persist-to', state];
const wranglerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

// /fetch.html: a JSON request, which the browser asks the Worker about first and it does not allow, then a plain one it
// sends unasked; /form.html: a form.
const SITE_PAGES = {
    '/playground/': '<!doctype html><title>playground</title>',
    '/fetch.html': `<!doctype html><title>site</title><script>
fetch('${API}/account/logout-everywhere', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then((answer) => 'read ' + answer.status, () => 'blocked')
    .then((outcome) => fetch('${API}/account/delete', { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'content-type': 'text/plain' }, body: 'confirm=yes' })
        .then(() => { document.title = outcome + ', sent'; }));
</script>`,
    '/form.html': `<!doctype html><title>site</title><form id="f" method="post" action="${API}/account/delete"><input name="confirm" value="yes"></form>
<script>document.getElementById('f').submit();</script>`,
};
const site = http.createServer((req, res) => {
    const page = SITE_PAGES[req.url];
    res.writeHead(page ? 200 : 404, { 'content-type': 'text/html' }).end(page ?? '');
});

async function ready(output) {
    const deadline = Date.now() + READY_MS;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${API}/login`)).ok) return;
        } catch {
            // Still starting.
        }
        await wait(500);
    }
    throw new Error(`wrangler dev did not answer on ${API}/login within ${READY_MS / 1000} s:\n${output.join('')}`);
}

// What the Worker sent each browser to GitHub with.
const githubAsked = [];

// A browser of its own. GitHub's sign-in page is played at the start of a sign-in: the Worker's redirect to it is read,
// and the browser goes straight back to the callback it names, with a code that carries the challenge, as GitHub's page
// would after its user's yes. Playwright routes no redirect's target, so the start is where it can be played.
async function newBrowser(browser) {
    const context = await browser.newContext();
    await context.route((url) => url.origin === API && SIGN_IN_STARTS.has(url.pathname), async (route) => {
        const started = await route.fetch({ maxRedirects: 0 });
        const asked = new URL(started.headers().location);
        githubAsked.push(asked);
        if (`${asked.origin}${asked.pathname}` !== GITHUB_AUTHORIZE) return route.fulfill({ response: started });
        const back = new URL(asked.searchParams.get('redirect_uri'));
        back.searchParams.set('code', Buffer.from(JSON.stringify({ challenge: asked.searchParams.get('code_challenge') })).toString('base64url'));
        back.searchParams.set('state', asked.searchParams.get('state'));
        return route.fulfill({ response: started, headers: { ...started.headers(), location: back.href } });
    });
    return context.newPage();
}

async function signIn(page) {
    await page.goto(`${API}/login`);
    await page.click('a:has-text("Sign in with GitHub")');
    const notice = await (await page.waitForSelector('[data-notice]:not([hidden])')).getAttribute('data-notice');
    if (notice !== 'login=ok') throw new Error(`signing in ended with ${notice} at ${page.url()}`);
}

const signedIn = async (page) => (await page.textContent('main')).includes(`Signed in as ${NAME}`);
const devices = (page) => page.locator('.devices li').count();

// crossbind login's two calls, by GitHub's device flow, which the stand-in approves at once.
async function cliSignIn() {
    const started = await (await fetch(`${API}/v1/login/device`, { method: 'POST' })).json();
    const answer = await fetch(`${API}/v1/login/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: started.deviceCode }) });
    return (await answer.json()).token;
}
const usage = async (token) => (await fetch(`${API}/v1/usage`, { headers: { authorization: `Bearer ${token}` } })).status;

async function run(browser) {
    const page = await newBrowser(browser);
    const first = await page.goto(`${API}/login`);
    const headers = first.headers();
    check('/login comes from the Worker with its policy', first.status() === 200 && headers['content-security-policy'] === POLICY
        && headers['referrer-policy'] === 'same-origin' && headers['x-content-type-options'] === 'nosniff' && headers['cache-control'] === 'no-store', headers['content-security-policy']);
    check('signed out, it offers to sign in with GitHub', await page.isVisible('a:has-text("Sign in with GitHub")'));

    const [kept, revoked] = [await cliSignIn(), await cliSignIn()];
    check('two machines signed in with crossbind login as the same GitHub account', [kept, revoked].every((token) => /^cbt_/.test(token ?? '')) && await usage(kept) === 200);

    await signIn(page);
    check('signed in through the stand-in for GitHub: the notice shown, the address cleared, the name and both devices listed',
        page.url() === `${API}/login` && await signedIn(page) && await devices(page) === 2, `${page.url()}, ${await devices(page)} devices`);

    await page.click(`li:has(input[value="${refOf(revoked)}"]) button`);
    await page.waitForFunction(() => document.querySelectorAll('.devices li').length === 1);
    check('a device signed out from the page: its token refused, the other kept', await usage(revoked) === 401 && await usage(kept) === 200);

    const other = await page.context().newPage();
    await other.goto(`${SITE}/fetch.html`);
    await other.waitForFunction(() => document.title.endsWith(', sent'));
    const fetched = await other.title();
    await Promise.all([other.waitForURL(`${API}/account/delete`), other.goto(`${SITE}/form.html`)]);
    const landed = await other.textContent('body');
    await page.goto(`${API}/login`);
    check('the site, another origin of the same site: its JSON request blocked, its plain request and its form refused, the account as it was',
        fetched === 'blocked, sent' && landed.includes('This is accepted from the account\'s page only.') && await signedIn(page) && await usage(kept) === 200, `${fetched}; ${landed}`);

    const second = await newBrowser(browser);
    await signIn(second);
    check('a second browser signed in to the same account', await signedIn(second));

    await page.click('button:has-text("Sign out everywhere")');
    await page.waitForSelector('[data-notice="signed-out-everywhere"]:not([hidden])');
    await second.goto(`${API}/login`);
    check('signed out everywhere: this browser, the other and the last device', !(await signedIn(page)) && !(await signedIn(second)) && await usage(kept) === 401);

    await signIn(page);
    await page.click('button:has-text("Delete account")');
    const heldUnticked = page.url() === `${API}/login` && await signedIn(page);
    await page.check('input[name="confirm"]');
    await page.click('button:has-text("Delete account")');
    await page.waitForSelector('[data-notice="deleted"]:not([hidden])');
    check('deleted from the page once its box is ticked, and this browser signed out', heldUnticked && !(await signedIn(page)));

    const back = [];
    for (const start of ['/account/login/github?next=playground', '/playground/login/github']) {
        await page.goto(`${API}${start}`);
        await page.waitForURL((url) => url.href.startsWith(PLAYGROUND));
        back.push(page.url());
    }
    check('the playground\'s sign-in, by the new start and by the one of before, comes back to the playground', back.every((url) => url === `${PLAYGROUND}#login=ok`), back.join(', '));
    check('every sign-in went to GitHub\'s page with the callback GitHub knows, PKCE and no scope', githubAsked.length === 5 && githubAsked.every((asked) => `${asked.origin}${asked.pathname}` === GITHUB_AUTHORIZE
        && asked.searchParams.get('redirect_uri') === `${API}/playground/callback/github` && asked.searchParams.get('code_challenge_method') === 'S256' && !asked.searchParams.has('scope')), `${githubAsked.length} sign-ins`);
}

const output = [];
let browser;
let dev;
try {
    execFileSync('pnpm', wranglerArgs(['d1', 'migrations', 'apply', 'DB', '--local']), { cwd: PACKAGE_DIR, env: wranglerEnv, stdio: 'inherit' });
    dev = spawn('pnpm', wranglerArgs(['dev', '--port', String(apiPort), '--var', `ALLOWED_ORIGINS:${SITE}`, '--var', `PLAYGROUND_URL:${PLAYGROUND}`]), {
        cwd: PACKAGE_DIR, env: wranglerEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    dev.stdout.on('data', (chunk) => output.push(chunk.toString()));
    dev.stderr.on('data', (chunk) => output.push(chunk.toString()));
    await new Promise((resolve) => { site.listen(sitePort, '127.0.0.1', resolve); });
    await ready(output);
    browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost'] });
    await run(browser);
} finally {
    await browser?.close();
    site.close();
    if (dev) process.kill(-dev.pid, 'SIGTERM');
    fs.rmSync(state, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
process.stdout.write(`${passed}/${results.length} checks pass\n`);
process.exitCode = results.length > 0 && passed === results.length ? 0 : 1;
