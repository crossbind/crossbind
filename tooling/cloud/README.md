# @crossbind/cloud

crossbind cloud on `api.crossbind.dev`: the compile service behind the playground on crossbind.dev, and the accounts that the playground page and `crossbind login` sign in to. A visitor's project, a `main.js` and C, C++ or Rust sources with packages from the playground's list, is built with crossbind into a wasm module, its loader and the list of what `main.js` imports from it; the page then runs them in the visitor's own browser.

## A compile

- Only the Worker in front reaches `compiler/server.js`: `POST /compile` with `{"files": {"main.js": "...", "native/greet.h": "..."}, "packages": ["port:sqlite3"]}`. Files are `main.js` and sources under `native/` named like C identifiers (`.h`, `.hpp`, `.cpp`, `.cc`, `.rs`), at most 16 of them and 64 KB in all; packages are ids from `compiler/packages.js`, at most 8. The compiler writes `crossbind.config.js` itself. One compile runs at a time, one more may wait, the rest get 503.
- Every compile starts from a copy of `compiler/template`, built once when the image is built at the same path, so cmake's and emscripten's caches are warm. The copy is removed afterwards. That build uses every package (`compiler/warm.js`) and leaves the store: the crates and Conan builds each compile works from without a network. `compiler/template/conan.lock` and `crossbind.cargo.lock` pin the Conan recipes and every crate, and an image build that resolves others stops with the diff to commit.
- `crossbind build -p wasm -a wasm32 -r st -e browser -b debug --bind-imports` runs in the sandbox below; the server returns the loader, the wasm (base64), the list of what `main.js` imports (`imports.json`) and the build log with workspace paths shortened.
- The site prebuilds every playground sample from the same template, crossbind and packages (`scripts/node-modules.mjs`, used by `scripts/site/build-example-demos.mjs`), so an unedited sample runs the module a compile would make, without one.

## Sandbox

The compiler is treated as compromised:

- **Namespaces** (bubblewrap): user, pid, network, ipc, uts and cgroup. No network, not even loopback to the server; no further user namespaces.
- **Syscalls** (seccomp, `compiler/seccomp.js`): io_uring, bpf, keyctl, perf events, userfaultfd, ptrace, process_vm and module loading fail; sockets open for the unix and internet families only, which keeps out vsock (the microVM's channel to its host), netlink and raw packets.
- **Files**: `/usr`, `/emsdk`, the Rust and Conan toolchains and the CLI read-only, emscripten's cache and the package store behind throwaway overlays, the workspace and a 256 MB `/tmp` writable, `/proc/cmdline` and other kernel files covered. The server code, the template, the store's own folder and `/etc/passwd` are not there.
- **Limits**: 60 s of CPU, 2 GiB of data (the CLI's own node maps about 1.8 GiB, mostly untouched), 128 MiB per file, 64 processes, 1024 open files, 45 s of wall clock and 8 MiB of output. A watchdog stops the compile when the machine (or its cgroup) gets under 256 MiB free, since a sandbox can reset its own OOM score and fill tmpfs mounts no size limit covers.
- **Environment**: the toolchain variables only.
- **Outputs** are read after the sandbox is gone, as regular files through real folders only: no links, FIFOs or oversized files (2 MiB of loader, 6 MiB of wasm, 1 MiB of import list, whose names must be identifiers).
- **Workspace**: removed with `chmod -R` and `rm -rf`, which walk trees deeper than a path can name. One that cannot be removed answers 500 and recycles the server.
- **Recycling**: after 200 compiles, failed ones included, the server takes no new work, answers what it holds and exits; the next compile starts a fresh container. tini is PID 1 and reaps what the sandboxes leave.

On Cloudflare every container is its own Firecracker microVM, started without internet access. The Worker gives a compile back only when the compiler turned it away before it started; a compile that ended the container, or whose answer came back unusable, stays counted.

## The Worker in front

`worker/` is the API on `api.crossbind.dev`. The playground page talks to it under `/playground`:

- `GET /session`: who is signed in, the day's limit and what is left of it, whether GitHub sign-in is set up, and the Turnstile site key.
- `POST /compile`: from the playground page's origin only. An anonymous visitor passes Turnstile first. A compile seen before comes from the cache without counting (a week for a module, ten minutes for a compile error); otherwise it counts against the visitor's network (an IPv6 /64 is one network) or their account, and against the day's total for everyone.
- `GET /login/github` and `/callback/github`: GitHub sign-in that asks for no scope; GitHub accounts younger than 30 days are turned away. PKCE (S256) binds GitHub's code to the browser that asked for it: the verifier waits in an HttpOnly cookie beside the state, so a code caught on its way is worth nothing elsewhere. The GitHub account signs in to its crossbind account (below), and the session is an HMAC-signed, host-only cookie holding the account's id and name.
- `POST /logout`, and `POST /delete-account`, which deletes the signed-in account as `crossbind account delete` does. The site's playground now signs in through the account's start below and deletes on the account's page; `GET /login/github` and `POST /delete-account` stay for the site of the day before, until a later release removes them.

The account's own page is the Worker's, on this same origin (`worker/account-page.js`), so that no other site, crossbind.dev included, can change an account:

- `GET /login`: signed out, "Sign in with GitHub"; signed in, the account's name, its devices (its tokens, by label and first and last use) each with Sign out, "Sign out everywhere", Delete account behind a box to tick, and Sign out. Plain HTML with `/account.css` and `/account.js`, under `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, `Referrer-Policy: same-origin` (under `no-referrer` a form's POST carries `Origin: null`) and `Cache-Control: no-store`. `crossbind.dev/login/` leads here.
- `GET /account/login/github`: the sign-in's start, a link; it comes back to the page, or to `PLAYGROUND_URL` with `?next=playground`, and sends GitHub the playground's callback, `/playground/callback/github`, the one the OAuth app lists.
- `POST /account/logout`, `/account/tokens/revoke` (`ref`: the first 16 hex digits of the token's hash, as the page lists it), `/account/logout-everywhere` and `/account/delete` (`confirm=yes`): the page's forms, which take a request whose `Origin` is this origin alone. Any other, crossbind.dev's too, and none or `null`, get 403; a form whose cookie no longer counts goes back to the page.
- Signing out everywhere, here or with `crossbind logout --all`, deletes every token of the account and sets `users.signed_out_at`, before which no cookie counts. Every route that reads the cookie reads the account's row: a cookie of an account deleted or blocked since, or made before it signed out everywhere, signs in nothing.

The CLI talks to it under `/v1` (`worker/account-api.js`), with a token and without cookies or CORS:

- `POST /v1/login/device` and `POST /v1/login/token`: `crossbind login`, GitHub's device flow. The user enters a code on github.com; the Worker, not the CLI, asks GitHub for the outcome, so no GitHub token leaves it. The CLI polls `/v1/login/token` (202 until the code is approved) and then receives a token of crossbind cloud's own (`cbt_…`). A GitHub account crossbind does not know gets its account at once.
- `GET /v1/usage`: the month's cloud build seconds by toolchain image against the monthly allowance (`BUILD_SECONDS_MONTHLY`), and the day's playground compiles.
- `GET /v1/account`: the account the token signs in to, `{"id": "…", "name": "…"}`.
- `DELETE /v1/token` and `DELETE /v1/tokens`: `crossbind logout`, for the token sent, or `--all`, which signs the account out everywhere as its page does.
- `DELETE /v1/account`: `crossbind account delete`, open to a blocked account too.

Every token has a kind (`tokens.kind`). The CLI's, `cli`, takes every route, the runners' included, and is every token issued so far. The crossbind app's, `app`, takes `GET /v1/account` and the three deletions alone. A route refuses any other kind with 403.

Builds under `RUNNER=REMOTE` talk to it under `/runner/<image>/v1/*`, the runner protocol of `docs/api/remote-runner.md`, with the same token (`worker/runner-api.js`, below).

Every route counts requests per network (an IPv4 address or an IPv6 /64) with Workers rate limiting, before anything that costs: 120 a minute, 10 CLI sign-ins started, and 1,200 runner requests, since a build makes several per step. Limits, allowed origins, the networks that may not compile without signing in (`BLOCKED_NETWORKS`, as `198.51.100.9,2001:db8:85a3:42::`) and the kill switch (`PLAYGROUND_ENABLED`) are `vars` in `wrangler.jsonc`. Deleting the `GITHUB_CLIENT_ID` secret turns signing in off.

## Accounts

D1 (`migrations/`, binding `DB`) keeps every crossbind account, on the page or with the CLI, and the identities it signs in with: the GitHub user id (`identities`), the GitHub name and when it signed in, never an email or a GitHub token; its CLI tokens as SHA-256 hashes, the 20 most recently used per account, each dropped after 90 days unused; and its cloud build seconds per month and image, for the current month and the three before it. An account made before identities keeps its GitHub id as its id; a new one gets an id of crossbind's own, drawn at random from 2^40 up to 2^53, above every GitHub id, by a plain `INSERT` that draws again when an account, or a deleted account's identities or seconds, name the id. A sign-in finds its account by its identity alone, never by a GitHub id. Blocking an account stops its sign-ins, compiles and tokens. Block by the account's id: a GitHub name passes to someone else after a rename.

Deleting an account removes it and its tokens at once, and its earlier months of build seconds; the current month's stay under the bare id until the month ends, so a new sign-in does not bring a fresh month, and a blocked account stays as its id, or deleting it would lift the block. Its identities stay with those seconds, so that signing in with one brings the same id back with its month spent, and go with the last of them, or at once when there are none (the triggers of `migrations/0002`). An identity unlinked from an account that has build seconds this month signs in to nothing until the 1st. A cron trigger prunes daily what is kept only for a while (`prune` in `worker/accounts.js`); `landing/src/pages/privacy.js` states the same periods, and a landing test holds the two together.

Query it from the repository root: in this package wrangler first validates `wrangler.jsonc`, which fails until a deploy or `pnpm build:image` has assembled the image contexts in `.build/`. The first finds an account by its GitHub name, the second blocks the account a GitHub account signs in to, and the third lists the accounts no linked identity signs in to, which only a rollback to the Worker before identities makes (each made then under its GitHub id).

```bash
tooling/cloud/node_modules/.bin/wrangler d1 execute crossbind-accounts --remote --command "SELECT id, login, last_login_at FROM users WHERE login = '<name>'"
tooling/cloud/node_modules/.bin/wrangler d1 execute crossbind-accounts --remote --command "UPDATE users SET blocked = 1 WHERE id = (SELECT user_id FROM identities WHERE provider = 'github' AND subject = '<GitHub id>')"
tooling/cloud/node_modules/.bin/wrangler d1 execute crossbind-accounts --remote --command "SELECT id, login FROM users WHERE id NOT IN (SELECT user_id FROM identities WHERE unlinked_at IS NULL)"
```

GitHub sign-in needs a GitHub OAuth app with its callback at `https://api.crossbind.dev/playground/callback/github` and the device flow enabled; its client id and secret are the `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` secrets. The account's page signs in through the same callback.

## Cloud runners

`worker/runner.js` gives every account a runner of each toolchain image: a Durable Object named after the account's id, holding one container. Each container is a Firecracker microVM of its own, so builds of different accounts share nothing.

- **Image**: the toolchain image this repository's crossbind pins, with `core/crossbind/src/runner` copied in (`runner/Dockerfile`, assembled into `.build/runner-<image>/` by `scripts/build-image.mjs`). Older crossbind releases pin other images, and the runner turns their builds away with `toolchain mismatch`.
- **Requests**: the Worker checks the token, then passes the request on with the account's id in `x-crossbind-user` and, of the caller's headers, only the ones the runner protocol reads (`content-type`, and `content-range` and `x-crossbind-upload` for a file sent in parts): no token, no cookies. A token found valid in the last 30 seconds skips the D1 read and counts on the runners' rate; any other counts on the general one first, so made-up tokens cannot spend D1 reads. The runner's own token is derived from `RUNNER_SECRET` (32 characters at least, or every runner route answers 503), the image and the account, so nothing is stored. The entrypoint starts the runner as the image's unprivileged user, with no capabilities and `no_new_privs`. Build steps run as that user and can read the runner's token from its process; it opens nothing, since only the Durable Object reaches the container.
- **Network**: crates.io, ConanCenter and GitHub (`ALLOWED_HOSTS`), and only to download: GET, HEAD and git's fetch go out, pushes, form posts and uploads are refused (403). Other hosts get Cloudflare's 520, every name resolves to its egress proxy, and no other TCP or UDP leaves. Cloudflare intercepts the HTTPS to hold it to them; the entrypoint adds its CA to the system store at start, and Python reads that store through `REQUESTS_CA_BUNDLE`.
- **Time**: a runner is up from a build's first request until a minute after its last (`RUNNER_IDLE_SECONDS`), and that time is what counts: `worker/metering.js` adds it to D1 every minute. Counting steps alone would let a one-second step every few minutes keep a runner up for free.
- **Stops**: a runner does not start, and a step does not run, once the account's month (`BUILD_SECONDS_MONTHLY`), everyone's month (`GLOBAL_BUILD_HOURS_MONTHLY`) or everyone's day (`GLOBAL_BUILD_HOURS_DAILY`, so a burst of accounts cannot spend the month at once) is spent. Every minute the runner is checked again, and destroyed once one of them is spent, builds are paused (`CLOUD_BUILDS_ENABLED`), its account is blocked, it could not be metered three minutes running, or it has run longer than a whole month's allowance, which needs no D1 to tell. Every stop is a destroy: the runner is PID 1, which ignores a SIGTERM it has no handler for, and its build steps could stop it from handling one.
- **Cost ceiling**: `max_instances` runners per image at once (2), `standard-4` each.

## Commands

- `pnpm test`: unit tests.
- `pnpm build:image [--amd64]`: builds the compiler image from this repository's crossbind with the dependencies the lockfile pins (`pnpm deploy`), on the web toolchain image that crossbind pins, and writes the runner contexts beside it (`docker build .build/runner-web` builds one). The ports of `compiler/packages.js` come from npm, refused unless their integrity is the one pinned there; the template's build in the image fetches the crates and Conan packages.
- `pnpm attack`: runs the image with Docker and checks hostile compiles (file reads through `#include`, `#embed`, `.incbin`, SWIG and Rust's `include_bytes!`, compile-time bombs) and the sandbox from inside. bubblewrap needs Docker's seccomp filter and `/proc` masking lifted; a Cloudflare microVM allows it as it is.
- `pnpm run local`: the API on `localhost:8686` for the landing's dev server (`VITE_PLAYGROUND_API=http://localhost:8686/playground pnpm --filter @crossbind/landing dev`): the Worker's request handling in front of the image in Docker, quota, cache and accounts in memory. `wrangler dev` cannot run the compiler, since bubblewrap needs Docker's seccomp filter and `/proc` masking lifted. With `--github-client-id <id>` of an OAuth app whose device flow is enabled, `CROSSBIND_CLOUD_URL=http://localhost:8686 crossbind login` signs in for real.
- `pnpm run dev`: `wrangler dev` with the staging settings, for the Worker alone, on a local D1 the migrations are applied to first.
- `pnpm run check:local`: the account's page against `wrangler dev` of `test/local/wrangler.jsonc`, with no container, on a local D1 made for the run and a stand-in for GitHub: Chromium, from the workspace's Playwright, signs in, signs devices out, signs out everywhere and deletes the account, while a page of the site's origin is refused. Chromium resolves no name but `localhost`, so nothing leaves the machine.
- `pnpm run deploy:staging`, `pnpm run deploy`: assemble the image contexts, deploy (wrangler builds the compiler and the four runner images for linux/amd64 with the local Docker and pushes them), and apply the D1 migrations the database lacks. The first deploy creates the database under its `database_name`, by which later deploys find it. A migration only ever adds, since the code it ships with runs a moment before it does. `deploy` refuses uncommitted changes to crossbind, this package or the lockfile, which staging takes as they are, to try them before a commit; both refuse an overridden toolchain image.
- Staging answers on `api-staging.crossbind.dev`. The landing's dev server reaches it with `VITE_PLAYGROUND_API=https://api-staging.crossbind.dev/playground`, and `CROSSBIND_CLOUD_URL=https://api-staging.crossbind.dev` points the CLI at it. The page on `localhost` stays signed out, since the session cookie is not sent to another site; `/playground/session` opened directly shows a web sign-in.
