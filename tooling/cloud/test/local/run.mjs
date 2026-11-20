// The account's page against a local Worker: `wrangler dev` of wrangler.jsonc beside this file, on a local D1 made for
// the run, and Chromium signing in on /login through stand-ins for GitHub's page and Apple's, signing devices out,
// signing out everywhere and deleting the account, while the site, an origin of the same site as the API's, is refused;
// then a first sign-in's question, linking and unlinking both ways, and an identity held with the day workerd words.
// Made-up accounts alone, and an Apple key made for the run; Chromium resolves no name but localhost, so nothing leaves
// this machine, a redirect included. Chromium comes from the workspace's Playwright.
// usage: node test/local/run.mjs
import { execFileSync, spawn } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
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
// The GitHub account the stand-in answers for, and Apple's Services ID (wrangler.jsonc).
const NAME = 'made_up_local';
const SERVICES_ID = 'dev.made-up.local';
const AUTHORIZE = Object.freeze({ github: 'https://github.com/login/oauth/authorize', apple: 'https://appleid.apple.com/auth/authorize' });
// A sign-in's start, a link, or a link's, a form of the page.
const SIGN_IN_STARTS = /^\/account\/(login|link)\/(github|apple)$|^\/playground\/login\/github$/;
const READY_MS = 60_000;

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
const POLICY = `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self' https://github.com https://appleid.apple.com ${SITE}; frame-ancestors 'none'; base-uri 'none'`;
// Apple's key for this run alone, and the public key its stand-in checks the client secret with.
const APPLE_KEYS = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const [APPLE_PRIVATE_KEY, APPLE_PUBLIC_KEY] = [
    Buffer.from(await webcrypto.subtle.exportKey('pkcs8', APPLE_KEYS.privateKey)).toString('base64'),
    Buffer.from(await webcrypto.subtle.exportKey('spki', APPLE_KEYS.publicKey)).toString('base64'),
];
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

// What the Worker sent each browser to GitHub and to Apple with.
const asked = { github: [], apple: [] };

// A browser of its own. The provider's sign-in page is played at the start of a sign-in or a link: the Worker's redirect
// to it is read, and the browser goes straight back to the callback it names, with a code that carries the challenge
// or the nonce, as the provider's page would after its user's yes. Playwright routes no redirect's target, so the start
// is where it can be played; a link's start, a form's POST, is sent with its Origin and the browser's cookies.
async function newBrowser(browser) {
    const context = await browser.newContext();
    await context.route((url) => url.origin === API && SIGN_IN_STARTS.test(url.pathname), async (route) => {
        const started = await route.fetch({ maxRedirects: 0 });
        const location = started.headers().location ? new URL(started.headers().location) : null;
        const provider = Object.keys(AUTHORIZE).find((name) => location && `${location.origin}${location.pathname}` === AUTHORIZE[name]);
        if (!provider) return route.fulfill({ response: started });
        asked[provider].push(location);
        const back = new URL(location.searchParams.get('redirect_uri'));
        back.searchParams.set('code', Buffer.from(JSON.stringify({ challenge: location.searchParams.get('code_challenge'), nonce: location.searchParams.get('nonce') })).toString('base64url'));
        back.searchParams.set('state', location.searchParams.get('state'));
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

// A click that leaves the page, and the notice the page it lands on shows from its cookie, if any.
async function submit(page, selector) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click(selector)]);
    const notice = page.locator('p.notice[role="status"]');
    return (await notice.count()) === 0 ? null : notice.textContent();
}

// The first of next month in words, as Node's own locale words it: the held identity's day, which the Worker words
// without a locale under workerd.
function firstOfNextMonth() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
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
    check('signed out, it offers to sign in with GitHub and with Apple', await page.isVisible('a:has-text("Sign in with GitHub")') && await page.isVisible('a:has-text("Sign in with Apple")'));

    const [kept, revoked] = [await cliSignIn(), await cliSignIn()];
    check('two machines signed in with crossbind login as the same GitHub account, whose account its route of before made at once', [kept, revoked].every((token) => /^cbt_/.test(token ?? '')) && await usage(kept) === 200);

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

    // The GitHub account's crossbind account is gone with no build seconds, so the GitHub account is new again.
    await page.goto(`${API}/login?next=playground`);
    await page.click('a:has-text("Sign in with GitHub")');
    await page.waitForSelector('.question');
    const question = await page.textContent('.question');
    await Promise.all([page.waitForURL((url) => url.href.startsWith(PLAYGROUND)), page.click('button:has-text("Make a new account")')]);
    const made = page.url();
    await page.goto(`${API}/playground/login/github`);
    await page.waitForURL((url) => url.href.startsWith(PLAYGROUND));
    check('the playground\'s Sign in: its page asks a first sign-in, Make a new account goes on to the playground, a form\'s redirect the policy lets out, and the start of before comes back to it',
        question.includes('No crossbind account signs in with this GitHub account yet.') && made === `${PLAYGROUND}#login=ok` && page.url() === `${PLAYGROUND}#login=ok`, `${made}, ${page.url()}`);

    await runApple(browser, page);

    const seen = await (await fetch(`${API}/__standin/apple`)).json();
    const github = asked.github.every((each) => `${each.origin}${each.pathname}` === AUTHORIZE.github
        && each.searchParams.get('redirect_uri') === `${API}/playground/callback/github` && each.searchParams.get('code_challenge_method') === 'S256' && !each.searchParams.has('scope'));
    const apple = asked.apple.every((each) => each.searchParams.get('client_id') === SERVICES_ID && each.searchParams.get('redirect_uri') === `${API}/playground/callback/apple`
        && each.searchParams.get('response_type') === 'code' && each.searchParams.get('response_mode') === 'query' && /^[A-Za-z0-9_-]{43}$/.test(each.searchParams.get('nonce') ?? '') && !each.searchParams.has('scope'));
    check('every sign-in and link went to its provider\'s page with the callback it lists and no scope, GitHub\'s with PKCE and Apple\'s in query mode with a nonce; each of Apple\'s codes was exchanged with a client secret its stand-in verified, and each refresh token revoked',
        github && apple && asked.apple.length > 0 && seen.secrets === asked.apple.length && seen.refused === 0 && new Set(seen.revoked).size === asked.apple.length,
        `${asked.github.length} to GitHub, ${asked.apple.length} to Apple, ${seen.secrets} secrets verified, ${seen.revoked.length} revoked`);
}

// Apple's part, after the GitHub account's own: `owner` is signed in to the account the GitHub account made from the
// playground.
async function runApple(browser, owner) {
    const apple = await newBrowser(browser);
    await apple.goto(`${API}/login`);
    await apple.click('a:has-text("Sign in with Apple")');
    await apple.waitForSelector('.question');
    const question = await apple.textContent('.question');
    await submit(apple, 'button:has-text("Make a new account")');
    const named = /Signed in as Apple account …\d{4}\./.exec(await apple.textContent('main'))?.[0];
    check('a first sign-in with Apple asks, and Make a new account makes an account named by the last four digits of its id',
        question.includes('No crossbind account signs in with this Apple ID yet.') && named !== undefined, named);

    // A browser of the same account whose link goes to GitHub's page itself: the policy lets the form's redirect leave
    // for it, and the resolver finds no name there, so nothing leaves this machine.
    const bare = await browser.newContext();
    await bare.addCookies(await apple.context().cookies());
    const leaving = await bare.newPage();
    const refusals = [];
    leaving.on('console', (message) => { if (/Content Security Policy/.test(message.text())) refusals.push(message.text()); });
    const failed = new Promise((resolve) => { leaving.on('requestfailed', (request) => { if (request.url().startsWith(AUTHORIZE.github)) resolve(request.failure()?.errorText); }); });
    await leaving.goto(`${API}/login`);
    await leaving.click('button:has-text("Link a GitHub account")');
    const left = await Promise.race([failed, new Promise((resolve) => { setTimeout(() => resolve('no request'), 5000); })]);
    await bare.close();
    check('a link\'s form leaves for the provider\'s page, a redirect its form-action lets out', left === 'net::ERR_NAME_NOT_RESOLVED' && refusals.length === 0, `${left}; ${refusals.join(' ')}`);

    const taken = await submit(apple, 'button:has-text("Link a GitHub account")');
    check('a GitHub account that signs in to another account does not link, and the page names that account',
        taken === `This GitHub account already signs in to another crossbind account (${NAME}). To link it here, sign in with it and delete that account, then link it again.`, taken);

    await owner.goto(`${API}/login`);
    await owner.check('input[name="confirm"]');
    await submit(owner, 'button:has-text("Delete account")');
    const linked = await submit(apple, 'button:has-text("Link a GitHub account")');
    check('once that account is deleted, the GitHub account links: one account with both, named by GitHub',
        linked === 'The GitHub account is linked: it signs in to this account too.' && (await apple.textContent('main')).includes(`Signed in as ${NAME}`) && await apple.locator('.sign-ins li').count() === 2, linked);

    const unlinked = await submit(apple, 'li:has-text("Apple ID") button:has-text("Unlink")');
    const other = await newBrowser(browser);
    await other.goto(`${API}/login`);
    await other.click('a:has-text("Sign in with Apple")');
    await other.waitForSelector('.question');
    await submit(other, 'a:has-text("I have an account with GitHub")');
    const offered = await other.isVisible('text=Link this Apple ID?');
    const linkedBack = await submit(other, 'button:has-text("Link it to this account")');
    check('an Apple ID unlinked with no build seconds is free at once: its next sign-in asks again, and the question\'s other answer, GitHub\'s sign-in, links it to the account',
        unlinked === 'The Apple ID is unlinked: it no longer signs in to this account.' && offered && linkedBack === 'The Apple ID is linked: it signs in to this account too.', `${unlinked}; ${linkedBack}`);

    await fetch(`${API}/__standin/seconds?provider=apple`, { method: 'POST' });
    await apple.goto(`${API}/login`);
    const held = await submit(apple, 'li:has-text("GitHub account") button:has-text("Unlink")');
    const elsewhere = await newBrowser(browser);
    await elsewhere.goto(`${API}/login`);
    const refused = await submit(elsewhere, 'a:has-text("Sign in with GitHub")');
    const day = firstOfNextMonth();
    check(`with build seconds this month, the unlinked GitHub account is held until ${day}: workerd words the day as Node's locale does`,
        held === `The GitHub account is unlinked. As this account has cloud build minutes this month, it signs in to nothing until ${day}, and can be linked back here before then.`
        && refused === `This GitHub account was unlinked from a crossbind account this month: it signs in again from ${day}, and can be linked back to that account now.`, `${held}; ${refused}`);

    const back = await submit(apple, 'button:has-text("Link a GitHub account")');
    check('the held GitHub account links back to the account it left', back === 'The GitHub account is linked: it signs in to this account too.', back);
}

const output = [];
let browser;
let dev;
try {
    execFileSync('pnpm', wranglerArgs(['d1', 'migrations', 'apply', 'DB', '--local']), { cwd: PACKAGE_DIR, env: wranglerEnv, stdio: 'inherit' });
    dev = spawn('pnpm', wranglerArgs(['dev', '--port', String(apiPort), '--var', `ALLOWED_ORIGINS:${SITE}`, '--var', `PLAYGROUND_URL:${PLAYGROUND}`,
        '--var', `APPLE_PRIVATE_KEY:${APPLE_PRIVATE_KEY}`, '--var', `STANDIN_APPLE_PUBLIC_KEY:${APPLE_PUBLIC_KEY}`]), {
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
