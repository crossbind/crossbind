-- A GitHub account younger than 30 days signs in as a new account, whose 30 days run from the moment GitHub made it
-- (worker/accounts.js buildsOpenOn): that moment, kept with such an account's identity alone. Every identity so far is of
-- a GitHub account that was 30 days old when it came, or of Apple, and has none. This only adds: the code before it runs
-- on it as before, and the code that reads it is deployed once it is applied.
ALTER TABLE identities ADD COLUMN github_created_at TEXT;
