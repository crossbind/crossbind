-- Every account is now made through an identity (worker/accounts.js), never under a GitHub id, so the trigger that gave
-- such an account its identity has nothing left to do. The two that take a deleted account's identities stay.
DROP TRIGGER users_github_identity;
