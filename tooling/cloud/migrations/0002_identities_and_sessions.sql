-- Identities, devices' sign-ins and preview sessions. An account keeps the id it has, which so far has always been its
-- GitHub user id and from here on names the account alone; each way into the account is an identity. This only adds,
-- so code that reads none of it runs on it as before.
-- No CHECK holds a list that may grow (a provider, a client, a state, a source): SQLite changes a table's checks only
-- by making the table again. The Worker is the only writer, and its tests hold the lists.

-- An account's GitHub account or Apple ID. Not tied to users: an identity that leaves an account, unlinked or with the
-- account deleted, stays under its id while that id has build seconds this month, so that no other account starts a
-- fresh month with it.
CREATE TABLE identities (
    provider TEXT NOT NULL, -- 'github' or 'apple'
    subject TEXT NOT NULL, -- the GitHub user id, or Apple's `sub`
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    unlinked_at TEXT, -- unlinked from an account that is still there: held under it until its month's seconds go
    PRIMARY KEY (provider, subject)
);

-- One identity of each provider among an account's linked ones; a held one does not count.
CREATE UNIQUE INDEX identities_by_user ON identities (user_id, provider) WHERE unlinked_at IS NULL;

-- Every account so far was made by signing in with GitHub, under its GitHub id; so were those deleted this month,
-- whose build seconds stay under that id until the month ends.
INSERT INTO identities (provider, subject, user_id, created_at)
    SELECT 'github', CAST(id AS TEXT), id, created_at FROM users;
INSERT OR IGNORE INTO identities (provider, subject, user_id, created_at)
    SELECT DISTINCT 'github', CAST(user_id AS TEXT), user_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM build_usage;

-- The Worker's sign-in makes an account under its GitHub id and writes no identity: this gives the account its own.
-- Ids of crossbind's own start at 2^40, above every GitHub id, and get none.
CREATE TRIGGER users_github_identity AFTER INSERT ON users WHEN NEW.id < 1099511627776
BEGIN
    INSERT OR IGNORE INTO identities (provider, subject, user_id, created_at)
        VALUES ('github', CAST(NEW.id AS TEXT), NEW.id, NEW.created_at);
END;

-- No cookie of the site made before this moment counts: signing out everywhere sets it.
ALTER TABLE users ADD COLUMN signed_out_at TEXT;

-- The client a token is for, 'cli' (crossbind login) or 'app' (the crossbind app), and the words its account sees it
-- by. Every token so far is the CLI's.
ALTER TABLE tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'cli';
ALTER TABLE tokens ADD COLUMN label TEXT NOT NULL DEFAULT 'crossbind CLI';

-- A device signing in with a code that its person approves on the account's page, and then with the number that page
-- shows.
CREATE TABLE device_codes (
    hash TEXT PRIMARY KEY, -- the SHA-256 of the device code, which the device alone holds
    user_code TEXT NOT NULL UNIQUE, -- eight letters of BCDFGHJKLMNPQRSTVWXZ
    client TEXT NOT NULL, -- 'app' or 'cli'
    label TEXT NOT NULL, -- what asked, made from checked fields alone: "crossbind app 1.0.0, iOS 27.1"
    country TEXT, -- the device's country, as Cloudflare reads it from its address
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'denied' or 'used'
    user_id INTEGER REFERENCES users (id) ON DELETE CASCADE, -- the account that approved it
    match INTEGER -- the number shown where it was approved
);

CREATE INDEX device_codes_by_expiry ON device_codes (expires_at);

-- A project served to one account's devices: by crossbind app preview from a dev server, or as a snapshot.
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, -- 16 random bytes in base64url: the CLI's for a dev server, the cloud's for a snapshot
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    source TEXT NOT NULL, -- 'dev' or 'snapshot'
    project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    addresses TEXT NOT NULL, -- JSON: a dev server's host:port list, [] for a snapshot
    protocol INTEGER NOT NULL,
    key TEXT NOT NULL, -- the pairing key, 32 bytes in base64url
    upload TEXT, -- a snapshot's live upload, under snapshots/<id>/<upload>/
    bytes INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 0, -- rises with each upload of a snapshot
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX sessions_by_user ON sessions (user_id, expires_at);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);
-- An account's one snapshot of a project, which the cloud finds by the two.
CREATE UNIQUE INDEX sessions_snapshot ON sessions (user_id, project_id) WHERE source = 'snapshot';
