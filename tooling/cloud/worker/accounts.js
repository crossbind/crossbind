import { randomToken } from './session.js';

export const MAX_TOKENS_PER_USER = 20;
// A token left behind (an old machine, a CI log) stops working on its own.
export const TOKEN_IDLE_DAYS = 90;

const TOKEN_PATTERN = /^cbt_[A-Za-z0-9_-]{43}$/;
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
const hashOf = async (token) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
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

export const ACCOUNT_BLOCKED = 'This GitHub account may not use crossbind cloud.';

// The key a signed-in user's daily playground compiles count under (worker/quota.js).
export const userKey = (id) => `user:${id}`;

export const isTokenShaped = (token) => typeof token === 'string' && TOKEN_PATTERN.test(token);

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
        // The account an identity signs in to, made at once for an identity crossbind does not know: { user }, or
        // { freeFrom } for one unlinked from an account with build seconds this month, which holds it until the 1st.
        // An account deleted this month comes back under its id, its month spent: while its seconds stay, so do its
        // identities (migrations/0002's triggers). Never looked up by a GitHub id.
        async signIn({ provider, subject, login }) {
            for (let attempt = 0; attempt < MAX_SIGN_IN_ATTEMPTS; attempt += 1) {
                const identity = await db.prepare('SELECT user_id, unlinked_at FROM identities WHERE provider = ? AND subject = ?').bind(provider, subject).first();
                if (identity?.unlinked_at === null) {
                    const row = await db.prepare(`INSERT INTO users (id, login, created_at, last_login_at) VALUES (?1, ?2, ?3, ?3)
                        ON CONFLICT (id) DO UPDATE SET login = excluded.login, last_login_at = excluded.last_login_at
                        RETURNING id, login, blocked`).bind(identity.user_id, login, timestamp()).first();
                    return { user: userOf(row) };
                }
                if (identity) {
                    if (await hasSecondsThisMonth(identity.user_id)) return { freeFrom: firstOfNextMonth(now()) };
                    await db.prepare('DELETE FROM identities WHERE provider = ? AND subject = ? AND unlinked_at IS NOT NULL').bind(provider, subject).run();
                }
                const user = await createAccount({ provider, subject, login });
                if (user) return { user };
            }
            throw new Error(`no account could be made for this ${provider} sign-in`);
        },

        // Whether an account still exists, as a session of another browser may outlive it, and whether it is blocked.
        async standing(id) {
            const blocked = await db.prepare('SELECT blocked FROM users WHERE id = ?').bind(id).first('blocked');
            return { exists: blocked !== null, blocked: blocked === 1 };
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

        // Run daily: tokens unused for TOKEN_IDLE_DAYS, build seconds older than USAGE_MONTHS_KEPT months, and those of
        // deleted accounts once their month is over.
        async prune() {
            const at = now();
            await db.batch([
                db.prepare('DELETE FROM tokens WHERE last_used_at < ?').bind(new Date(at - TOKEN_IDLE_DAYS * DAY_MS).toISOString()),
                db.prepare('DELETE FROM build_usage WHERE month < ?').bind(monthsBefore(at, USAGE_MONTHS_KEPT)),
                db.prepare('DELETE FROM build_usage WHERE month < ? AND user_id NOT IN (SELECT id FROM users)').bind(periodsOf(at).month),
            ]);
        },

        // The token is shown once and only its hash is kept. An account keeps its most recently used tokens.
        async issueToken(userId) {
            const token = `cbt_${randomToken()}`;
            const at = timestamp();
            await db.batch([
                db.prepare('INSERT INTO tokens (hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)').bind(await hashOf(token), userId, at, at),
                db.prepare(`DELETE FROM tokens WHERE user_id = ?1 AND hash NOT IN
                    (SELECT hash FROM tokens WHERE user_id = ?1 ORDER BY last_used_at DESC, created_at DESC LIMIT ?2)`).bind(userId, MAX_TOKENS_PER_USER),
            ]);
            return token;
        },

        async userOfToken(token) {
            if (!isTokenShaped(token)) return null;
            const hash = await hashOf(token);
            const row = await db.prepare(`SELECT users.id, users.login, users.blocked, tokens.last_used_at, tokens.kind FROM tokens
                JOIN users ON users.id = tokens.user_id WHERE tokens.hash = ?`).bind(hash).first();
            if (!row) return null;
            const idle = now() - Date.parse(row.last_used_at);
            if (idle >= TOKEN_IDLE_DAYS * DAY_MS) {
                await db.prepare('DELETE FROM tokens WHERE hash = ?').bind(hash).run();
                return null;
            }
            if (idle >= TOUCH_EVERY_MS) {
                await db.prepare('UPDATE tokens SET last_used_at = ? WHERE hash = ?').bind(timestamp(), hash).run();
            }
            return { ...userOf(row), kind: row.kind };
        },

        async revokeToken(token) {
            if (isTokenShaped(token)) await db.prepare('DELETE FROM tokens WHERE hash = ?').bind(await hashOf(token)).run();
        },

        async revokeTokens(userId) {
            await db.prepare('DELETE FROM tokens WHERE user_id = ?').bind(userId).run();
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
