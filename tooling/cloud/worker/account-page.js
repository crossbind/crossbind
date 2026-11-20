import {
    ACCOUNT_BLOCKED, DEVICE_REF_LENGTH, dayWords, nameOf, userKey,
} from './accounts.js';
import { typedCode } from './devices.js';
import {
    BodyTooLarge, SECURITY_HEADERS, jsonResponse, log, readLimited,
} from './http.js';
import {
    minAccountDays, returnPage, signedInPage, signInProviders, startLogin,
} from './oauth.js';
import {
    clearCookie, noticeCookie, readNotice, readPending, readSignedIn, sessionCookie, signSession, NOTICE_COOKIE, PENDING_COOKIE, SESSION_COOKIE, SESSION_TTL_MS,
} from './session.js';

// The account's own pages on this API's origin, /login and the device page /device, and the routes under /account/ that
// their forms and script post to. Those take a request from this origin alone, so no other site, crossbind.dev
// included, can change an account or approve a device through them.

const MAX_FORM_BYTES = 1024;
const MAX_ENTRY_BYTES = 256;
const NO_DEVICE = 'No device is waiting for this code: check it, or start again on the device.';
const ENTER_CODE = 'Enter the eight letters your device shows.';
const DEVICE_REF = new RegExp(`^[0-9a-f]{${DEVICE_REF_LENGTH}}$`);
// same-origin and not no-referrer: a form's POST from a no-referrer page carries `Origin: null`, which the origin rule
// refuses. Chromium holds a form's POST whose redirect leaves `form-action`: linking goes on to the providers, and
// making an account to the playground, so their origins are listed.
const FORM_TARGETS = Object.freeze(["'self'", 'https://github.com', 'https://appleid.apple.com']);
const pageHeaders = (env) => ({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action ${[...FORM_TARGETS, URL.parse(env.PLAYGROUND_URL ?? '')?.origin].filter(Boolean).join(' ')}; frame-ancestors 'none'; base-uri 'none'`,
    'referrer-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
});

// What the page was sent back with: a sign-in's `#login=<result>`, or what one of its forms did.
const notices = (env) => ({
    'login=ok': 'Signed in.',
    'login=failed': 'Signing in did not work; try again.',
    'login=cancelled': 'Signing in was cancelled.',
    'login=too-new': `This GitHub account is too new; accounts can sign in ${minAccountDays(env)} days after they were created.`,
    'login=blocked': ACCOUNT_BLOCKED,
    'signed-out-everywhere': 'Every device and every browser is signed out of the account, this one included.',
    waited: 'That sign-in waited over ten minutes for an answer; sign in again.',
    deleted: 'Your crossbind account is deleted, and every device is signed out of it.',
});

const PROVIDER_NAMES = Object.freeze({ github: 'GitHub', apple: 'Apple' });
const IDENTITY_WORDS = Object.freeze({ github: 'GitHub account', apple: 'Apple ID' });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTICE_NAME = 80;

// The words of a notice that came in its cookie (session.js), which any browser can make up for itself: each is checked
// before it is worded, and a notice that does not check out shows nothing.
const SAID = Object.freeze({
    held: ({ provider, day }) => `This ${IDENTITY_WORDS[provider]} was unlinked from a crossbind account this month: it signs in again from ${dayWords(day)}, and can be linked back to that account now.`,
    'link-linked': ({ provider }) => `The ${IDENTITY_WORDS[provider]} is linked: it signs in to this account too.`,
    'link-already': ({ provider }) => `This ${IDENTITY_WORDS[provider]} already signs in to this account.`,
    'link-has-one': ({ provider, name }) => (provider === 'github' ? `This account already has a GitHub account linked (${name}): unlink it first.` : 'This account already has an Apple ID linked: unlink it first.'),
    'link-taken': ({ provider, name }) => `This ${IDENTITY_WORDS[provider]} already signs in to another crossbind account (${name}). To link it here, sign in with it and delete that account, then link it again.`,
    'link-held': ({ provider, day }) => `This ${IDENTITY_WORDS[provider]} belonged to another crossbind account this month: it can be linked here from ${dayWords(day)}.`,
    'link-too-new': (notice, env) => `This GitHub account is too new: it can be linked ${minAccountDays(env)} days after it was created.`,
    'link-blocked': ({ provider }) => `This ${IDENTITY_WORDS[provider]} may not use crossbind cloud.`,
    'link-failed': () => 'Linking did not work; try again.',
    unlinked: ({ provider }) => `The ${IDENTITY_WORDS[provider]} is unlinked: it no longer signs in to this account.`,
    'unlinked-held': ({ provider, day }) => `The ${IDENTITY_WORDS[provider]} is unlinked. As this account has cloud build minutes this month, it signs in to nothing until ${dayWords(day)}, and can be linked back here before then.`,
});
const NEEDS = Object.freeze({
    held: ['day'], 'link-held': ['day'], 'unlinked-held': ['day'], 'link-taken': ['name'],
});

function wordsOf(notice, env) {
    const word = Object.hasOwn(SAID, notice?.said ?? '') ? SAID[notice.said] : null;
    if (!word || !Object.hasOwn(IDENTITY_WORDS, notice.provider ?? '')) return null;
    const fits = {
        day: DAY.test(notice.day ?? ''),
        name: typeof notice.name === 'string' && notice.name.length <= MAX_NOTICE_NAME,
    };
    if ((NEEDS[notice.said] ?? []).some((field) => !fits[field]) || (notice.name !== undefined && !fits.name)) return null;
    return word(notice, env);
}

// The pages' one script: the notice the address names, and the device page's steps, whose words it writes as text.
const SCRIPT = `const shown = [...document.querySelectorAll('[data-notice]')].find((notice) => '#' + notice.dataset.notice === location.hash);
if (shown) {
    shown.hidden = false;
    history.replaceState(null, '', location.pathname + location.search);
}

const entry = document.getElementById('device-code');
if (entry) {
    const asked = document.getElementById('device-asked');
    const said = document.getElementById('device-said');
    const decisions = [...asked.querySelectorAll('button')];
    let code = '';
    const say = (words) => {
        said.textContent = words;
        said.hidden = false;
    };
    const ago = (time) => {
        const minutes = Math.max(0, Math.round((Date.now() - Date.parse(time)) / 60000));
        return minutes === 0 ? 'just now' : minutes === 1 ? 'a minute ago' : minutes + ' minutes ago';
    };
    const countryName = (region) => {
        try {
            return new Intl.DisplayNames(['en'], { type: 'region' }).of(region);
        } catch {
            return region;
        }
    };
    // A request whose cookie no longer counts reloads the page, which then offers to sign in.
    const send = async (path, body) => {
        const answer = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (answer.status === 401) {
            location.reload();
            return null;
        }
        const read = await answer.json().catch(() => ({}));
        if (!answer.ok) say(read.error || 'That did not work; try again.');
        return answer.ok ? read : null;
    };
    entry.addEventListener('submit', async (event) => {
        event.preventDefault();
        said.hidden = true;
        asked.hidden = true;
        code = entry.elements.user_code.value;
        const found = await send('/account/device/lookup', { user_code: code });
        if (!found) return;
        document.getElementById('device-words').textContent = 'The ' + found.label + ' asked ' + ago(found.asked)
            + (found.country ? ', from ' + countryName(found.country) : '') + ', to sign in as ' + found.account + '.';
        decisions.forEach((button) => { button.disabled = false; });
        asked.hidden = false;
    });
    // The code approved or denied is the one looked up, whatever the field holds since.
    decisions.forEach((button) => button.addEventListener('click', async () => {
        decisions.forEach((each) => { each.disabled = true; });
        const approve = button.value === 'approve';
        const done = await send('/account/device/approve', { user_code: code, approve });
        if (!done) return;
        asked.hidden = true;
        entry.hidden = true;
        say(approve ? 'Type ' + done.match + ' on your device. It gets one try.' : 'Denied. That code no longer works.');
    }));
}
`;

const STYLE = `:root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
body { margin: 0; }
main { max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { font-size: 1.5rem; }
h2 { font-size: 1.15rem; margin-top: 2rem; }
.notice { padding: 0.5rem 0.75rem; border-left: 3px solid; }
.question { padding: 0 1rem 0.5rem; border: 1px solid; border-radius: 6px; }
.devices, .sign-ins { list-style: none; padding: 0; }
.devices li, .sign-ins li { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; align-items: center; padding: 0.5rem 0; }
.when { opacity: 0.75; font-size: 0.9rem; }
form { margin: 0.5rem 0; }
.devices form, .sign-ins form { margin: 0; }
button, .button { font: inherit; padding: 0.3rem 0.8rem; color: inherit; background: none; border: 1px solid; border-radius: 6px; cursor: pointer; text-decoration: none; }
.device-code { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.device-code label { flex-basis: 100%; }
.device-code input { font: inherit; padding: 0.3rem 0.5rem; width: 10rem; color: inherit; background: none; border: 1px solid; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.1em; }
`;

const escape = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const day = (time) => time.slice(0, 10);

function device({
    ref, label, createdAt, lastUsedAt,
}) {
    return `<li><span>${escape(label)}</span> <span class="when">signed in ${escape(day(createdAt))}, last used ${escape(day(lastUsedAt))}</span>
<form method="post" action="/account/tokens/revoke"><input type="hidden" name="ref" value="${escape(ref)}"><button type="submit">Sign out</button></form></li>`;
}

const LINK_WORDS = Object.freeze({ github: 'Link a GitHub account', apple: 'Link an Apple ID' });

// The ways into the account, each with Unlink unless it is the last, and Link for each provider set up that it lacks.
function signInsPart(env, providers, login) {
    const linked = providers.map((provider) => {
        const what = provider === 'github' ? `GitHub account <strong>${escape(login)}</strong>` : 'Apple ID';
        const unlink = providers.length > 1
            ? ` <form method="post" action="/account/unlink"><input type="hidden" name="provider" value="${provider}"><button type="submit">Unlink</button></form>` : '';
        return `<li><span>${what}</span>${unlink}</li>`;
    });
    const links = signInProviders(env).filter((provider) => !providers.includes(provider))
        .map((provider) => `<form method="post" action="/account/link/${provider}"><button type="submit">${LINK_WORDS[provider]}</button></form>`);
    return `<h2>Sign-ins</h2>
<p>Each signs in to this account. The last one cannot be unlinked.</p>
<ul class="sign-ins">\n${linked.join('\n')}\n</ul>${links.length === 0 ? '' : `\n${links.join('\n')}`}`;
}

function signedInPart(env, {
    user, devices, providers, login,
}) {
    const list = devices.length === 0 ? '<p>No device is signed in.</p>' : `<ul class="devices">\n${devices.map(device).join('\n')}\n</ul>`;
    return `<p>Signed in as <strong>${escape(user.name)}</strong>.</p>
<form method="post" action="/account/logout"><button type="submit">Sign out</button></form>
${signInsPart(env, providers, login)}
<h2>Devices</h2>
<p>The machines signed in with crossbind login, and the crossbind app on each device.</p>
${list}
<h2>Sign out everywhere</h2>
<p>Signs out every device and every browser, this one included.</p>
<form method="post" action="/account/logout-everywhere"><button type="submit">Sign out everywhere</button></form>
<h2>Delete account</h2>
<p>Deletes the account and signs out every device and browser at once. <a href="https://crossbind.dev/privacy/#delete">What stays after it</a>.</p>
<form method="post" action="/account/delete"><label><input type="checkbox" name="confirm" value="yes" required> Delete my crossbind account</label>
<button type="submit">Delete account</button></form>`;
}

// A first sign-in's question (oauth.js): no account is made until its person says so. Signed out, the other answer is
// to sign in with the other provider, which comes back here; signed in, it is to link the identity to this account.
function questionPart(env, pending, signedIn) {
    const identity = IDENTITY_WORDS[pending.provider];
    const other = Object.keys(IDENTITY_WORDS).find((provider) => provider !== pending.provider);
    const answers = signedIn
        ? ['<form method="post" action="/account/link-pending"><button type="submit">Link it to this account</button></form>',
            '<form method="post" action="/account/new"><button type="submit">Make a new account with it</button></form>']
        : ['<form method="post" action="/account/new"><button type="submit">Make a new account</button></form>',
            ...(signInProviders(env).includes(other)
                ? [`<p><a class="button" href="/account/login/${other}">I have an account with ${PROVIDER_NAMES[other]}: sign in with it to link this ${identity}</a></p>`] : [])];
    return `<section class="question">
<h2>${signedIn ? `Link this ${identity}?` : 'A new crossbind account?'}</h2>
<p>No crossbind account signs in with this ${identity} yet.</p>
${answers.join('\n')}
</section>`;
}

// `next`: where a sign-in started here returns, the account's page, the device page or the playground.
function signInLinks(env, next) {
    const query = next === 'account' ? '' : `?next=${next}`;
    const providers = signInProviders(env);
    return providers.length === 0
        ? '<p>Signing in is not set up.</p>'
        : `<p class="sign-in">${providers.map((provider) => `<a class="button" href="/account/login/${provider}${query}">Sign in with ${PROVIDER_NAMES[provider]}</a>`).join(' ')}</p>`;
}

const signedOutPart = (env, next) => `<p>Sign in to see the devices signed in to your crossbind account, sign them out, or delete the account.</p>\n${signInLinks(env, next)}`;

// The device page's part while signed in: the code typed, then what asked with Approve and Deny, then the number or the
// denial, which the script shows. A form posted, never a link, so that no code reaches an address.
function deviceSignedInPart(user) {
    return `<p>Signed in as <strong>${escape(user.name)}</strong>.</p>
<form method="post" action="/account/logout"><input type="hidden" name="next" value="device"><button type="submit">Sign out</button></form>
<form method="post" id="device-code" class="device-code">
<label for="user-code">Enter the code your device shows</label>
<input id="user-code" name="user_code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" required>
<button type="submit">Continue</button>
</form>
<section id="device-asked" class="question" hidden>
<p id="device-words"></p>
<p>Approve only a code you started yourself, on a device in front of you.</p>
<button type="button" value="approve">Approve</button> <button type="button" value="deny">Deny</button>
</section>
<p id="device-said" class="notice" role="status" hidden></p>`;
}

function frame(env, { title, main, said }) {
    const shown = Object.entries(notices(env)).map(([key, words]) => `<p class="notice" data-notice="${key}" hidden>${escape(words)}</p>`);
    if (said) shown.unshift(`<p class="notice" role="status">${escape(said)}</p>`);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/account.css">
<script src="/account.js" defer></script>
</head>
<body>
<main>
<h1>${title}</h1>
${shown.join('\n')}
${main}
</main>
</body>
</html>
`;
}

function page(env, {
    user, devices, providers, login, said, next, pending,
}) {
    return frame(env, {
        title: 'crossbind account',
        said,
        main: `${pending && Object.hasOwn(IDENTITY_WORDS, pending.provider) ? questionPart(env, pending, Boolean(user)) : ''}
${user ? signedInPart(env, {
        user, devices, providers, login,
    }) : signedOutPart(env, next)}`,
    });
}

const asset = (body, type) => new Response(body, { headers: { ...SECURITY_HEADERS, 'content-type': type } });

function redirectAfterPost(location, cookies = []) {
    const headers = new Headers({ location, 'cache-control': 'no-store' });
    cookies.forEach((cookie) => headers.append('set-cookie', cookie));
    return new Response(null, { status: 303, headers });
}

const seeOther = (request, path, cookies) => redirectAfterPost(`${new URL(request.url).origin}${path}`, cookies);

async function readForm(request) {
    try {
        return { form: new URLSearchParams(await readLimited(request, MAX_FORM_BYTES)) };
    } catch (error) {
        if (error instanceof BodyTooLarge) return { error: jsonResponse(413, { error: `The body is over ${MAX_FORM_BYTES} bytes.` }) };
        throw error;
    }
}

const signedInUser = async ({ request, env, deps }) => (await readSignedIn(request, env.SESSION_SECRET, deps.accounts, (deps.now ?? Date.now)())).user;

// Where a sign-in started on the page returns: a name of the three, never an address the request gives.
const nextOf = (request) => {
    const next = new URL(request.url).searchParams.get('next');
    return next === 'playground' || next === 'device' ? next : 'account';
};

// A notice that came in its cookie is shown once: the page that shows it clears it.
async function loginPage({ request, env, deps }) {
    const now = (deps.now ?? Date.now)();
    const { user, standing } = await readSignedIn(request, env.SESSION_SECRET, deps.accounts, now);
    const devices = user ? await deps.accounts.devices(user.id) : [];
    const providers = user ? await deps.accounts.providersOf(user.id) : [];
    const pending = await readPending(request, env.SESSION_SECRET, now);
    const notice = readNotice(request);
    const headers = new Headers(pageHeaders(env));
    if (notice) headers.append('set-cookie', clearCookie(NOTICE_COOKIE));
    return new Response(page(env, {
        user, devices, providers, login: standing?.login, said: wordsOf(notice, env), next: nextOf(request), pending,
    }), { headers });
}

// A navigation, which carries no Origin: it changes nothing but this browser's state cookie.
const signInRoute = (provider) => ({ request, env }) => startLogin(request, env, { provider, next: nextOf(request) });

// Another site's request, crossbind.dev's included, and one with no Origin or `Origin: null`, gets 403.
const fromThePage = (route) => (context) => {
    const { request } = context;
    if (request.headers.get('origin') !== new URL(request.url).origin) return jsonResponse(403, { error: 'This is accepted from the account\'s page only.' });
    return route(context);
};

// A form of a page left open once its cookie stopped counting comes back to the page, which then offers to sign in.
const signedIn = (route) => async (context) => {
    const user = await signedInUser(context);
    return user ? route(context, user) : seeOther(context.request, '/login');
};

// A request of the device page's script whose cookie no longer counts: the script then reloads the page, which offers
// to sign in.
const signedInScript = (route) => async (context) => {
    const user = await signedInUser(context);
    return user ? route(context, user) : jsonResponse(401, { error: 'Sign in to approve a device.' });
};

// Signs this browser out, and from the device page comes back to it: a name of the two, never an address.
async function logoutRoute({ request }) {
    const { form, error } = await readForm(request);
    if (error) return error;
    return seeOther(request, form.get('next') === 'device' ? '/device' : '/login', [clearCookie(SESSION_COOKIE)]);
}

// The device page (worker/devices.js): signed out, a sign-in of each provider that comes back to it; signed in, the code
// to enter. It takes no code from its address, and the sign-in it offers is a device's own (RFC 8628 5.4).
async function devicePage({ request, env, deps }) {
    const { user } = await readSignedIn(request, env.SESSION_SECRET, deps.accounts, (deps.now ?? Date.now)());
    const main = user ? deviceSignedInPart(user) : `<p>Sign in to approve a device.</p>\n${signInLinks(env, 'device')}`;
    return new Response(frame(env, { title: 'Approve a device', main }), { headers: pageHeaders(env) });
}

// A code entered on the device page, to look up or to approve: ten a minute for an account and for a network, which
// bounds guessing at codes (RFC 8628 5.1), then a body of its code in any case, dashes and spaces aside.
async function readEntry({ request, deps, network }, user) {
    const counted = await Promise.all([userKey(user.id), network].map((key) => deps.limits.code.limit({ key })));
    if (counted.some((each) => !each.success)) return { error: jsonResponse(429, { error: 'Too many codes entered; try again in a minute.' }) };
    let entry;
    try {
        entry = JSON.parse(await readLimited(request, MAX_ENTRY_BYTES));
    } catch (error) {
        if (!(error instanceof BodyTooLarge || error instanceof SyntaxError)) throw error;
    }
    const code = typedCode(entry?.user_code);
    return code ? { entry, code } : { error: jsonResponse(400, { error: ENTER_CODE }) };
}

async function lookupRoute(context, user) {
    const { code, error } = await readEntry(context, user);
    if (error) return error;
    const waiting = await context.deps.devices.waiting(code);
    if (!waiting) return jsonResponse(404, { error: NO_DEVICE });
    return jsonResponse(200, {
        client: waiting.client, label: waiting.label, country: waiting.country, asked: waiting.createdAt, account: user.name,
    });
}

// Approved, the code waits for the device to give the number, which this answer alone carries; denied, it ends.
async function approveRoute(context, user) {
    const { entry, code, error } = await readEntry(context, user);
    if (error) return error;
    if (typeof entry.approve !== 'boolean') return jsonResponse(400, { error: 'Approve or deny the code on the device page.' });
    const { devices } = context.deps;
    if (!entry.approve) {
        if (!(await devices.deny(code))) return jsonResponse(404, { error: NO_DEVICE });
        log({ event: 'device-denied', who: userKey(user.id) });
        return jsonResponse(200, { denied: true });
    }
    const approved = await devices.approve(code, user.id);
    if (!approved) return jsonResponse(404, { error: NO_DEVICE });
    log({ event: 'device-approved', who: userKey(user.id) });
    return jsonResponse(200, { match: approved.match, label: approved.label });
}

async function revokeRoute({ request, deps }, user) {
    const { form, error } = await readForm(request);
    if (error) return error;
    const ref = form.get('ref') ?? '';
    if (!DEVICE_REF.test(ref)) return jsonResponse(400, { error: 'Sign out a device from the list on the account\'s page.' });
    if (await deps.accounts.revokeDevice(user.id, ref)) log({ event: 'token-revoked', who: userKey(user.id), all: false });
    return seeOther(request, '/login');
}

async function everywhereRoute({ request, deps }, user) {
    await deps.accounts.signOutEverywhere(user.id);
    log({ event: 'token-revoked', who: userKey(user.id), all: true });
    return seeOther(request, '/login#signed-out-everywhere', [clearCookie(SESSION_COOKIE)]);
}

async function deleteRoute({ request, deps }, user) {
    const { form, error } = await readForm(request);
    if (error) return error;
    if (form.get('confirm') !== 'yes') return jsonResponse(400, { error: 'Tick the box to delete the account.' });
    await deps.accounts.deleteAccount(user.id);
    log({ event: 'account-deleted', who: userKey(user.id) });
    return seeOther(request, '/login#deleted', [clearCookie(SESSION_COOKIE)]);
}

// "Make a new account": the identity a first sign-in confirmed, from its sealed cookie, gets an account of its own
// and signs in, or signs in to the one it has by now; then where that sign-in was to return.
async function newAccountRoute({ request, env, deps }) {
    const now = (deps.now ?? Date.now)();
    const pending = await readPending(request, env.SESSION_SECRET, now);
    if (!pending) return seeOther(request, '/login#waited');
    const { origin } = new URL(request.url);
    const page = returnPage(origin, pending.next);
    const cleared = clearCookie(PENDING_COOKIE);
    const { user, freeFrom } = await deps.accounts.signIn(pending);
    if (freeFrom) return redirectAfterPost(page, [cleared, noticeCookie({ said: 'held', provider: pending.provider, day: freeFrom })]);
    if (user.blocked) {
        log({ event: 'blocked-sign-in', who: userKey(user.id) });
        return redirectAfterPost(`${page}#login=blocked`, [cleared]);
    }
    const session = await signSession({ id: user.id, name: nameOf(user) }, env.SESSION_SECRET, now);
    return redirectAfterPost(`${signedInPage(origin, pending.next, env)}#login=ok`, [cleared, sessionCookie(SESSION_COOKIE, session, SESSION_TTL_MS / 1000)]);
}

// Linking starts as a sign-in does, with a navigation the Worker sends to the provider, from the page's form: the state,
// Apple's nonce and GitHub's verifier stay in this browser's HttpOnly cookie, so no script holds what the callback
// compares, and the purpose names the account the callback links to.
const linkRoute = (provider) => ({ request, env }, user) => startLogin(request, env, { provider, next: 'account', purpose: `link:${user.id}` });

const UNLINK_REFUSED = 'Unlink a sign-in from the list on the account\'s page.';

async function unlinkRoute({ request, deps }, user) {
    const { form, error } = await readForm(request);
    if (error) return error;
    const provider = form.get('provider') ?? '';
    const { outcome, freeFrom } = await deps.accounts.unlink(user.id, provider);
    if (outcome === 'last') return jsonResponse(409, { error: 'This is the only way into your account: link another first, or delete the account.' });
    if (outcome === 'none') return jsonResponse(400, { error: UNLINK_REFUSED });
    log({ event: 'identity-unlinked', who: userKey(user.id), provider });
    return seeOther(request, '/login', [noticeCookie({ said: outcome === 'held' ? 'unlinked-held' : 'unlinked', provider, day: freeFrom })]);
}

// "Link it to this account": the identity a first sign-in confirmed in this browser, from its sealed cookie.
async function linkPendingRoute({ request, env, deps }, user) {
    const pending = await readPending(request, env.SESSION_SECRET, (deps.now ?? Date.now)());
    if (!pending) return seeOther(request, '/login#waited');
    const { outcome, name, freeFrom } = await deps.accounts.link(user.id, pending);
    if (outcome === 'linked') log({ event: 'identity-linked', who: userKey(user.id), provider: pending.provider });
    const cookies = [noticeCookie({
        said: `link-${outcome}`, provider: pending.provider, name, day: freeFrom,
    })];
    if (outcome === 'linked' || outcome === 'already') cookies.push(clearCookie(PENDING_COOKIE));
    return seeOther(request, '/login', cookies);
}

const ROUTES = Object.freeze({
    'GET /login': loginPage,
    'GET /device': devicePage,
    'GET /account.css': () => asset(STYLE, 'text/css; charset=utf-8'),
    'GET /account.js': () => asset(SCRIPT, 'text/javascript; charset=utf-8'),
    'GET /account/login/github': signInRoute('github'),
    'GET /account/login/apple': signInRoute('apple'),
    'POST /account/logout': fromThePage(logoutRoute),
    'POST /account/device/lookup': fromThePage(signedInScript(lookupRoute)),
    'POST /account/device/approve': fromThePage(signedInScript(approveRoute)),
    'POST /account/tokens/revoke': fromThePage(signedIn(revokeRoute)),
    'POST /account/logout-everywhere': fromThePage(signedIn(everywhereRoute)),
    'POST /account/delete': fromThePage(signedIn(deleteRoute)),
    'POST /account/new': fromThePage(newAccountRoute),
    'POST /account/link/github': fromThePage(signedIn(linkRoute('github'))),
    'POST /account/link/apple': fromThePage(signedIn(linkRoute('apple'))),
    'POST /account/link-pending': fromThePage(signedIn(linkPendingRoute)),
    'POST /account/unlink': fromThePage(signedIn(unlinkRoute)),
});

export const isAccountPath = (pathname) => ['/login', '/device', '/account.css', '/account.js'].includes(pathname) || pathname.startsWith('/account/');

// context: the request, env and deps of worker/api.js.
export function handleAccountPage(context) {
    const route = ROUTES[`${context.request.method} ${new URL(context.request.url).pathname}`];
    return route ? route(context) : jsonResponse(404, { error: 'Not found.' });
}
