import { randomToken } from './session.js';

export const MAX_TOKENS_PER_USER = 20;
// The crossbind app's tokens an account keeps, one for each device signed in with a code, as the CLI's 20 are kept.
export const MAX_APP_TOKENS_PER_USER = 10;
const TOKENS_KEPT = Object.freeze({ cli: MAX_TOKENS_PER_USER, app: MAX_APP_TOKENS_PER_USER });
// A token left behind (an old machine, a CI log) stops working on its own.
export const TOKEN_IDLE_DAYS = 90;

const TOKEN_PATTERN = /^cbt_[A-Za-z0-9_-]{43}$/;
// A device on the account's page is named by the first 64 bits of its token's hash.
export const DEVICE_REF_LENGTH = 16;
const DAY_MS = 24 * 3600 * 1000;
// Every authenticated call reads its token; writing back each use would turn every read into a write.
const TOUCH_EVERY_MS = 3600 * 1000;
// The months of build seconds kept before the current one: enough to answer for a recent bill or look into abuse.
export const USAGE_MONTHS_KEPT = 3;
// Ids of crossbind's own: above every GitHub id, which the accounts made before them keep as their ids, and below
// 2^53, so that each is exact in JavaScript.
export const OWN_IDS_FROM = 2 ** 40;
export const OWN_IDS_BELOW = 2 ** 53;
// An id drawn that is taken is drawn again, which with 2^53 ids is next to never; two sign-ins that make one
// identity's account at once meet on its row, and the later one signs in to the other's.
const MAX_SIGN_IN_ATTEMPTS = 3;

const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
// A token, or a device's sign-in code, is kept as this alone.
export const hashOf = async (token) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
const userOf = (row) => ({ id: String(row.id), login: row.login, blocked: row.blocked === 1 });
// The month (YYYY-MM) and the day (YYYY-MM-DD) of a moment, in UTC.
const periodsOf = (at) => {
    const day = new Date(at).toISOString().slice(0, 10);
    return { month: day.slice(0, 7), day };
};
const monthsBefore = (at, months) => {
    const date = new Date(at);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1)).toISOString().slice(0, 7);
};
const firstOfNextMonth = (at) => `${monthsBefore(at, -1)}-01`;
const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

// 2026-12-01 as "1 December 2026", made without a locale's data, which workerd need not have as Node has it.
export const dayWords = (day) => {
    const [year, month, date] = day.split('-').map(Number);
    return `${date} ${MONTH_NAMES[month - 1]} ${year}`;
};

export const ACCOUNT_BLOCKED = 'This account may not use crossbind cloud.';

// The key a signed-in user's daily playground compiles count under (worker/quota.js).
export const userKey = (id) => `user:${id}`;

// The name an account goes by: its GitHub name while a GitHub account is linked, else "Apple account …1643", the last
// four digits of its id.
export const nameOf = ({ id, login }) => login || `Apple account …${String(id).slice(-4)}`;

export const isTokenShaped = (token) => typeof token === 'string' && TOKEN_PATTERN.test(token);

// An account with no GitHub account linked is new for its first `days` days, as a GitHub account must be that old to
// sign in: it has no cloud build minutes, and the playground's compiles of a new account. The day they open to it, or
// null for an account that is not new.
export function buildsOpenOn({ createdAt, github }, days, at) {
    const opens = Date.parse(createdAt) + days * DAY_MS;
    return !github && opens > at ? new Date(opens).toISOString().slice(0, 10) : null;
}

// Whether a GitHub account is linked to the row's account.
const LINKED_GITHUB = "EXISTS (SELECT 1 FROM identities WHERE identities.user_id = users.id AND identities.provider = 'github' AND identities.unlinked_at IS NULL)";

// An id of crossbind's own, drawn evenly: 53 random bits, drawn again below OWN_IDS_FROM.
export function randomAccountId() {
    let id;
    do {
        const [high, low] = crypto.getRandomValues(new Uint32Array(2));
        id = (high >>> 11) * 2 ** 32 + low;
    } while (id < OWN_IDS_FROM);
    return id;
}

// The accounts in D1 (migrations/): the identities each signs in with, its tokens and its cloud build seconds. An
// account made before identities keeps its GitHub id as its id; a later one has an id of crossbind's own. Ids are
// strings here.
export function createAccounts(db, now = () => Date.now(), drawId = randomAccountId) {
    const timestamp = () => new Date(now()).toISOString();
    const hasSecondsThisMonth = async (id) => (await db.prepare('SELECT EXISTS (SELECT 1 FROM build_usage WHERE user_id = ? AND month = ?) AS spent')
        .bind(id, periodsOf(now()).month).first('spent')) === 1;
    // An identity unlinked from an account with build seconds is held through the month of its unlinking, and no longer.
    const isThisMonth = (time) => time.slice(0, 7) === periodsOf(now()).month;

    // A plain INSERT, never an upsert, which on an id taken would sign the person in to someone else's account. An id
    // that a deleted account's identities or seconds still name is taken too. Null when the id drawn was taken, or
    // when the identity's account was made meanwhile.
    async function createAccount({ provider, subject, login }) {
        const id = drawId();
        const named = await db.prepare(`SELECT EXISTS (SELECT 1 FROM identities WHERE user_id = ?1)
            OR EXISTS (SELECT 1 FROM build_usage WHERE user_id = ?1) AS named`).bind(id).first('named');
        if (named === 1) return null;
        const at = timestamp();
        try {
            const [made] = await db.batch([
                db.prepare('INSERT INTO users (id, login, created_at, last_login_at) VALUES (?1, ?2, ?3, ?3) RETURNING id, login, blocked').bind(id, login, at),
                db.prepare('INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)').bind(provider, subject, id, at),
            ]);
            return userOf(made.results[0]);
        } catch (error) {
            if (/UNIQUE constraint failed: (users\.id|identities\.provider)/.test(error.message)) return null;
            throw error;
        }
    }

    return {
        // The account an identity signs in to: { user }, or { freeFrom } for one unlinked this month from an account
        // with build seconds then (unlink), which holds it until the 1st; one unlinked in an earlier month is free. An
        // identity crossbind does not know makes its account at once, or with `create: false` answers { unknown },
        // for the page to ask its person first. An account deleted this month comes back under its id, its month
        // spent: while its seconds stay, so do its identities (migrations/0002's triggers). Never looked up by a
        // GitHub id.
        async signIn({ provider, subject, login }, { create = true } = {}) {
            for (let attempt = 0; attempt < MAX_SIGN_IN_ATTEMPTS; attempt += 1) {
                const identity = await db.prepare('SELECT user_id, unlinked_at FROM identities WHERE provider = ? AND subject = ?').bind(provider, subject).first();
                if (identity?.unlinked_at === null) {
                    // A blocked account's row stays as it is: the sign-in it refuses writes nothing to it. The GitHub name
                    // comes from a GitHub sign-in alone: Apple's brings none.
                    const row = await db.prepare(`INSERT INTO users (id, login, created_at, last_login_at) VALUES (?1, ?2, ?3, ?3)
                        ON CONFLICT (id) DO UPDATE SET login = CASE WHEN ?4 = 'github' THEN excluded.login ELSE users.login END,
                        last_login_at = excluded.last_login_at WHERE users.blocked = 0
                        RETURNING id, login, blocked`).bind(identity.user_id, login, timestamp(), provider).first()
                        ?? await db.prepare('SELECT id, login, blocked FROM users WHERE id = ?').bind(identity.user_id).first();
                    return { user: userOf(row) };
                }
                if (identity) {
                    if (isThisMonth(identity.unlinked_at)) return { freeFrom: firstOfNextMonth(now()) };
                    await db.prepare('DELETE FROM identities WHERE provider = ? AND subject = ? AND unlinked_at IS NOT NULL').bind(provider, subject).run();
                }
                if (!create) return { unknown: true };
                const user = await createAccount({ provider, subject, login });
                if (user) return { user };
            }
            throw new Error(`no account could be made for this ${provider} sign-in`);
        },

        // Whether an account still exists, as a session of another browser may outlive it, whether it is blocked, its
        // GitHub name and the name it goes by, when it last signed out everywhere (no cookie made before then counts),
        // and when it was made and whether a GitHub account is linked (buildsOpenOn).
        async standing(id) {
            const row = await db.prepare(`SELECT login, blocked, signed_out_at, created_at, ${LINKED_GITHUB} AS github FROM users WHERE id = ?`).bind(id).first();
            return {
                exists: row !== null,
                blocked: row?.blocked === 1,
                login: row?.login ?? '',
                name: row ? nameOf({ id, login: row.login }) : '',
                signedOutAt: row?.signed_out_at ?? null,
                createdAt: row?.created_at ?? null,
                github: row?.github === 1,
            };
        },

        // The account and its tokens go at once. Its seconds of the current month stay under the bare id until the
        // month ends (prune), so a new sign-in does not bring a fresh month; a blocked account stays as its id, or
        // deleting it would lift the block. Its identities go with the row, or with the last of those seconds
        // (migrations/0002's triggers).
        async deleteAccount(id) {
            await db.batch([
                db.prepare('DELETE FROM tokens WHERE user_id = ?').bind(id),
                db.prepare('DELETE FROM build_usage WHERE user_id = ? AND month < ?').bind(id, periodsOf(now()).month),
                db.prepare("UPDATE users SET login = '' WHERE id = ? AND blocked = 1").bind(id),
                db.prepare('DELETE FROM users WHERE id = ? AND blocked = 0').bind(id),
            ]);
        },

        // Links an identity to a live account: { outcome } of 'linked', 'already', 'has-one' with the account's GitHub
        // name, 'taken' with the name of the account the identity signs in to, 'blocked', 'held' with { freeFrom }, or
        // 'failed' when another request linked or signed in meanwhile. No identity moves from another account: one
        // that account holds, live, deleted with build seconds this month, or unlinked from it this month (signIn),
        // stays. Linking GitHub writes the account's GitHub name, and ends its first 30 days without one.
        async link(userId, { provider, subject, login }) {
            const row = await db.prepare(`SELECT identities.user_id, identities.unlinked_at, users.id IS NOT NULL AS live, users.login, users.blocked
                FROM identities LEFT JOIN users ON users.id = identities.user_id WHERE provider = ? AND subject = ?`).bind(provider, subject).first();
            const mine = row !== null && String(row.user_id) === userId;
            if (mine && row.unlinked_at === null) return { outcome: 'already' };
            const own = await db.prepare(`SELECT users.login FROM identities JOIN users ON users.id = identities.user_id
                WHERE identities.user_id = ? AND identities.provider = ? AND identities.unlinked_at IS NULL`).bind(userId, provider).first();
            if (own) return { outcome: 'has-one', name: own.login };
            if (row && !mine) {
                if (row.unlinked_at === null && row.live === 1) {
                    return row.blocked === 1 ? { outcome: 'blocked' } : { outcome: 'taken', name: nameOf({ id: row.user_id, login: row.login }) };
                }
                const held = row.unlinked_at === null ? await hasSecondsThisMonth(row.user_id) : isThisMonth(row.unlinked_at);
                if (held) return { outcome: 'held', freeFrom: firstOfNextMonth(now()) };
            }
            // The delete takes the row only as the read found it free: this account's own, one whose account is gone with
            // no build seconds this month, or one unlinked in an earlier month. A row another request changed meanwhile
            // stays, and the insert then fails on it.
            try {
                await db.batch([
                    db.prepare(`DELETE FROM identities WHERE provider = ?1 AND subject = ?2 AND (user_id = ?3
                        OR (user_id NOT IN (SELECT id FROM users) AND NOT EXISTS (SELECT 1 FROM build_usage WHERE build_usage.user_id = identities.user_id AND month = ?4))
                        OR unlinked_at < ?4)`).bind(provider, subject, userId, periodsOf(now()).month),
                    db.prepare('INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)').bind(provider, subject, userId, timestamp()),
                    ...(provider === 'github' ? [db.prepare('UPDATE users SET login = ? WHERE id = ?').bind(login, userId)] : []),
                ]);
            } catch (error) {
                if (/UNIQUE constraint failed: identities\./.test(error.message)) return { outcome: 'failed' };
                throw error;
            }
            return { outcome: 'linked' };
        },

        // The providers an account signs in with, for its page.
        async providersOf(userId) {
            const { results } = await db.prepare('SELECT provider FROM identities WHERE user_id = ? AND unlinked_at IS NULL ORDER BY provider').bind(userId).all();
            return results.map((row) => row.provider);
        },

        // A way into the account taken away, never the last one: { outcome } of 'unlinked', 'held' with { freeFrom },
        // 'last' or 'none'. Without build seconds this month the identity is free at once; with them it is held under
        // the account until the month ends (signIn), so that no other account starts a fresh month with it. Unlinking
        // GitHub blanks the account's GitHub name.
        async unlink(userId, provider) {
            const { results } = await db.prepare('SELECT provider FROM identities WHERE user_id = ? AND unlinked_at IS NULL').bind(userId).all();
            if (!results.some((row) => row.provider === provider)) return { outcome: 'none' };
            if (results.length < 2) return { outcome: 'last' };
            const held = await hasSecondsThisMonth(userId);
            await db.batch([
                held
                    ? db.prepare('UPDATE identities SET unlinked_at = ? WHERE user_id = ? AND provider = ? AND unlinked_at IS NULL').bind(timestamp(), userId, provider)
                    : db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ? AND unlinked_at IS NULL').bind(userId, provider),
                ...(provider === 'github' ? [db.prepare("UPDATE users SET login = '' WHERE id = ?").bind(userId)] : []),
            ]);
            return held ? { outcome: 'held', freeFrom: firstOfNextMonth(now()) } : { outcome: 'unlinked' };
        },

        // Run daily: tokens unused for TOKEN_IDLE_DAYS, build seconds older than USAGE_MONTHS_KEPT months, those of
        // deleted accounts once their month is over, and identities unlinked in an earlier month.
        async prune() {
            const at = now();
            await db.batch([
                db.prepare('DELETE FROM tokens WHERE last_used_at < ?').bind(new Date(at - TOKEN_IDLE_DAYS * DAY_MS).toISOString()),
                db.prepare('DELETE FROM build_usage WHERE month < ?').bind(monthsBefore(at, USAGE_MONTHS_KEPT)),
                db.prepare('DELETE FROM build_usage WHERE month < ? AND user_id NOT IN (SELECT id FROM users)').bind(periodsOf(at).month),
                db.prepare('DELETE FROM identities WHERE unlinked_at < ?').bind(periodsOf(at).month),
            ]);
        },

        // The token is shown once and only its hash is kept, with its kind, `cli` or `app`, and the words its account sees
        // it by. An account keeps its most recently used tokens of each kind.
        async issueToken(userId, { kind = 'cli', label = 'crossbind CLI' } = {}) {
            const token = `cbt_${randomToken()}`;
            const at = timestamp();
            await db.batch([
                db.prepare('INSERT INTO tokens (hash, user_id, created_at, last_used_at, kind, label) VALUES (?, ?, ?, ?, ?, ?)').bind(await hashOf(token), userId, at, at, kind, label),
                db.prepare(`DELETE FROM tokens WHERE user_id = ?1 AND kind = ?2 AND hash NOT IN
                    (SELECT hash FROM tokens WHERE user_id = ?1 AND kind = ?2 ORDER BY last_used_at DESC, created_at DESC LIMIT ?3)`).bind(userId, kind, TOKENS_KEPT[kind]),
            ]);
            return token;
        },

        async userOfToken(token) {
            if (!isTokenShaped(token)) return null;
            const hash = await hashOf(token);
            const row = await db.prepare(`SELECT users.id, users.login, users.blocked, users.created_at, ${LINKED_GITHUB} AS github, tokens.last_used_at, tokens.kind
                FROM tokens JOIN users ON users.id = tokens.user_id WHERE tokens.hash = ?`).bind(hash).first();
            if (!row) return null;
            const idle = now() - Date.parse(row.last_used_at);
            if (idle >= TOKEN_IDLE_DAYS * DAY_MS) {
                await db.prepare('DELETE FROM tokens WHERE hash = ?').bind(hash).run();
                return null;
            }
            if (idle >= TOUCH_EVERY_MS) {
                await db.prepare('UPDATE tokens SET last_used_at = ? WHERE hash = ?').bind(timestamp(), hash).run();
            }
            return {
                ...userOf(row), kind: row.kind, createdAt: row.created_at, github: row.github === 1,
            };
        },

        async revokeToken(token) {
            if (isTokenShaped(token)) await db.prepare('DELETE FROM tokens WHERE hash = ?').bind(await hashOf(token)).run();
        },

        // Every token of the account, and every cookie of the site made before this moment.
        async signOutEverywhere(userId) {
            await db.batch([
                db.prepare('UPDATE users SET signed_out_at = ? WHERE id = ?').bind(timestamp(), userId),
                db.prepare('DELETE FROM tokens WHERE user_id = ?').bind(userId),
            ]);
        },

        // The account's devices, its tokens by the last use, each named by a reference that is neither the token nor
        // its whole hash.
        async devices(userId) {
            const { results } = await db.prepare(`SELECT substr(hash, 1, ${DEVICE_REF_LENGTH}) AS ref, kind, label, created_at, last_used_at FROM tokens
                WHERE user_id = ? ORDER BY last_used_at DESC, created_at DESC`).bind(userId).all();
            return results.map((row) => ({
                ref: row.ref, kind: row.kind, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at,
            }));
        },

        // The kind of the account's device that had that reference, whose token is now revoked, or null where none had it.
        async revokeDevice(userId, ref) {
            return (await db.prepare(`DELETE FROM tokens WHERE user_id = ? AND substr(hash, 1, ${DEVICE_REF_LENGTH}) = ? RETURNING kind`).bind(userId, ref).first('kind')) ?? null;
        },

        // Seconds a cloud runner was up until `at`, for its user and image, and for everyone's month and day.
        async addBuildSeconds(userId, at, image, seconds) {
            const { month, day } = periodsOf(at);
            const total = db.prepare(`INSERT INTO build_totals (period, seconds) VALUES (?, ?)
                ON CONFLICT (period) DO UPDATE SET seconds = seconds + excluded.seconds`);
            await db.batch([
                db.prepare(`INSERT INTO build_usage (user_id, month, image, seconds) VALUES (?, ?, ?, ?)
                    ON CONFLICT (user_id, month, image) DO UPDATE SET seconds = seconds + excluded.seconds`).bind(userId, month, image, seconds),
                total.bind(month, seconds),
                total.bind(day, seconds),
            ]);
        },

        // The seconds spent in the month of `at` by a user and by everyone, and on its day by everyone.
        async buildBudget(userId, at) {
            const { month, day } = periodsOf(at);
            const row = await db.prepare(`SELECT
                (SELECT coalesce(sum(seconds), 0) FROM build_usage WHERE user_id = ?1 AND month = ?2) AS mine,
                (SELECT coalesce(sum(seconds), 0) FROM build_totals WHERE period = ?2) AS everyone,
                (SELECT coalesce(sum(seconds), 0) FROM build_totals WHERE period = ?3) AS today`).bind(userId, month, day).first();
            return { mine: row.mine, everyone: row.everyone, today: row.today };
        },

        // { [image]: seconds } of one month (YYYY-MM).
        async buildSeconds(userId, month) {
            const { results } = await db.prepare('SELECT image, seconds FROM build_usage WHERE user_id = ? AND month = ?').bind(userId, month).all();
            return Object.fromEntries(results.map(({ image, seconds }) => [image, seconds]));
        },
    };
}
