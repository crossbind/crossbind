import { fromBase64Url, toBase64Url } from './session.js';

// The projects an account serves its own devices, a session each (migrations/0002's `sessions`): crossbind app preview
// registers its dev server's, renews it while it runs and removes it as it stops; the account's crossbind app lists
// them, each with the pairing key that opens it. Nothing of a session reaches another account.

// A dev session leaves the list ten minutes after its last renewal; crossbind app preview renews it every five.
export const DEV_SESSION_SECONDS = 600;
// The live sessions an account has at once.
export const MAX_SESSIONS_PER_ACCOUNT = 10;
const MAX_ADDRESSES = 4;
const MAX_PROTOCOL = 999_999;
const MAX_PORT = 65_535;
// A session's id and a project's: 16 bytes in base64url. A pairing key: 32 bytes, in the one form that decodes to them.
const ID = /^[A-Za-z0-9_-]{22}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const NAME = /^[\p{L}\p{N} ._@/-]{1,64}$/u;
const PORT = /^[1-9]\d{0,4}$/;
// fc00::/7, as a URL writes an IPv6 address: in brackets, in lower case, its first group whole.
const UNIQUE_LOCAL_IPV6 = /^\[f[cd][0-9a-f]{2}:/;

export const isSessionId = (text) => typeof text === 'string' && ID.test(text);
const isKey = (text) => typeof text === 'string' && KEY.test(text) && toBase64Url(fromBase64Url(text)) === text;

function isPrivateIpv4(host) {
    const parts = host.split('.');
    if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
    const [a, b] = parts.map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

// A dev server's `host:port` that the crossbind app opens a preview at, under crossbind app preview's own rule
// (core/crossbind/src/utils/previewAddress.js isLocalSource): a private IPv4 address, an IPv6 one in fc00::/7, or a
// name that ends in .local; each written as a URL writes it, so that one address has one form.
export function isLocalAddress(text) {
    if (typeof text !== 'string') return false;
    const at = text.lastIndexOf(':');
    const [host, port] = [text.slice(0, at), text.slice(at + 1)];
    if (at < 1 || !PORT.test(port) || Number(port) > MAX_PORT || URL.parse(`http://${host}/`)?.host !== host) return false;
    if (host.startsWith('[')) return UNIQUE_LOCAL_IPV6.test(host);
    return isPrivateIpv4(host) || host.endsWith('.local');
}

// A dev session as crossbind app preview sends it, or null for any field out of its form.
export function devSessionOf(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
    const {
        source, project, addresses, protocol, key,
    } = body;
    const fits = source === 'dev'
        && project !== null && typeof project === 'object' && isSessionId(project.id) && typeof project.name === 'string' && NAME.test(project.name)
        && Array.isArray(addresses) && addresses.length >= 1 && addresses.length <= MAX_ADDRESSES && addresses.every(isLocalAddress)
        && Number.isInteger(protocol) && protocol >= 1 && protocol <= MAX_PROTOCOL
        && isKey(key);
    return fits ? {
        projectId: project.id, projectName: project.name, addresses, protocol, key,
    } : null;
}

const sessionOf = (row) => ({
    id: row.id,
    source: row.source,
    project: { id: row.project_id, name: row.project_name },
    addresses: JSON.parse(row.addresses),
    protocol: row.protocol,
    key: row.key,
    version: row.version,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
});

// The sessions in D1, each query held to its account.
export function createProjectSessions(db, now = () => Date.now()) {
    const timestamp = (at = now()) => new Date(at).toISOString();

    return {
        // A dev session registered, or renewed by the run that registered it: { expiresAt }, or { error } of 'taken'
        // for an id another account or run holds, or 'full' for an account with MAX_SESSIONS_PER_ACCOUNT live ones. One
        // statement counts and writes, so that sessions registered at once stop at the count.
        async register(userId, id, {
            projectId, projectName, addresses, protocol, key,
        }) {
            const at = now();
            const row = await db.prepare(`INSERT INTO sessions (id, user_id, source, project_id, project_name, addresses, protocol, key, created_at, expires_at)
                SELECT ?1, ?2, 'dev', ?3, ?4, ?5, ?6, ?7, ?8, ?9
                WHERE (SELECT count(1) FROM sessions WHERE user_id = ?2 AND expires_at > ?8 AND id != ?1) < ?10
                ON CONFLICT (id) DO UPDATE SET addresses = excluded.addresses, expires_at = excluded.expires_at
                WHERE sessions.user_id = excluded.user_id AND sessions.key = excluded.key AND sessions.source = 'dev'
                RETURNING expires_at`)
                .bind(id, userId, projectId, projectName, JSON.stringify(addresses), protocol, key, timestamp(at), timestamp(at + DEV_SESSION_SECONDS * 1000), MAX_SESSIONS_PER_ACCOUNT)
                .first();
            if (row) return { expiresAt: row.expires_at };
            const held = await db.prepare('SELECT 1 AS held FROM sessions WHERE id = ?').bind(id).first('held');
            return { error: held ? 'taken' : 'full' };
        },

        // Whether the account had a session of that id, which is now gone.
        async remove(userId, id) {
            const { meta } = await db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').bind(id, userId).run();
            return meta.changes > 0;
        },

        // The account's live sessions, the newest first.
        async list(userId) {
            const { results } = await db.prepare('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC, id')
                .bind(userId, timestamp()).all();
            return results.map(sessionOf);
        },

        // A live session of the account, or null: another account's, an ended one and an unknown one alike.
        async find(userId, id) {
            const row = await db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?').bind(id, userId, timestamp()).first();
            return row && sessionOf(row);
        },

        // Run daily: every session past its life.
        async prune() {
            await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(timestamp()).run();
        },
    };
}
