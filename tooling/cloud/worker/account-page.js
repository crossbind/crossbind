import {
    ACCOUNT_BLOCKED, DEVICE_REF_LENGTH, dayWords, userKey,
} from './accounts.js';
import {
    BodyTooLarge, SECURITY_HEADERS, jsonResponse, log, readLimited,
} from './http.js';
import { minAccountDays, signInProviders, startLogin } from './oauth.js';
import {
    clearCookie, readNotice, readSignedIn, NOTICE_COOKIE, SESSION_COOKIE,
} from './session.js';

// The account's own page, /login on this API's origin, and the routes under /account/ that its forms post to. Those
// take a request from this origin alone, so no other site, crossbind.dev included, can change an account through them.

const MAX_FORM_BYTES = 1024;
const DEVICE_REF = new RegExp(`^[0-9a-f]{${DEVICE_REF_LENGTH}}$`);
// same-origin and not no-referrer: a form's POST from a no-referrer page carries `Origin: null`, which the origin rule
// refuses.
const PAGE_HEADERS = Object.freeze({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
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
    deleted: 'Your crossbind account is deleted, and every device is signed out of it.',
});

const PROVIDER_NAMES = Object.freeze({ github: 'GitHub', apple: 'Apple' });
const IDENTITY_WORDS = Object.freeze({ github: 'GitHub account', apple: 'Apple ID' });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The words of a notice that came in its cookie (session.js), which any browser can make up for itself: each is checked
// before it is worded, and a notice that does not check out shows nothing.
const SAID = Object.freeze({
    held: ({ provider, day }) => `This ${IDENTITY_WORDS[provider]} was unlinked from a crossbind account this month: it signs in again from ${dayWords(day)}, and can be linked back to that account now.`,
});

function wordsOf(notice) {
    const word = Object.hasOwn(SAID, notice?.said ?? '') ? SAID[notice.said] : null;
    if (!word || !Object.hasOwn(IDENTITY_WORDS, notice.provider ?? '') || (notice.day !== undefined && !DAY.test(notice.day))) return null;
    return word(notice);
}

const SCRIPT = `const shown = [...document.querySelectorAll('[data-notice]')].find((notice) => '#' + notice.dataset.notice === location.hash);
if (shown) {
    shown.hidden = false;
    history.replaceState(null, '', location.pathname + location.search);
}
`;

const STYLE = `:root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
body { margin: 0; }
main { max-width: 40rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { font-size: 1.5rem; }
h2 { font-size: 1.15rem; margin-top: 2rem; }
.notice { padding: 0.5rem 0.75rem; border-left: 3px solid; }
.devices { list-style: none; padding: 0; }
.devices li { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; align-items: center; padding: 0.5rem 0; }
.when { opacity: 0.75; font-size: 0.9rem; }
form { margin: 0.5rem 0; }
.devices form { margin: 0; }
button, .button { font: inherit; padding: 0.3rem 0.8rem; color: inherit; background: none; border: 1px solid; border-radius: 6px; cursor: pointer; text-decoration: none; }
`;

const escape = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const day = (time) => time.slice(0, 10);

function device({
    ref, label, createdAt, lastUsedAt,
}) {
    return `<li><span>${escape(label)}</span> <span class="when">signed in ${escape(day(createdAt))}, last used ${escape(day(lastUsedAt))}</span>
<form method="post" action="/account/tokens/revoke"><input type="hidden" name="ref" value="${escape(ref)}"><button type="submit">Sign out</button></form></li>`;
}

function signedInPart(user, devices) {
    const list = devices.length === 0 ? '<p>No device is signed in.</p>' : `<ul class="devices">\n${devices.map(device).join('\n')}\n</ul>`;
    return `<p>Signed in as <strong>${escape(user.name)}</strong>.</p>
<form method="post" action="/account/logout"><button type="submit">Sign out</button></form>
<h2>Devices</h2>
<p>The machines signed in with crossbind login.</p>
${list}
<h2>Sign out everywhere</h2>
<p>Signs out every device and every browser, this one included.</p>
<form method="post" action="/account/logout-everywhere"><button type="submit">Sign out everywhere</button></form>
<h2>Delete account</h2>
<p>Deletes the account and signs out every device and browser at once. <a href="https://crossbind.dev/privacy/#delete">What stays after it</a>.</p>
<form method="post" action="/account/delete"><label><input type="checkbox" name="confirm" value="yes" required> Delete my crossbind account</label>
<button type="submit">Delete account</button></form>`;
}

// `next`: where a sign-in started here returns, the playground when this page was opened from it.
function signedOutPart(env, next) {
    const query = next === 'playground' ? '?next=playground' : '';
    const providers = signInProviders(env);
    const signIn = providers.length === 0
        ? '<p>Signing in is not set up.</p>'
        : `<p class="sign-in">${providers.map((provider) => `<a class="button" href="/account/login/${provider}${query}">Sign in with ${PROVIDER_NAMES[provider]}</a>`).join(' ')}</p>`;
    return `<p>Sign in to see the devices signed in to your crossbind account, sign them out, or delete the account.</p>\n${signIn}`;
}

function page(env, {
    user, devices, said, next,
}) {
    const shown = Object.entries(notices(env)).map(([key, words]) => `<p class="notice" data-notice="${key}" hidden>${escape(words)}</p>`);
    if (said) shown.unshift(`<p class="notice" role="status">${escape(said)}</p>`);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>crossbind account</title>
<link rel="stylesheet" href="/account.css">
<script src="/account.js" defer></script>
</head>
<body>
<main>
<h1>crossbind account</h1>
${shown.join('\n')}
${user ? signedInPart(user, devices) : signedOutPart(env, next)}
</main>
</body>
</html>
`;
}

const asset = (body, type) => new Response(body, { headers: { ...SECURITY_HEADERS, 'content-type': type } });

function seeOther(request, path, cookies = []) {
    const headers = new Headers({ location: `${new URL(request.url).origin}${path}`, 'cache-control': 'no-store' });
    cookies.forEach((cookie) => headers.append('set-cookie', cookie));
    return new Response(null, { status: 303, headers });
}

async function readForm(request) {
    try {
        return { form: new URLSearchParams(await readLimited(request, MAX_FORM_BYTES)) };
    } catch (error) {
        if (error instanceof BodyTooLarge) return { error: jsonResponse(413, { error: `The body is over ${MAX_FORM_BYTES} bytes.` }) };
        throw error;
    }
}

const signedInUser = async ({ request, env, deps }) => (await readSignedIn(request, env.SESSION_SECRET, deps.accounts, (deps.now ?? Date.now)())).user;

const nextOf = (request) => (new URL(request.url).searchParams.get('next') === 'playground' ? 'playground' : 'account');

// A notice that came in its cookie is shown once: the page that shows it clears it.
async function loginPage({ request, env, deps }) {
    const user = await signedInUser({ request, env, deps });
    const devices = user ? await deps.accounts.devices(user.id) : [];
    const notice = readNotice(request);
    const headers = new Headers(PAGE_HEADERS);
    if (notice) headers.append('set-cookie', clearCookie(NOTICE_COOKIE));
    return new Response(page(env, {
        user, devices, said: wordsOf(notice), next: nextOf(request),
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

const ROUTES = Object.freeze({
    'GET /login': loginPage,
    'GET /account.css': () => asset(STYLE, 'text/css; charset=utf-8'),
    'GET /account.js': () => asset(SCRIPT, 'text/javascript; charset=utf-8'),
    'GET /account/login/github': signInRoute('github'),
    'GET /account/login/apple': signInRoute('apple'),
    'POST /account/logout': fromThePage(({ request }) => seeOther(request, '/login', [clearCookie(SESSION_COOKIE)])),
    'POST /account/tokens/revoke': fromThePage(signedIn(revokeRoute)),
    'POST /account/logout-everywhere': fromThePage(signedIn(everywhereRoute)),
    'POST /account/delete': fromThePage(signedIn(deleteRoute)),
});

export const isAccountPath = (pathname) => ['/login', '/account.css', '/account.js'].includes(pathname) || pathname.startsWith('/account/');

// context: the request, env and deps of worker/api.js.
export function handleAccountPage(context) {
    const route = ROUTES[`${context.request.method} ${new URL(context.request.url).pathname}`];
    return route ? route(context) : jsonResponse(404, { error: 'Not found.' });
}
