# ADR-0015: Choose where steps run with `RUNNER` in the system config

- **Status:** Proposed
- **Date:** 2026-10-07
- **Affects:** `src/utils/selectRunner.js`, `systemKeys.js`, `run.js`, `runCargo.js`, `runConan.js`, `wasiToolchain.js`, `state/index.js`, the `crossbind runner` output, `~/.crossbind.json`

## Context

A toolchain step runs in a fresh container (`DOCKER_RUN`), a long-lived container (`DOCKER_EXEC`), on
the host (`LOCAL`) or on a remote runner. The choice came from four sources with an implicit order:

- `RUNNER` in `~/.crossbind.json`, which had no environment override while the other system keys had one;
- the remote runner's address variables (`CROSSBIND_REMOTE_URL[_<IMAGE>]`), whose presence alone turned a
  Docker step into a remote one;
- `WASI_SDK_PATH`, whose presence alone turned a wasi build into a host build, even under `RUNNER=DOCKER_RUN`;
- the platform: iOS and macOS steps need Xcode, so they run on the host.

`run.js`, cargo and conan each made the decision on their own, and nothing printed it. On 2026-10-07
two variables left in a shell profile were found to send every web step of a developer's builds to a
Cloudflare runner: about three times slower than the local Docker, paid for, and failing with
`toolchain mismatch` once the runner's image fell behind. Reproducing CI's Docker wasi build on a
machine with `WASI_SDK_PATH` set needed a throwaway `HOME`. And builds start from places that never
read a shell profile: the Xcode build phase of the React Native pod, Gradle, and bundler dev servers.

## Decision

`RUNNER` alone decides where steps run, and one module resolves it for every step. The rules:

- `RUNNER` is `DOCKER_RUN` (default), `DOCKER_EXEC`, `LOCAL` or `REMOTE`. `CROSSBIND_RUNNER` overrides it,
  as the other system keys have `CROSSBIND_*` overrides.
- Only `REMOTE` sends steps to a runner; an address alone does nothing.
- Addresses are system keys, `REMOTE_URL_<IMAGE>` per image and `REMOTE_URL` for every image without
  one, each overridden by its `CROSSBIND_` variable. An image's own address wins over the shared one.
- Tokens stay in the environment (`CROSSBIND_TOKEN[_<IMAGE>]`), each paired with its address.
- Under `REMOTE`, a step whose image has no address stops before anything runs and names the setting to
  add. It never falls back to the local Docker, where the build would only seem to run on a runner.
  Each image says once which runner its steps go to and which settings chose it.
- A host wasi-sdk applies under `RUNNER=LOCAL` only; the other runners build wasi with the sdk in the
  image, and recipes see `CROSSBIND_WASI_SDK_PATH` only when it applies.
- The runner is machine configuration (`~/.crossbind.json`), never project configuration.

## Consequences

- **Positive** — one place decides and the build says where its steps go, so a forgotten variable no
  longer sends sources off the machine. The CLI, Xcode, Gradle and dev servers read the same file.
  `CROSSBIND_RUNNER=LOCAL` replaces the throwaway `HOME`, and a Docker wasi build matches CI's on every
  machine.
- **Negative** — a remote build needs `RUNNER` as well as an address, and an address for every image it
  uses: a desktop build needs a web and a linux runner, or `CROSSBIND_RUNNER=DOCKER_RUN` moves the whole
  build to the local Docker. One build cannot mix a runner and the local Docker. A machine that set
  `WASI_SDK_PATH` to build wasi on the host now builds it in Docker unless it sets `RUNNER=LOCAL`, which
  moves every platform to the host; `CROSSBIND_RUNNER=LOCAL` keeps that to one build. An invalid
  `RUNNER` stops the first step that needs a runner, naming the setting; commands that run no step,
  `crossbind config set` among them, still work, so the value can be repaired. Releases from before
  `RUNNER=REMOTE` read the same file and reject it, so a machine that still uses them sets the runner
  per build with `CROSSBIND_RUNNER`.

## Alternatives considered

- **Keep the address variables as the switch** — rejected: the switch was invisible, and whether it
  applied depended on the shell a build started from.
- **Put the runner in `crossbind.config.js`** — rejected: the local Docker and a runner produce the same
  C and C++ output, so the runner belongs to the machine; a committed choice would bind every
  contributor and CI to a runner they may not reach, and no token could live there.
- **Fall back to the local Docker for an image without an address** — rejected: the build would seem to
  run on a runner while it ran on the machine, and on a machine without Docker the fallback fails with a
  Docker error instead of naming the missing address.
- **A runner key per image (`RUNNER_WEB`, ...)** — deferred: it is the explicit way to mix a runner and
  the local Docker in one build, if that becomes a need.
- **Tokens in `~/.crossbind.json`** — deferred: `crossbind config list` prints the file. A credentials
  file only its owner can read can follow if setting tokens in the environment becomes a burden.

## See also

- Related ADRs: ADR-0005 (its dual-mode wasi toolchain rule is superseded here), ADR-0009
- Related code: `core/crossbind/src/utils/selectRunner.js`, `core/crossbind/src/utils/systemKeys.js`
- Docs: `docs/api/remote-runner.md`, `docs/api/overrides.md` (Layer 6)
