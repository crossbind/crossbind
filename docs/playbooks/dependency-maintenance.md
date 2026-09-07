# Dependency and toolchain maintenance

Crossbind separates dependency discovery, validation and release. A dependency bot may prepare a
reviewable source change, but it cannot publish npm packages, push GHCR images, create releases or
move dist-tags. Releases remain explicit protected workflows.

## Automation layers

`.github/dependabot.yml` owns ordinary pnpm, GitHub Actions and Debian base-image updates. Routine
minor/patch changes are grouped within their ecosystem; majors remain isolated. Every Action stays
full-commit-SHA pinned and the release tests reject floating Action references.

`.github/workflows/dependency-watch.yml` runs every day and can also be dispatched manually. It owns
the repository-specific dependency units that generic package bots cannot update transactionally:

- the repository Node LTS pin plus its Docker image digest;
- stable Rust plus the digest-pinned bootstrap image;
- Emscripten/emsdk plus Crossbind's reviewed `libembind.js` fork revision and source hash;
- wasi-sdk archives for both Linux architectures, submodule revisions and license hashes;
- Android command-line tools checksums and patch releases inside the reviewed NDK major;
- the Crossbind SWIG fork revision and source archive hash;
- one complete native port family (`base`, `wasm`, `wasi`, `bin-wasi`, `android`, `ios`) per update.

Canonical current versions remain in `.nvmrc`, the Dockerfiles and `ports/*/*/package.json`. The
bot's `update-policy.json` stores upstream identity and policy only; it does not copy current
versions into another manually maintained inventory.

## Daily flow

The planner performs read-only upstream checks and emits at most four independent proposals per
run. It prioritizes a checked security fix, then patch, digest, minor, source and major updates.
Additional proposals wait for the next daily run. At most two expensive candidates validate at
once.

For each proposal the reusable candidate workflow:

1. updates exactly one dependency unit and recomputes hashes;
2. checks that no file outside that unit changed;
3. refreshes generated agent references when canonical documentation changed;
4. validates source pins and dependency wiring;
5. builds and packs every existing Linux/Web/WASI/Android target;
6. builds and packs iOS on macOS when the family has an iOS package;
7. rebuilds, smoke-tests and Trivy-scans the complete image family for toolchain changes;
8. hashes the exact patch tested by every runner;
9. creates one draft PR only after every required gate succeeds.

The PR remains draft and is never auto-merged. Merging a dependency PR does not publish anything.
Public package versions and the release channel are chosen later through the npm release train.
`validate-dependency-pr.yml` repeats the affected native-family or complete toolchain gate on the
actual PR head, including Dependabot's Debian digest PRs, so branch protection sees the result.

## Security checks

Published GHCR bytes are scanned separately every day by `scan-toolchain-images.yml`. It scans the
committed amd64/arm64 digests, not a moving tag. A HIGH/CRITICAL vulnerability with a known fix
opens or refreshes one issue; a clean later scan closes it. A dependency update is proposed only
when a replacement can pass the image build, hardened-runtime smoke tests and Trivy gates.

For native sources the planner resolves the reviewed upstream release tag to a Git commit and asks
OSV whether that exact commit is affected. When the current commit is affected, a newer version is
treated as a security update only if its own resolved commit is clean. Changed bytes under the same
version, an unknown tag or an unavailable advisory identity fail closed and enter the
manual-intervention issue.

GNU libiconv, libspatialite and libtiff currently require manual advisory review because their
canonical source does not have a reviewed release-tag-to-Git-commit identity suitable for the OSV
query. This limitation is explicit in `scripts/dependencies/update-policy.json`. OSV and Trivy
coverage is evidence, not a guarantee that an upstream has disclosed every vulnerability.

## Emscripten fork contract

An upstream Emscripten version cannot become an automated PR until the adapted Crossbind fork has
the immutable tag:

```text
crossbind-<upstream-version>
```

For example, upstream `6.1.0` requires tag `crossbind-6.1.0` in `crossbind/emscripten`. The planner
resolves that tag to a full commit, downloads `src/lib/libembind.js`, calculates its SHA-256 and
ties it to the emsdk image digest. Without the reviewed fork tag it opens/updates the manual issue
instead of substituting upstream `libembind.js`.

## Android NDK policy

The bot automatically proposes releases only inside `ndkTrackMajor` from `update-policy.json`.
Discovery of a newer NDK major creates a manual-review finding because an NDK major can change ABI,
CMake and compiler behavior. After the new major passes a deliberate migration, update
`ndkTrackMajor`; subsequent patch releases become eligible for automated draft PRs.

## GitHub App setup

Register and install a narrowly scoped `crossbind-dependency-bot` GitHub App on this repository.
Grant only:

- Contents: read and write;
- Pull requests: read and write;
- Issues: read and write.

It needs no Actions, Packages, Releases, Environments or Administration permission. Store the App
Client ID as repository variable `DEPENDENCY_BOT_CLIENT_ID` and its private key as repository or
organization secret `DEPENDENCY_BOT_PRIVATE_KEY`. The candidate workflow mints a short-lived
installation token only after all build jobs pass. No build or upstream source hook sees that
token.

Using an App token also lets the resulting PR trigger the normal protected PR checks. Do not replace
it with an npm token, classic PAT or a package-write credential.

Create the bot labels once if repository policy prevents the App from creating them:

```text
dependencies
automated-dependency-update
security
```

## Commands

Read-only local/live plan:

```bash
pnpm run dependencies:plan
```

Run deterministic automation tests, workflow validation, lint and formatting:

```bash
pnpm run check:dependency-automation
```

Manual GitHub dry run (builds detected proposals but creates no branch, PR or issue):

```bash
gh workflow run dependency-watch.yml --ref main -f dry_run=true
```

Scheduled runs are writing runs by design. After the dry-run path has been reviewed, a maintainer
can exercise the same behavior immediately with:

```bash
gh workflow run dependency-watch.yml --ref main -f dry_run=false
```

Neither command publishes packages or images.

## Recovery and idempotency

PR branches include the dependency unit and proposed version/digest. If an open PR already covers
the branch, the bot reuses it only when its complete Git tree equals the newly validated tree. A
different tree or a remote branch with no open PR is treated as a conflict and is never
force-pushed. Failed validation creates no branch.

The manual-intervention and published-image security issues carry stable markers and are updated
instead of duplicated. They close only after a later clean scan. If a bot PR is intentionally
rejected, close it and delete its branch before asking the bot to prepare the same target again.
