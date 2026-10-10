-- crossbind cloud accounts: everyone who signed in with GitHub, on the playground page or with `crossbind login`.
-- Times are ISO 8601 in UTC.

CREATE TABLE users (
    id INTEGER PRIMARY KEY, -- the GitHub user id
    login TEXT NOT NULL, -- the GitHub user name at the last sign-in
    created_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL,
    blocked INTEGER NOT NULL DEFAULT 0
);

-- CLI tokens, kept only as the SHA-256 of the token.
CREATE TABLE tokens (
    hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
);

CREATE INDEX tokens_by_user ON tokens (user_id, last_used_at);

-- Seconds of cloud builds per user, month (YYYY-MM) and toolchain image. Not tied to users on purpose: a deleted
-- account must not come back with a fresh month.
CREATE TABLE build_usage (
    user_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    image TEXT NOT NULL,
    seconds REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, month, image)
);

-- Seconds of cloud builds for everyone together, per month (YYYY-MM) and per day (YYYY-MM-DD): the ceilings on what
-- a month costs and on how much of it one day may spend.
CREATE TABLE build_totals (
    period TEXT PRIMARY KEY,
    seconds REAL NOT NULL DEFAULT 0
);
