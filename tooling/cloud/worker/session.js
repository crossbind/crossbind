export const SESSION_COOKIE = '__Host-pg_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

const MIN_SECRET_LENGTH = 32;
const utf8 = new TextEncoder();

const toBase64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

// Only the GitHub account id and name: no email, no GitHub token.
export async function signSession({ id, name }, secret, now = Date.now()) {
    const payload = toBase64Url(utf8.encode(JSON.stringify({ id, n: name, exp: now + SESSION_TTL_MS })));
    const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8.encode(payload));
    return `${payload}.${toBase64Url(signature)}`;
}

// Any cookie that does not verify, and any session without a configured secret, reads as signed out.
export async function readSession(request, secret, now = Date.now()) {
    const [payload, signature, extra] = readCookie(request, SESSION_COOKIE)?.split('.') ?? [];
    if (!payload || !signature || extra !== undefined) return null;
    try {
        if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), utf8.encode(payload)))) return null;
        const { id, n, exp } = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
        if (typeof id !== 'string' || typeof n !== 'string' || !(exp > now)) return null;
        return { id, name: n };
    } catch {
        return null;
    }
}
