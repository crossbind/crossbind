// The account's pages against a local Worker: `wrangler dev` of wrangler.jsonc beside this file, on a local D1 made for
// the run, and Chromium signing in on /login through stand-ins for GitHub's page and Apple's, signing devices out,
// signing out everywhere and deleting the account, while the site, an origin of the same site as the API's, is refused;
// a device's sign-in on /device, by scripts/device-check.mjs playing the app and by crossbind login's own code, each
// typing the number read off the page; then a first sign-in's question; a session crossbind app preview lists, which
// scripts/session-check.mjs, playing the app of two accounts, finds for its own and not for the other; a snapshot crossbind
// app preview --cloud uploads into a local bucket, which scripts/snapshot-check.mjs opens through the snapshot host and
// finds its caps held, and which the account's deletion takes; linking and unlinking both ways, and an identity held with
// the day workerd words. Made-up accounts alone, and an Apple key made
// for the run; Chromium resolves no name but localhost, and wrangler is asked for no Cloudflare request details from
// outside, so nothing leaves this machine, a redirect included. Chromium comes from the workspace's Playwright.
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
import { login as cliLogin } from '../../../../core/crossbind/src/actions/cloudCommands.js';
import { halfBlocks, qrMatrix } from '../../../../core/crossbind/src/utils/qrMatrix.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, '../..');
const CONFIG = path.join(HERE, 'wrangler.jsonc');
const CLI = path.resolve(PACKAGE_DIR, '../../core/crossbind/src/cli.js');
// The GitHub account the stand-in answers for, and Apple's Services ID (wrangler.jsonc).
const NAME = 'made_up_local';
const SERVICES_ID = 'dev.made-up.local';
const AUTHORIZE = Object.freeze({ github: 'https://github.com/login/oauth/authorize', apple: 'https://appleid.apple.com/auth/authorize' });
// A sign-in's start, a link, or a link's, a form of the page.
const SIGN_IN_STARTS = /^\/account\/(login|link)\/(github|apple)$/;
const READY_MS = 60_000;
const CROSSBIND_VERSION = JSON.parse(fs.readFileSync(path.resolve(PACKAGE_DIR, '../../core/crossbind/package.json'), 'utf8')).version;
// The country wrangler dev gives every request when it asks Cloudflare for nothing: Miniflare's made-up one, US.
const COUNTRY_NAME = 'United States';

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
// The snapshot host, another name of the same Worker (wrangler.jsonc SNAPSHOTS_HOST).
const SNAPSHOTS = `http://127.0.0.1:${apiPort}`;
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
// Without CLOUDFLARE_CF_FETCH_ENABLED=false, wrangler dev asks Cloudflare for the request details it gives the Worker,
// this machine's country among them; with it, Miniflare's made-up ones.
const wranglerEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' };

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
    // The approval of the code its address names: as JSON, which the browser asks the Worker about first, then as
    // plain text, sent unasked.
    '/approve.html': `<!doctype html><title>site</title><script>
const body = JSON.stringify({ user_code: location.hash.slice(1), approve: true });
fetch('${API}/account/device/approve', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body })
    .then((answer) => 'read ' + answer.status, () => 'blocked')
    .then((outcome) => fetch('${API}/account/device/approve', { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'content-type': 'text/plain' }, body })
        .then(() => { document.title = outcome + ', sent'; }));
</script>`,
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

const post = async (route, body) => (await fetch(`${API}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const APP = {
    client: 'app', version: '1.0.0', platform: 'ios', os: '27.1',
};

async function until(read, ms = 30_000) {
    const deadline = Date.now() + ms;
    for (let value = read(); Date.now() < deadline; value = read()) {
        if (value) return value;
        await wait(100);
    }
    throw new Error(`waited ${ms / 1000} s in vain`);
}

// How long a device's step waits for the page or a client before its check fails.
const STEP_MS = 15_000;

// A check whose steps may throw: what threw fails it, with its first line, and the run goes on.
async function step(name, run) {
    try {
        const { ok, detail } = await run();
        check(name, ok, detail);
    } catch (error) {
        check(name, false, error.message.split('\n')[0]);
    }
}

// A code entered on the device page as its person types it, then approved or denied there: the words the page shows of
// what asked, what it says after, and the number it shows once approved.
async function decideOnPage(page, typed, approve = true) {
    await page.goto(`${API}/device`);
    await page.fill('#user-code', typed, { timeout: STEP_MS });
    await page.click('button:has-text("Continue")');
    await page.waitForSelector('#device-asked:not([hidden])', { timeout: STEP_MS });
    const words = await page.textContent('#device-words');
    await page.click(`#device-asked button:has-text("${approve ? 'Approve' : 'Deny'}")`);
    const said = await (await page.waitForSelector('#device-said:not([hidden])', { timeout: STEP_MS })).textContent();
    // Decided, the page shows what it said alone: the code's field and the question go.
    const ended = await page.isHidden('#device-code') && await page.isHidden('#device-asked');
    return {
        words, said, ended, number: Number(/^Type (\d{2}) on your device\. It gets one try\.$/.exec(said)?.[1]),
    };
}

// scripts/device-check.mjs playing the app: the code it prints entered on the page, and the number read there typed into
// it once it asks.
async function deviceCheck(page) {
    const checker = spawn(process.execPath, [path.join(PACKAGE_DIR, 'scripts/device-check.mjs'), '--url', API], { stdio: ['pipe', 'pipe', 'pipe'] });
    let printed = '';
    checker.stdout.on('data', (chunk) => { printed += chunk; });
    checker.stderr.on('data', (chunk) => { printed += chunk; });
    const exited = new Promise((resolve) => { checker.on('close', resolve); });
    try {
        const shown = await until(() => /enter the code ([A-Z]{4}-[A-Z]{4})/.exec(printed)?.[1], STEP_MS);
        const app = await decideOnPage(page, ` ${shown.toLowerCase().replace('-', ' ')} `);
        await until(() => printed.includes('type it here'), STEP_MS);
        checker.stdin.end(`${app.number}\n`);
        const status = await exited;
        // An answer piped in is not echoed, so the check after the question shares its line.
        const passes = printed.match(/(?:PASS|FAIL) [^\n]*/g) ?? [];
        return {
            ok: status === 0 && app.ended && app.words === `The crossbind app 0.0.0 on macOS 0.0 asked just now, from ${COUNTRY_NAME}, to sign in as ${NAME}.`
                && passes.length === 4 && passes.every((line) => line.startsWith('PASS')),
            detail: `${app.words} ${app.said} ${passes.join('; ')}`,
        };
    } finally {
        checker.kill();
    }
}

// crossbind login's own code, its question answered with the number read off the page, its credentials where a machine
// of the home given keeps them. Answers its token too.
async function cliSignInOnPage(page, given) {
    const home = given ?? fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cloud-local-cli-'));
    try {
        const credentials = path.join(home, '.crossbind', 'credentials.json');
        let printed = '';
        let typeNumber;
        const typed = new Promise((resolve) => { typeNumber = resolve; });
        const signingIn = cliLogin({
            url: API, version: CROSSBIND_VERSION, file: credentials, print: (line) => { printed += `${line}\n`; }, ask: async () => String(await typed), isTerminal: () => true,
        });
        // A step that fails leaves the sign-in polling until the Worker stops: its end is no part of the run then.
        signingIn.catch(() => {});
        const code = await until(() => /enter the code ([A-Z]{4}-[A-Z]{4})/.exec(printed)?.[1], STEP_MS);
        const cli = await decideOnPage(page, code);
        typeNumber(cli.number);
        const { login } = await signingIn;
        const token = JSON.parse(fs.readFileSync(credentials, 'utf8'))[API].token;
        return {
            token, ok: login === NAME && cli.words.startsWith(`The crossbind CLI ${CROSSBIND_VERSION} asked`) && await usage(token) === 200, detail: `${printed.trim()} ${cli.words}`,
        };
    } finally {
        if (!given) fs.rmSync(home, { recursive: true, force: true });
    }
}

// A project for crossbind app preview whose Vite stands in for one: it says it runs, and runs until a signal ends it;
// asked to build, it writes a web build of three files, one of them empty.
function previewProject() {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cloud-local-project-'));
    const vite = path.join(project, 'node_modules', 'vite');
    fs.mkdirSync(path.join(vite, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
        name: 'made-up-app', version: '1.0.0', type: 'module', devDependencies: { '@crossbind/core-app-host': '*' },
    }));
    fs.writeFileSync(path.join(project, 'crossbind.config.mjs'), 'export default {};\n');
    fs.writeFileSync(path.join(vite, 'package.json'), JSON.stringify({ name: 'vite', version: '8.3.8', bin: { vite: 'bin/vite.js' } }));
    fs.writeFileSync(path.join(vite, 'bin', 'vite.js'), `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'build') {
    const out = args[args.indexOf('--outDir') + 1];
    fs.mkdirSync(out + '/assets', { recursive: true });
    fs.writeFileSync(out + '/index.html', '<!doctype html><title>made-up snapshot</title><script type="module" src="/assets/app.js"></script>');
    fs.writeFileSync(out + '/assets/app.js', 'console.log("made up");');
    fs.writeFileSync(out + '/empty.txt', '');
} else {
    console.log('VITE running');
    setInterval(() => {}, 1000);
}
`);
    return project;
}

// A child's output as it comes, and a wait for it to match.
function outputOf(child) {
    const said = { text: '' };
    child.stdout.on('data', (chunk) => { said.text += chunk; });
    child.stderr.on('data', (chunk) => { said.text += chunk; });
    return said;
}

// crossbind app preview, signed in on the device page as `owner`'s account, lists its session with this Worker; then
// scripts/session-check.mjs plays the crossbind app of that account and of `other`'s, approving each code on its page:
// the first lists the session with its key, the second lists nothing of it, and a Ctrl-C to the preview takes it off.
// No address or key of the session is printed.
async function runSessions(owner, other) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cloud-local-preview-'));
    const project = previewProject();
    let preview;
    let previewEnded;
    let link;
    try {
        await step('crossbind app preview, signed in with crossbind login on the device page, lists its session with the Worker and draws its link as a QR code', async () => {
            const signed = await cliSignInOnPage(owner, home);
            if (!signed.ok) return signed;
            preview = spawn(process.execPath, [CLI, 'app', 'preview'], {
                cwd: project, env: { ...process.env, HOME: home, USERPROFILE: home, CROSSBIND_CLOUD_URL: API, NO_COLOR: '1' }, detached: true,
            });
            previewEnded = new Promise((resolve) => { preview.on('exit', resolve); });
            const said = outputOf(preview);
            await until(() => said.text.includes('VITE running') || preview.exitCode !== null, 30_000);
            link = /scan this with a phone's camera, or open (https:\/\/crossbind\.dev\/open\/\?s=[A-Za-z0-9_-]{22})\n/.exec(said.text)?.[1];
            const drawn = said.text.split('\n').filter((line) => /^ {2}[ █▀▄]+$/.test(line)).map((line) => line.slice(2));
            return {
                ok: said.text.includes(`signed in to crossbind cloud as ${NAME}`) && link !== undefined && JSON.stringify(drawn) === JSON.stringify(halfBlocks(qrMatrix(link).modules)),
                detail: link ? `${link.replace(/[A-Za-z0-9_-]{22}$/, '<session>')}, ${drawn.length} lines of half blocks` : said.text.split('\n').find((line) => line.startsWith('crossbind:')),
            };
        });

        await step('scripts/session-check.mjs, playing the crossbind app, finds the session for the preview\'s account with its key, nothing of it for another account, and it gone once a Ctrl-C ends the preview', async () => {
            const checker = spawn(process.execPath, [path.join(PACKAGE_DIR, 'scripts/session-check.mjs'), '--url', API, '--session', link], { stdio: ['pipe', 'pipe', 'pipe'] });
            const said = outputOf(checker);
            const exited = new Promise((resolve) => { checker.on('close', resolve); });
            try {
                for (const [at, page] of [[0, owner], [1, other]]) {
                    const code = await until(() => [...said.text.matchAll(/enter the code ([A-Z]{4}-[A-Z]{4})/g)][at]?.[1], STEP_MS);
                    const decided = await decideOnPage(page, code);
                    await until(() => said.text.split('type it here').length > at + 1, STEP_MS);
                    checker.stdin.write(`${decided.number}\n`);
                }
                await until(() => said.text.includes('stop crossbind app preview with Ctrl-C'), STEP_MS);
                process.kill(-preview.pid, 'SIGINT');
                const ended = await previewEnded;
                checker.stdin.end('\n');
                const status = await exited;
                const passes = said.text.match(/(?:PASS|FAIL) [^\n]*/g) ?? [];
                return { ok: ended === 130 && status === 0 && passes.length === 4 && passes.every((line) => line.startsWith('PASS')), detail: `preview ended ${ended}; ${passes.join('; ')}` };
            } finally {
                checker.kill();
            }
        });
    } finally {
        if (preview?.exitCode === null) process.kill(-preview.pid, 'SIGKILL');
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(project, { recursive: true, force: true });
    }
}

// crossbind app preview --cloud, signed in on the device page as `owner`'s account, uploads the web build a Vite standing
// in for one writes into the Worker's local bucket, and draws its link as a QR code; then scripts/snapshot-check.mjs,
// whose two codes the same page approves, opens it through the snapshot host as the crossbind app does, and finds the
// caps held. Every write of the bucket is workerd's own.
async function runSnapshots(owner) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cloud-local-snapshot-'));
    const project = previewProject();
    let link;
    try {
        await step('crossbind app preview --cloud, signed in with crossbind login on the device page, uploads the web build as a snapshot and draws its link as a QR code', async () => {
            const signed = await cliSignInOnPage(owner, home);
            if (!signed.ok) return signed;
            const preview = spawn(process.execPath, [CLI, 'app', 'preview', '--cloud'], {
                cwd: project, env: { ...process.env, HOME: home, USERPROFILE: home, CROSSBIND_CLOUD_URL: API, NO_COLOR: '1' },
            });
            const said = outputOf(preview);
            const status = await new Promise((resolve) => { preview.on('close', resolve); });
            link = /scan this with a phone's camera, or open (https:\/\/crossbind\.dev\/open\/\?s=[A-Za-z0-9_-]{22})\n/.exec(said.text)?.[1];
            const kept = /uploaded as a snapshot, version 1, kept until (\d{1,2} [A-Z][a-z]+ \d{4})\n/.exec(said.text)?.[1];
            const drawn = said.text.split('\n').filter((line) => /^ {2}[ █▀▄]+$/.test(line)).map((line) => line.slice(2));
            return {
                ok: status === 0 && kept !== undefined && link !== undefined && JSON.stringify(drawn) === JSON.stringify(halfBlocks(qrMatrix(link).modules)),
                detail: link ? `version 1, kept until ${kept}; ${link.replace(/[A-Za-z0-9_-]{22}$/, '<session>')}, ${drawn.length} lines of half blocks` : said.text.split('\n').find((line) => line.startsWith('crossbind:')),
            };
        });

        await step('scripts/snapshot-check.mjs, playing the CLI and the crossbind app, opens it through the snapshot host with its key\'s token alone, and finds the caps held: one of 50 MB and one of 500 files taken, 413 past either, the snapshot before kept', async () => {
            const checker = spawn(process.execPath, [path.join(PACKAGE_DIR, 'scripts/snapshot-check.mjs'), '--url', API, '--snapshots', SNAPSHOTS, '--session', link], { stdio: ['pipe', 'pipe', 'pipe'] });
            const said = outputOf(checker);
            const exited = new Promise((resolve) => { checker.on('close', resolve); });
            try {
                for (const at of [0, 1]) {
                    const code = await until(() => [...said.text.matchAll(/enter the code ([A-Z]{4}-[A-Z]{4})/g)][at]?.[1], STEP_MS);
                    const decided = await decideOnPage(owner, code);
                    await until(() => said.text.split('type it here').length > at + 1, STEP_MS);
                    checker.stdin.write(`${decided.number}\n`);
                }
                const status = await exited;
                const passes = said.text.match(/(?:PASS|FAIL) [^\n]*/g) ?? [];
                return { ok: status === 0 && passes.length === 8 && passes.every((line) => line.startsWith('PASS')), detail: passes.join('; ') };
            } catch (error) {
                throw new Error(`${error.message}; the check's last words: ${said.text.trim().split('\n').at(-1)}`);
            } finally {
                checker.kill();
            }
        });
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(project, { recursive: true, force: true });
    }
}

// How many objects the local bucket holds under the snapshots' prefix.
const snapshotObjects = async () => (await (await fetch(`${API}/__standin/objects?prefix=snapshots/`)).json()).count;

// A device's sign-in, approved on the device page by `page`, signed in to the stand-in's account: the app played by
// scripts/device-check.mjs, which reads the number from its input, and the CLI by crossbind login's own code; a denial;
// the site refused; and the device page's own sign-in. Answers the CLI's token.
async function runDevice(browser, page) {
    await step('scripts/device-check.mjs, playing the app, signs in through the device page: its code typed in lower case with spaces, what asked named with its country, and the number read off the page typed into it',
        () => deviceCheck(page));

    let cliToken;
    await step('crossbind login\'s own code signs in through the same page, which names the CLI', async () => {
        const signed = await cliSignInOnPage(page);
        cliToken = signed.token;
        return signed;
    });

    await step('a code denied on the page ends for its device', async () => {
        const denied = await post('/v1/device/authorize', APP);
        const deny = await decideOnPage(page, denied.user_code, false);
        const after = await post('/v1/device/token', { device_code: denied.device_code });
        return { ok: deny.said === 'Denied. That code no longer works.' && deny.ended && after.error === 'access_denied', detail: `${deny.said} ${after.error}` };
    });

    await step('the site, another origin of the same site, approves no code: its JSON request blocked and its plain request refused, the code still waiting for the page', async () => {
        const waiting = await post('/v1/device/authorize', APP);
        const site = await page.context().newPage();
        await site.goto(`${SITE}/approve.html#${waiting.user_code}`);
        await site.waitForFunction(() => document.title.endsWith(', sent'), null, { timeout: STEP_MS });
        const fetched = await site.title();
        await site.close();
        const still = await decideOnPage(page, waiting.user_code);
        return { ok: fetched === 'blocked, sent' && Number.isInteger(still.number), detail: `${fetched}; ${still.said}` };
    });

    await step('signed out, the device page signs in and comes back to itself, signed in', async () => {
        const fresh = await newBrowser(browser);
        try {
            await fresh.goto(`${API}/device`);
            await fresh.click('a:has-text("Sign in with GitHub")');
            await fresh.waitForSelector('[data-notice="login=ok"]:not([hidden])', { timeout: STEP_MS });
            return { ok: fresh.url() === `${API}/device` && (await fresh.textContent('main')).includes(`Signed in as ${NAME}`), detail: fresh.url() };
        } finally {
            await fresh.context().close();
        }
    });
    return cliToken;
}

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

    const cliToken = await runDevice(browser, page);
    await page.goto(`${API}/login`);

    await page.click('button:has-text("Sign out everywhere")');
    await page.waitForSelector('[data-notice="signed-out-everywhere"]:not([hidden])');
    await second.goto(`${API}/login`);
    check('signed out everywhere: this browser, the other, the last device and the one crossbind login signed in on the device page',
        !(await signedIn(page)) && !(await signedIn(second)) && await usage(kept) === 401 && await usage(cliToken) === 401);

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
    const before = await page.goto(`${API}/playground/login/github`);
    check('the playground\'s Sign in: its page asks a first sign-in, Make a new account goes on to the playground, a form\'s redirect the policy lets out, and the start of before is gone',
        question.includes('No crossbind account signs in with this GitHub account yet.') && made === `${PLAYGROUND}#login=ok` && before.status() === 404, `${made}, ${before.status()}`);

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

    // Two accounts now, unlinked: the GitHub account's and the Apple ID's.
    await runSessions(owner, apple);
    await runSnapshots(owner);
    await apple.goto(`${API}/login`);

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
    const objectsBefore = await snapshotObjects();
    await submit(owner, 'button:has-text("Delete account")');
    const objectsAfter = await snapshotObjects();
    check('deleting the account deletes its snapshots\' files in the bucket at once', objectsBefore > 0 && objectsAfter === 0, `${objectsBefore} objects before, ${objectsAfter} after`);
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
