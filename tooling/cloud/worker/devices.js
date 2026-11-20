import { hashOf } from './accounts.js';
import { randomToken } from './session.js';

// crossbind's own device sign-in, RFC 8628 with the number match: a device, the crossbind app or `crossbind login`, asks
// for a code; its person enters the code on the device page (/device, worker/device-page.js), signed in there, approves
// it, and types on the device the number that page shows. The device code is kept as its hash alone.

export const DEVICE_CODE_SECONDS = 600;
export const POLL_SECONDS = 5;
// Sign-ins started by everyone together in a minute (worker/quota.js startSignIn): a flood of starts from many networks
// holds sign-ins up while it lasts, but cannot write rows without end.
export const STARTS_PER_MINUTE = 300;
// Eight letters with no vowel, so that no code spells a word, and none that passes for a digit (RFC 8628 6.1): about
// 34.5 bits.
export const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 8;
// The number the page shows and the device types: two digits, one try.
export const MATCH_FROM = 10;
export const MATCH_TO = 99;
const MAX_CODE_DRAWS = 3;
const MAX_TYPED_LENGTH = 32;
const PLATFORMS = Object.freeze({
    ios: 'iOS', ipados: 'iPadOS', android: 'Android', macos: 'macOS', windows: 'Windows', linux: 'Linux',
});
// A release's version, a prerelease's too ("2.0.0-beta.79"), and a system's ("27.1", "10.0.26100").
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[a-z]{1,8}\.\d{1,4})?$/;
const SYSTEM_VERSION = /^\d{1,5}(\.\d{1,5}){0,2}$/;
// The fields each client sends, and no other: nothing of a start is free text.
const FIELDS = Object.freeze({ cli: ['client', 'version'], app: ['client', 'os', 'platform', 'version'] });
const TYPED = new RegExp(`^[${CODE_LETTERS}]{${CODE_LENGTH}}$`);

// Values below `count` drawn evenly from random bytes: a byte at or past the last whole multiple of `count` is drawn
// again, as `byte % count` alone would favour the first values.
function drawEvenly(count, length) {
    const limit = 256 - (256 % count);
    const drawn = [];
    while (drawn.length < length) {
        for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
            if (byte < limit && drawn.length < length) drawn.push(byte % count);
        }
    }
    return drawn;
}

export const drawUserCode = () => drawEvenly(CODE_LETTERS.length, CODE_LENGTH).map((index) => CODE_LETTERS[index]).join('');
export const drawMatch = () => MATCH_FROM + drawEvenly(MATCH_TO - MATCH_FROM + 1, 1)[0];

// Shown as NPCC-CNQN.
export const shownCode = (code) => `${code.slice(0, CODE_LENGTH / 2)}-${code.slice(CODE_LENGTH / 2)}`;

// A code as its person typed it: in any case, with or without dashes and spaces (RFC 8628 6.1). Null for anything else.
export function typedCode(text) {
    if (typeof text !== 'string' || text.length > MAX_TYPED_LENGTH) return null;
    const code = text.toUpperCase().replace(/[\s-]/g, '');
    return TYPED.test(code) ? code : null;
}

// What asked, in words made from its checked fields alone and never from a name its person gave the device: "crossbind
// app 1.0.0 on iOS 27.1" or "crossbind CLI 2.0.0-beta.79". Null for a body out of its form.
export function deviceLabel(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(FIELDS, body.client)) return null;
    if (Object.keys(body).sort().join() !== FIELDS[body.client].join()) return null;
    if (typeof body.version !== 'string' || !VERSION.test(body.version)) return null;
    if (body.client === 'cli') return `crossbind CLI ${body.version}`;
    if (typeof body.platform !== 'string' || !Object.hasOwn(PLATFORMS, body.platform) || typeof body.os !== 'string' || !SYSTEM_VERSION.test(body.os)) return null;
    return `crossbind app ${body.version} on ${PLATFORMS[body.platform]} ${body.os}`;
}

// The device's country as Cloudflare reads it from its address, when it names one: XX is Cloudflare's unknown.
export function countryOf(request) {
    const country = request.cf?.country;
    return typeof country === 'string' && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null;
}

// The device codes in D1 (migrations/0002), each found by its hash: the device holds the code alone.
export function createDeviceCodes(db, now = () => Date.now()) {
    const timestamp = (at = now()) => new Date(at).toISOString();

    return {
        // A sign-in started: { deviceCode, userCode }. A user code that a row not yet pruned holds is drawn again.
        async start({ client, label, country }) {
            const deviceCode = randomToken();
            const hash = await hashOf(deviceCode);
            const at = now();
            for (let draw = 0; draw < MAX_CODE_DRAWS; draw += 1) {
                const userCode = drawUserCode();
                try {
                    await db.prepare(`INSERT INTO device_codes (hash, user_code, client, label, country, created_at, expires_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(hash, userCode, client, label, country, timestamp(at), timestamp(at + DEVICE_CODE_SECONDS * 1000)).run();
                    return { deviceCode, userCode };
                } catch (error) {
                    if (!/UNIQUE constraint failed: device_codes\.user_code/.test(error.message)) throw error;
                }
            }
            throw new Error('no free user code was drawn');
        },

        // What a device's poll finds by its code's hash: { error }, RFC 8628 3.5's or `matching_required`, with
        // `mismatch` for a wrong number; or the sign-in its person approved, { userId, client, label }. One try: the
        // statement that compares the number ends the code, whichever way it goes, so numbers sent at once get one.
        async poll(hash, match) {
            const row = await db.prepare('SELECT state, expires_at FROM device_codes WHERE hash = ?').bind(hash).first();
            if (!row) return { error: 'invalid_grant' };
            if (Date.parse(row.expires_at) <= now()) return { error: 'expired_token' };
            if (row.state === 'pending') return { error: 'authorization_pending' };
            if (row.state !== 'approved') return { error: 'access_denied' };
            if (match === undefined) return { error: 'matching_required' };
            const ended = await db.prepare(`UPDATE device_codes SET state = CASE WHEN match = ?2 THEN 'used' ELSE 'denied' END
                WHERE hash = ?1 AND state = 'approved' AND expires_at > ?3 RETURNING state, user_id, client, label`).bind(hash, match, timestamp()).first();
            if (ended?.state !== 'used') return { error: 'access_denied', mismatch: ended?.state === 'denied' };
            return { userId: String(ended.user_id), client: ended.client, label: ended.label };
        },

        // The code a person entered on the page, while it waits: { client, label, country, createdAt }, or null.
        async waiting(userCode) {
            const row = await db.prepare(`SELECT client, label, country, created_at FROM device_codes
                WHERE user_code = ? AND state = 'pending' AND expires_at > ?`).bind(userCode, timestamp()).first();
            return row && {
                client: row.client, label: row.label, country: row.country, createdAt: row.created_at,
            };
        },

        // Approves a waiting code for the account: { match, label }, the number for the page alone to show, or null when
        // no code waits.
        async approve(userCode, userId) {
            const match = drawMatch();
            const row = await db.prepare(`UPDATE device_codes SET state = 'approved', user_id = ?2, match = ?3
                WHERE user_code = ?1 AND state = 'pending' AND expires_at > ?4 RETURNING label`).bind(userCode, userId, match, timestamp()).first();
            return row && { match, label: row.label };
        },

        // Denies a waiting code: whether one waited.
        async deny(userCode) {
            const { meta } = await db.prepare(`UPDATE device_codes SET state = 'denied'
                WHERE user_code = ? AND state = 'pending' AND expires_at > ?`).bind(userCode, timestamp()).run();
            return meta.changes > 0;
        },

        // Run daily: every code past its ten minutes, whatever came of it.
        async prune() {
            await db.prepare('DELETE FROM device_codes WHERE expires_at < ?').bind(timestamp()).run();
        },
    };
}
