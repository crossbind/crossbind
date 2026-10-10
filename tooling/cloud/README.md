# @crossbind/cloud

crossbind cloud on `api.crossbind.dev`: the compile service behind the playground on crossbind.dev, and the accounts that the playground page and `crossbind login` sign in to. A visitor's `native.h` and `native.cpp` are built with crossbind into a wasm module and its loader; the page then runs them in the visitor's own browser.

## A compile

- Only the Worker in front reaches `compiler/server.js`: `POST /compile` with `{"files": {"native.h": "...", "native.cpp": "..."}}`, at most 32 KB of sources. One compile runs at a time, one more may wait, the rest get 503.
- Every compile starts from a copy of `compiler/template`, built once when the image is built at the same path, so cmake's and emscripten's caches are warm. The copy is removed afterwards.
- `crossbind build -p wasm -a wasm32 -r st -e browser -b debug` runs in the sandbox below; the server returns the loader, the wasm (base64) and the build log with workspace paths shortened.

## Sandbox

The compiler is treated as compromised:

- **Namespaces** (bubblewrap): user, pid, network, ipc, uts and cgroup. No network, not even loopback to the server; no further user namespaces.
- **Syscalls** (seccomp, `compiler/seccomp.js`): io_uring, bpf, keyctl, perf events, userfaultfd, ptrace, process_vm and module loading fail; sockets open for the unix and internet families only, which keeps out vsock (the microVM's channel to its host), netlink and raw packets.
- **Files**: `/usr`, `/emsdk` and the CLI read-only, emscripten's cache behind a throwaway overlay, the workspace and a 256 MB `/tmp` writable, `/proc/cmdline` and other kernel files covered. The server code, the template and `/etc/passwd` are not there.
- **Limits**: 60 s of CPU, 2 GiB of data (the CLI's own node maps about 1.8 GiB, mostly untouched), 128 MiB per file, 64 processes, 1024 open files, 45 s of wall clock and 8 MiB of output. A watchdog stops the compile when the machine (or its cgroup) gets under 256 MiB free, since a sandbox can reset its own OOM score and fill tmpfs mounts no size limit covers.
- **Environment**: the toolchain variables only.
- **Outputs** are read after the sandbox is gone, as regular files through real folders only: no links, FIFOs or oversized files (2 MiB of loader, 6 MiB of wasm).
- **Workspace**: removed with `chmod -R` and `rm -rf`, which walk trees deeper than a path can name. One that cannot be removed answers 500 and recycles the server.
- **Recycling**: after 200 compiles, failed ones included, the server takes no new work, answers what it holds and exits; the next compile starts a fresh container. tini is PID 1 and reaps what the sandboxes leave.

On Cloudflare every container is its own Firecracker microVM, started without internet access. The Worker gives a compile back only when the compiler turned it away before it started; a compile that ended the container, or whose answer came back unusable, stays counted.

## The Worker in front

`worker/` is the API on `api.crossbind.dev`. The playground page talks to it under `/playground`:

- `GET /session`: who is signed in, the day's limit and what is left of it, whether GitHub sign-in is set up, and the Turnstile site key.
- `POST /compile`: from the playground page's origin only. An anonymous visitor passes Turnstile first. A compile seen before comes from the cache without counting; otherwise it counts against the visitor's network (an IPv6 /64 is one network) or their account, and against the day's total for everyone.
- `GET /login/github` and `/callback/github`: GitHub sign-in that asks for no scope; accounts younger than 30 days are turned away. The account is recorded (below), and the session is an HMAC-signed, host-only cookie holding its GitHub id and name.
- `POST /logout`, and `POST /delete-account`, which deletes the signed-in account as `crossbind account delete` does.

The CLI talks to it under `/v1` (`worker/account-api.js`), with a token and without cookies or CORS:

- `POST /v1/login/device` and `POST /v1/login/token`: `crossbind login`, GitHub's device flow. The user enters a code on github.com; the Worker, not the CLI, asks GitHub for the outcome, so no GitHub token leaves it. The CLI polls `/v1/login/token` (202 until the code is approved) and then receives a token of crossbind cloud's own (`cbt_…`).
- `GET /v1/usage`: the month's cloud build seconds by toolchain image against the monthly allowance (`BUILD_SECONDS_MONTHLY`), and the day's playground compiles.
- `DELETE /v1/token` and `DELETE /v1/tokens`: `crossbind logout`, for the token sent or every token of the account.
- `DELETE /v1/account`: `crossbind account delete`, open to a blocked account too.

Builds under `RUNNER=REMOTE` talk to it under `/runner/<image>/v1/*`, the runner protocol of `docs/api/remote-runner.md`, with the same token (`worker/runner-api.js`, below).

Every route counts requests per network (an IPv4 address or an IPv6 /64) with Workers rate limiting, before anything that costs: 120 a minute, 10 CLI sign-ins started, and 1,200 runner requests, since a build makes several per step. Limits, allowed origins, the networks that may not compile without signing in (`BLOCKED_NETWORKS`, as `198.51.100.9,2001:db8:85a3:42::`) and the kill switch (`PLAYGROUND_ENABLED`) are `vars` in `wrangler.jsonc`. Deleting the `GITHUB_CLIENT_ID` secret turns signing in off.

## Accounts

D1 (`migrations/`, binding `DB`) keeps everyone who signed in with GitHub, on the page or with the CLI: the GitHub id and name and when they signed in, never an email or a GitHub token; their CLI tokens as SHA-256 hashes, the 20 most recently used per account, each dropped after 90 days unused; and their cloud build seconds per month and image, for the current month and the three before it. Blocking an account stops its sign-ins, compiles and tokens. Block by id: a GitHub name passes to someone else after a rename.

Deleting an account removes it and its tokens at once, and its earlier months of build seconds; the current month's stay under the bare id until the month ends, so a new sign-in does not bring a fresh month, and a blocked account stays as its id, or deleting it would lift the block. A cron trigger prunes daily what is kept only for a while (`prune` in `worker/accounts.js`); `landing/src/pages/privacy.js` states the same periods, and a landing test holds the two together.

```bash
pnpm exec wrangler d1 execute crossbind-accounts --remote --command "SELECT id, login, last_login_at FROM users WHERE login = '<name>'"
pnpm exec wrangler d1 execute crossbind-accounts --remote --command "UPDATE users SET blocked = 1 WHERE id = <id>"
```

GitHub sign-in needs a GitHub OAuth app with its callback at `https://api.crossbind.dev/playground/callback/github` and the device flow enabled; its client id and secret are the `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` secrets.

## Cloud runners

`worker/runner.js` gives every account a runner of each toolchain image: a Durable Object named after the GitHub id, holding one container. Each container is a Firecracker microVM of its own, so builds of different accounts share nothing.

- **Image**: the toolchain image this repository's crossbind pins, with `core/crossbind/src/runner` copied in (`runner/Dockerfile`, assembled into `.build/runner-<image>/` by `scripts/build-image.mjs`). Older crossbind releases pin other images, and the runner turns their builds away with `toolchain mismatch`.
- **Requests**: the Worker checks the token, then passes the request on with the account's id in `x-crossbind-user` and, of the caller's headers, only the ones the runner protocol reads (`content-type`, and `content-range` and `x-crossbind-upload` for a file sent in parts): no token, no cookies. A token found valid in the last 30 seconds skips the D1 read and counts on the runners' rate; any other counts on the general one first, so made-up tokens cannot spend D1 reads. The runner's own token is derived from `RUNNER_SECRET` (32 characters at least, or every runner route answers 503), the image and the account, so nothing is stored. The entrypoint starts the runner as the image's unprivileged user, with no capabilities and `no_new_privs`. Build steps run as that user and can read the runner's token from its process; it opens nothing, since only the Durable Object reaches the container.
- **Network**: crates.io, ConanCenter and GitHub (`ALLOWED_HOSTS`), and only to download: GET, HEAD and git's fetch go out, pushes, form posts and uploads are refused (403). Other hosts get Cloudflare's 520, every name resolves to its egress proxy, and no other TCP or UDP leaves. Cloudflare intercepts the HTTPS to hold it to them; the entrypoint adds its CA to the system store at start, and Python reads that store through `REQUESTS_CA_BUNDLE`.
- **Time**: a runner is up from a build's first request until a minute after its last (`RUNNER_IDLE_SECONDS`), and that time is what counts: `worker/metering.js` adds it to D1 every minute. Counting steps alone would let a one-second step every few minutes keep a runner up for free.
- **Stops**: a runner does not start, and a step does not run, once the account's month (`BUILD_SECONDS_MONTHLY`), everyone's month (`GLOBAL_BUILD_HOURS_MONTHLY`) or everyone's day (`GLOBAL_BUILD_HOURS_DAILY`, so a burst of accounts cannot spend the month at once) is spent. Every minute the runner is checked again, and destroyed once one of them is spent, builds are paused (`CLOUD_BUILDS_ENABLED`), its account is blocked, it could not be metered three minutes running, or it has run longer than a whole month's allowance, which needs no D1 to tell. Every stop is a destroy: the runner is PID 1, which ignores a SIGTERM it has no handler for, and its build steps could stop it from handling one.
- **Cost ceiling**: `max_instances` runners per image at once (2), `standard-4` each.

## Commands

- `pnpm test`: unit tests.
- `pnpm build:image [--amd64]`: builds the compiler image from this repository's crossbind with the dependencies the lockfile pins (`pnpm deploy`, so building the image fetches nothing from npm), on the web toolchain image that crossbind pins, and writes the runner contexts beside it (`docker build .build/runner-web` builds one).
- `pnpm attack`: runs the image with Docker and checks hostile compiles (file reads through `#include`, `#embed`, `.incbin` and SWIG, compile-time bombs) and the sandbox from inside. bubblewrap needs Docker's seccomp filter and `/proc` masking lifted; a Cloudflare microVM allows it as it is.
- `pnpm run local`: the API on `localhost:8686` for the landing's dev server (`VITE_PLAYGROUND_API=http://localhost:8686/playground pnpm --filter @crossbind/landing dev`): the Worker's request handling in front of the image in Docker, quota, cache and accounts in memory. `wrangler dev` cannot run the compiler, since bubblewrap needs Docker's seccomp filter and `/proc` masking lifted. With `--github-client-id <id>` of an OAuth app whose device flow is enabled, `CROSSBIND_CLOUD_URL=http://localhost:8686 crossbind login` signs in for real.
- `pnpm run dev`: `wrangler dev` with the staging settings, for the Worker alone, on a local D1 the migrations are applied to first.
- `pnpm run deploy:staging`, `pnpm run deploy`: assemble the image contexts, deploy (wrangler builds the compiler and the four runner images for linux/amd64 with the local Docker and pushes them), and apply the D1 migrations the database lacks. The first deploy creates the database under its `database_name`, by which later deploys find it. A migration only ever adds, since the code it ships with runs a moment before it does. `deploy` refuses uncommitted changes to crossbind, this package or the lockfile, which staging takes as they are, to try them before a commit; both refuse an overridden toolchain image.
- Staging answers on `api-staging.crossbind.dev`. The landing's dev server reaches it with `VITE_PLAYGROUND_API=https://api-staging.crossbind.dev/playground`, and `CROSSBIND_CLOUD_URL=https://api-staging.crossbind.dev` points the CLI at it. The page on `localhost` stays signed out, since the session cookie is not sent to another site; `/playground/session` opened directly shows a web sign-in.
