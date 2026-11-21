export const SESSION_COOKIE = '__Host-pg_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

const MIN_SECRET_LENGTH = 32;
const utf8 = new TextEncoder();

export const toBase64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromBase64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
export const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

async function hmacKey(secret) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
        throw new Error(`SESSION_SECRET must hold at least ${MIN_SECRET_LENGTH} characters.`);
    }
    return crypto.subtle.importKey('raw', utf8.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export function readCookie(request, name) {
    const header = request.headers.get('cookie') ?? '';
    for (const part of header.split(';')) {
        const at = part.indexOf('=');
        if (at !== -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
    }
    return null;
}

// Host-only (`__Host-`), so no other subdomain can set or read it.
export const sessionCookie = (name, value, maxAgeSeconds) => `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; Secure; HttpOnly; SameSite=Lax`;
export const clearCookie = (name) => sessionCookie(name, '', 0);

export const PENDING_COOKIE = '__Host-pg_pending';
export const PENDING_TTL_SECONDS = 600;

// A value this API alone could have made: base64url JSON and its HMAC, taken under the cookie's name, so that no
// cookie's value passes for another's.
async function seal(name, value, secret) {
    const payload = toBase64Url(utf8.encode(JSON.stringify(value)));
    const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8.encode(`${name}.${payload}`));
    return `${payload}.${toBase64Url(signature)}`;
}

async function unseal(name, sealed, secret) {
    const [payload, signature, extra] = sealed?.split('.') ?? [];
    if (!payload || !signature || extra !== undefined) return null;
    try {
        if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), utf8.encode(`${name}.${payload}`)))) return null;
        return JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    } catch {
        return null;
    }
}

// A first sign-in with an identity crossbind does not know: the identity its provider confirmed, with the moment GitHub
// made a young GitHub account, waiting ten minutes for its person's answer on the account's page, and where that sign-in
// was to return. Sealed: anyone can set a cookie in their own browser, and an identity written there by hand would make
// or sign in to its account.
export async function pendingCookie({
    provider, subject, login, githubCreatedAt,
}, next, secret, now = Date.now()) {
    const value = await seal(PENDING_COOKIE, {
        provider, subject, login, githubCreatedAt, next, exp: now + PENDING_TTL_SECONDS * 1000,
    }, secret);
    return sessionCookie(PENDING_COOKIE, value, PENDING_TTL_SECONDS);
}

export async function readPending(request, secret, now = Date.now()) {
    const pending = await unseal(PENDING_COOKIE, readCookie(request, PENDING_COOKIE), secret);
    if (!pending || !(pending.exp > now) || ![pending.provider, pending.subject, pending.login].every((field) => typeof field === 'string')) return null;
    return {
        provider: pending.provider,
        subject: pending.subject,
        login: pending.login,
        ...(typeof pending.githubCreatedAt === 'string' ? { githubCreatedAt: pending.githubCreatedAt } : {}),
        next: pending.next === 'playground' || pending.next === 'device' ? pending.next : 'account',
    };
}

export const NOTICE_COOKIE = '__Host-pg_notice';
const NOTICE_SECONDS = 60;

// What a sign-in or a form came back with that the account's page shows once, when its words hold a date or another
// account's name: a link could make those up if the address carried them, as it carries a `#login=` result.
export const noticeCookie = (notice) => sessionCookie(NOTICE_COOKIE, toBase64Url(utf8.encode(JSON.stringify(notice))), NOTICE_SECONDS);

export function readNotice(request) {
    try {
        return JSON.parse(new TextDecoder().decode(fromBase64Url(readCookie(request, NOTICE_COOKIE) ?? '')));
    } catch {
        return null;
    }
}

// Only the GitHub account id and name: no email, no GitHub token.
export async function signSession({ id, name }, secret, now = Date.now()) {
    const payload = toBase64Url(utf8.encode(JSON.stringify({ id, n: name, exp: now + SESSION_TTL_MS })));
    const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8.encode(payload));
    return `${payload}.${toBase64Url(signature)}`;
}

// Any cookie that does not verify, and any session without a configured secret, reads as signed out. A cookie was made
// SESSION_TTL_MS before it expires.
export async function readSession(request, secret, now = Date.now()) {
    const [payload, signature, extra] = readCookie(request, SESSION_COOKIE)?.split('.') ?? [];
    if (!payload || !signature || extra !== undefined) return null;
    try {
        if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), utf8.encode(payload)))) return null;
        const { id, n, exp } = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
        if (typeof id !== 'string' || typeof n !== 'string' || !(exp > now)) return null;
        return { id, name: n, madeAt: exp - SESSION_TTL_MS };
    } catch {
        return null;
    }
}

// Every route that takes the cookie reads the account's row (accounts.standing): a cookie of an account deleted or
// blocked since, or made before the account signed out everywhere, signs in nothing. `session` is the cookie's
// account, `user` the one it signs in.
export async function readSignedIn(request, secret, accounts, now = Date.now()) {
    const session = await readSession(request, secret, now);
    if (!session) return { session: null, standing: null, user: null };
    const standing = await accounts.standing(session.id);
    const signedOut = standing.signedOutAt !== null && session.madeAt <= Date.parse(standing.signedOutAt);
    const signsIn = standing.exists && !standing.blocked && !signedOut;
    return { session, standing, user: signsIn ? { id: session.id, name: standing.name } : null };
}
