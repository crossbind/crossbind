# Releasing Crossbind npm packages

Crossbind publishes its public pnpm workspace packages through one manually dispatched release
train. The train may build on Linux and macOS, but it has one plan, one protected publication gate
and one release commit. It never publishes Docker images or deploys the site.

The workflow file remains `.github/workflows/release-crossbind.yml` because that exact path is part
of every npm Trusted Publisher identity. Its display name is **Release npm package train**.

## What the train selects

The planner discovers every non-private package in the committed pnpm workspace. For each package,
it validates the repository identity and compares the local version with the npm dist-tag selected
by that version:

| Package version | npm dist-tag | GitHub classification for `crossbind` |
| --------------- | ------------ | ------------------------------------- |
| `X.Y.Z-beta.N`  | `beta`       | prerelease                            |
| `X.Y.Z-rc.N`    | `next`       | prerelease                            |
| `X.Y.Z`         | `latest`     | normal release                        |

Unknown prerelease identifiers fail. Stable packages publish directly to `latest`; RC packages on
`next` are the candidate phase. Publication never moves or removes `beta` or `next` separately.

A package is selected when its committed version is newer than its corresponding npm channel. All
packages selected for one release use the common version recorded in `releases/npm/VERSION`.
Unchanged packages keep their older versions and are not republished. This is a locked release
train, not a requirement that every workspace package always have the same version.

A package already published by the same workflow and release commit is selected for an idempotent
partial-run resume. A train version partially used by another commit fails; the maintainer must
prepare the next train version. A local version older than the registry channel also fails rather
than moving that channel backwards. A writing run with no selected packages fails.

Prepare a train by naming its changed packages explicitly:

```bash
pnpm run release:version -- --version 2.0.0-beta.56 \
  --package crossbind \
  --package @crossbind/plugin-vite
pnpm run release:version -- --version 2.0.0-beta.56 \
  --package crossbind \
  --package @crossbind/plugin-vite \
  --apply
```

The first command is a preview. The second updates only those package manifests and the canonical
train version. Use `--all` instead of `--package` for an intentional repository-wide train such as
`2.0.0-beta.55`, a new major or a provenance reissue. One dispatch has exactly one semantic channel,
so selected beta, RC and stable packages cannot be mixed.

The planner verifies every selected package's local runtime, optional and peer workspace
dependencies. An exact dependency version must already exist on npm or be included in the train.
A stable package may not depend on a prerelease workspace package.

`releases/npm/stable-entrypoints.json` defines the stable product closure from the documented CLI,
generator, bundler, React Native and TypeScript entry points. A stable train requires those package
versions and all their local runtime dependencies to be stable and either already published or in
the train. Optional ports are not forced into the first stable product set; whenever a port is
published as stable, its own dependency closure is checked by the same rule.
The stable gate also rejects `@beta`/`@next` install commands in the product README and prerelease
Crossbind dependency pins in generated `create-crossbind` package/lockfile templates.

## Build and publication barrier

No package is published while another selected artifact is still building:

1. The Ubuntu planner records the release commit, package set and dependency order.
2. Ubuntu builds Web, Android, WASI and ordinary JS/metadata packages.
3. macOS builds iOS packages.
4. `@crossbind/example-lib-prebuilt-matrix` is deliberately split across both runners; the
   coordinator merges Web/Android/WASI and iOS outputs and refuses conflicting files.
5. The coordinator verifies that exactly one tarball exists for every selected package.
6. Only then can the protected `npm-release` job start.

Build commands come from each package's committed `prepublishOnly` script. Packages are built in
workspace dependency order, including build dependencies that are not themselves being published.
Dependencies embedded in generated `create-crossbind` templates are also validated and ordered
before the generator, even though they are not runtime dependencies of the generator process.
Tarballs are created with `pnpm pack` so `workspace:` ranges become publishable semver ranges. The
coordinator rereads `package/package.json` and SHA-512 hashes the exact `.tgz`; unresolved
`workspace:` ranges, missing artifacts, duplicate package artifacts and platform-output conflicts
all fail closed.

The protected job downloads those same bytes and calls npm directly for each package:

```text
npm publish <exact-tarball.tgz> --tag <beta|next|latest> --access public --provenance
```

It publishes in dependency order. `crossbind` has no local runtime dependencies and receives
explicit first priority whenever it is part of the train, so packages depending on it never race
ahead. After each package, the workflow polls the exact version and expected dist-tag, checks the
registry SHA-512 and validates the signed SLSA provenance subject, repository, workflow and release
commit. There are at most 22 attempts over at most ten minutes, with backoff from five to 30
seconds. A previous beta/RC does not count as success.

Only after every npm artifact and provenance statement verifies does the workflow create missing
exact package tags such as:

```text
crossbind@2.0.0-beta.54
@crossbind/plugin-vite@2.0.0-beta.54
```

An existing matching tag is reused; a tag at another commit fails before any npm write. Other
workspace package tags do not create 100+ GitHub Releases. The canonical `crossbind` package keeps
its richer exact-tag GitHub prerelease/release and manifest described below. This prevents port and
toolchain streams from being confused with the product release and avoids GitHub's generic latest
release endpoint.

## Canonical `crossbind` release notes and manifest

When `core/crossbind/package.json` is bumped, add exactly one human-authored file:

```text
releases/crossbind/<version>.md
```

Copy `releases/crossbind/TEMPLATE.md`. Its frontmatter version must equal the package version; its
body is the only source for the exact GitHub Release, the entry in `CHANGELOG.md` and the site's
`/changelog/#<version>` section. Do not generate it from commits. `CHANGELOG.md` is rendered from
these notes: run `pnpm changelog` after writing or editing one (`check:release` and the site build
refuse a stale file), and never edit its generated region by hand; the entries below that region are
the hand-written history from before the notes existed and stay as they are.

The release commit supplies the remaining canonical identities:

- Package/version: `core/crossbind/package.json`.
- Toolchain image digests: `core/crossbind/src/assets/toolchain-digests.json`.
- Git tag: `crossbind@<version>`.
- Manifest schema: `releases/crossbind/manifest.schema.json`.

After npm verification, `crossbind-release.json` records the exact npm URL, registry tarball,
SHA-512 integrity, provenance endpoint, publication timestamp, tag/commit, note source and digest
table SHA-256. The unchanged digest table is attached separately. Matching GitHub assets are
reused; conflicting assets fail and are never overwritten. GitHub assets are convenient metadata,
not a cryptographic trust root—the npm provenance statement and exact git commit provide the
supply-chain binding.

## Token-free Trusted Publishing setup

On npmjs.com, configure **every public package selected by this train** with a GitHub Actions
Trusted Publisher using exactly:

```text
repository:  crossbind/crossbind
workflow:    release-crossbind.yml
environment: npm-release
allowed action: npm publish
```

This is a one-time package administration task; the same workflow identity is configured on each
package. New npm trust relationships may default to staged-only access, so explicitly allow direct
`npm publish` for this reviewed workflow. The protected `npm-release` GitHub environment should require maintainer approval and
must not contain `NPM_TOKEN`, `NODE_AUTH_TOKEN` or `NPM_AUTH_TOKEN`. Only the final publish job has
`id-token: write`. It installs the pinned npm 12.0.2 CLI, exchanges its GitHub OIDC identity for a
short-lived npm credential and requests provenance explicitly. After the first train succeeds,
configure each npm package to require 2FA and disallow long-lived tokens, then revoke obsolete
automation tokens.

The repository uses the exact Node 24.20.0 LTS pin in `.nvmrc`; npm is pinned separately because it
has no LTS channel. External actions are pinned to full commits. The repository-wide
`crossbind-npm-release` concurrency group uses `cancel-in-progress: false`, so package trains cannot
overlap.

## Beta, RC and stable procedure

1. Prepare the common train version and changed package set with
   `pnpm run release:version -- --version <version> --package <name> [--package <name>...] --apply`.
   Use `--all` only for an intentional repository-wide release.
2. If `crossbind` is included, add its matching versioned release-note file.
3. Merge the reviewed release commit to `main` and wait for required checks.
4. Run the local read-only plan for the desired channel:

    ```bash
    pnpm run release:train:dry-run -- --channel beta
    ```

5. Run the GitHub dry-run. It may build on both platforms but uploads no inter-job artifacts and
   writes nothing to npm, git or GitHub Releases:

    ```bash
    gh workflow run release-crossbind.yml --ref main -f channel=beta -f dry_run=true
    ```

6. Review the package set, dependency order, runners and dist-tags in the job summary.
7. After the `npm-release` environment and every selected package's Trusted Publisher are ready,
   dispatch the writing run:

    ```bash
    gh workflow run release-crossbind.yml --ref main -f channel=beta -f dry_run=false
    ```

8. If `crossbind` was in the train, rebuild the live example demos from the published packages and
   redeploy the site so its version menu, changelog, Quick Start and `/examples/` pick up the new version
   (see [Site-consumer contract](#site-consumer-contract)):

    ```bash
    pnpm --filter @crossbind/landing demos
    pnpm --filter @crossbind/landing deploy
    ```

Use `channel=rc` for `-rc.N` packages and `channel=stable` for stable packages. The build,
integrity, provenance and tagging mechanism is identical; only the version policy and npm tag
differ.

Before approving the first stable train, review `releases/npm/stable-entrypoints.json` against the
documented supported integrations. Changing that list is a product-scope change and should be
reviewed separately from a routine version bump.

## Recovery and idempotency

Rerun the same workflow at the same commit. Never delete or overwrite release data just to make a
rerun pass.

| Existing state                                             | Rerun behavior                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| npm version absent                                         | Publish the approved tarball once.                                     |
| npm version and expected tag have identical integrity      | Verify provenance and reuse it.                                        |
| npm version exists with different integrity                | Fail; npm versions are immutable.                                      |
| matching bytes exist but the expected dist-tag differs     | Poll for propagation, then fail; OIDC publishing does not repair tags. |
| provenance is missing, malformed or identifies other bytes | Poll, then fail before git/GitHub completion.                          |
| exact git tag is absent / matches the commit               | Create it after all npm gates / reuse it.                              |
| exact git tag points elsewhere                             | Fail before npm publication; never move it.                            |
| exact `crossbind` GitHub Release already matches           | Reuse it and upload only missing matching assets.                      |
| release body, classification or asset conflicts            | Fail; never overwrite or delete it automatically.                      |

An npm-only partial train resumes because npm provenance identifies the same workflow and commit.
Already completed packages are integrity-checked instead of republished, then remaining packages
continue in dependency order.

## Permissions and repository rules

The plan/build jobs have `contents: read`. The protected final job has `contents: write` to create
exact package tags and the `crossbind` GitHub Release, plus `id-token: write` for npm Trusted
Publishing. Repository tag rules must permit this GitHub Actions identity to create, but never
rewrite, `crossbind@*` and `@crossbind/*@*` tags. Branch protection should require the release
infrastructure check before merging a version bump.

## Site-consumer contract

When `crossbind` is in a train, the workflow retains the existing site outputs:

```text
version
channel
prerelease
npmUrl
gitTag
gitCommit
publishedAt
releaseManifestAssetUrl
releaseNotesSource
```

It also persists `workspace-release-result.json` containing every exact package, channel, npm URL,
integrity, provenance endpoint, tag, commit and timestamp.

The site under `landing/` consumes the published data, not these workflow outputs. Every
`pnpm --filter @crossbind/landing dev|build` first runs `scripts/site/prepare-site.mjs`, which through
`scripts/release/resolve-site-release.mjs` resolves the npm channel in `landing/release.config.js` (`beta` → `beta`, `rc` → `next`,
`stable` → `latest`) to one exact `crossbind` version, fetches the GitHub Release of that exact
`crossbind@<version>` tag with its `crossbind-release.json`, validates the manifest against the
schema and cross-checks the registry integrity, the tag's commit and the prerelease flag. It then
reads the canonical release note and the toolchain digest table at the manifest's commit, verifies
the note's frontmatter and the table's SHA-256, and hands one snapshot to the navbar version menu,
the `/changelog/` page and the Quick Start install commands. Every earlier published `crossbind@*`
release that carries a manifest is verified the same way and gets its release row on `/changelog/`,
so `#<version>` links survive later trains; entries without a manifest are shown from `CHANGELOG.md`
without a row. The same dist-tag also resolves
`@crossbind/plugin-vite` and `create-crossbind`, and the plugin's `crossbind` range must admit the
resolved version, and the `/ports/` catalog marks a port variant as published only when npm serves
it on that dist-tag. It never uses GitHub's generic latest-release endpoint and never falls back to
another channel, fixture or older version: a missing or inconsistent piece of metadata fails the
build, and a failed build never reaches `wrangler pages deploy`.

The site is not deployed by this workflow. After a train that included `crossbind`, run
`pnpm --filter @crossbind/landing demos` and then `pnpm --filter @crossbind/landing deploy` once:
the first builds the `/examples/` live demos from the published packages
(`scripts/site/build-example-demos.mjs`), the second refuses to deploy unless those demos exist and
carry the version the site resolved. Moving the site from beta to stable is one deliberate change:
set `channel: 'stable'` in `landing/release.config.js`, rebuild the demos and deploy. An offline
fixture build (`CROSSBIND_SITE_RELEASE_FIXTURE`) is marked as such and refused by the deploy step.

Toolchain image versions and digests remain canonical only in
`core/crossbind/src/assets/toolchain-digests.json`; the npm train never republishes Docker images or
duplicates their digest values.
