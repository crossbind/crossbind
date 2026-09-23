# Known issues

Defects and gaps that are real but not yet fixed, so a later session does not rediscover them.

Every entry carries the command that proves it is still real. Run the check before acting on an
entry, and delete the entry when the check comes back clean — an entry nobody can verify is worse
than no entry. Scope each check so it cannot match this file, which quotes what the checks look for.

Fixing something here is not a prerequisite for anything else; this is a list, not a queue.

## A failed native build does not fail `pod install`

`react-native-crossbind.podspec` runs the iOS build through Ruby's `system(...)`, which returns
false instead of raising, and the podspec does not read the result. A cmake failure is reported in
the log and then swallowed, so the error surfaces eight minutes later in the app build instead.

- Seen: 2026-09-22
- Check: `grep -n 'system(' plugins/react-native/react-native-crossbind.podspec` — the call has no
  `|| raise` and nothing inspects its return value.
- Remove when a non-zero exit from `build_ios.js` aborts `pod install`.

## Upstream source downloads have no retry

`downloadFile` makes a single `fetch`. Every port build therefore depends on one uncached request to
an upstream host, and a momentary network failure on a runner fails the whole job. It failed the
curl family on 2026-09-23 while the same tarball fetched fine locally and on the macOS runner.

- Seen: 2026-09-23
- Check: `grep -ci 'retry\|attempt\|backoff' core/crossbind/src/utils/downloadAndExtractFile.js`
  prints 0.
- Remove when the fetch retries with backoff.

## The React Native CLI sample's jest suite does not run

`@react-native/jest-preset` is not transformed, so the suite fails to start. It fails on `main` as
well, so this predates the 0.87 move, and no workflow runs it — the sample is only reached for the
iOS and Android e2e builds.

- Seen: 2026-09-22
- Check: `pnpm --filter @crossbind/example-mobile-reactnative-cli test` fails with
  `Jest encountered an unexpected token` at `@react-native/jest-preset/jest/setup.js`.
- Remove when the suite runs.

## The Expo sample is never installed in CI

`examples/mobile-reactnative-expo` keeps its own npm lockfile outside the pnpm workspace and no job
installs it, which is how its manifest and lockfile disagreed for months until `npm ci` was run by
hand.

- Seen: 2026-09-22
- Check: `grep -rl 'mobile-reactnative-expo' .github/workflows/` returns nothing.
- Remove when a job installs it.

## No e2e fixture runs in CI

The CI e2e legs run the `@crossbind/example-*` apps and the `port-zlib-wasi` e2e. None of the nine
`@crossbind/e2e-*` fixtures is built or run — the React Native one included — so the conformance
suites they carry never run either; the root `pnpm install` is the only step that touches them. All
but the WASI fixture depend on twelve or more ports while CI builds only zlib, and adding them was
measured and deferred on 2026-08-23. The `build-linux.yml` comment that explains the exclusion
points to AGENTS.md, which no longer says anything about it.

- Seen: 2026-08-22
- Check: `grep -rn 'e2e-' .github/workflows/` returns nothing, and `node -p "Object.entries(require('./package.json').scripts).filter(([k, v]) => k.startsWith('ci:') && v.includes('e2e-')).length"` prints 0.
- Remove when the fixtures run in CI.

## Six of the nine gates in `pnpm run check` never run in CI

CI runs `check:agents`, `check:publish` and, on pull requests that touch dependency or toolchain
files, `check:dependency-automation`. The other six run only when someone runs `pnpm run check`.

`lint`, `check:wiring:strict` and `check:sources:strict` read nothing but the tree, so a change that
breaks them merges unnoticed. `check:dist` expects the prebuilt `dist/` of every port, which only a
machine that has built them all can satisfy. `check:deps:strict` and `check:native:strict` compare
the tree against the newest releases — npm for the first, the upstream projects for the second — so
they turn red on any day something publishes. `check:native` also needs `GITHUB_TOKEN` locally or it
rate-limits and reports most packages as `unknown`, which fails `--check`.

- Seen: 2026-09-23
- Check: `grep -rnE 'check:(deps|native|dist|wiring|sources)|run lint|eslint' .github/workflows/`
  returns nothing.
- Remove when each gate either runs in CI or leaves `pnpm run check`.

## `check:deps` answers "is any usage current" rather than "is every usage current"

The status of a dependency comes from the highest version in use anywhere in the tree, so one
manifest on the current release marks the whole dependency up to date while another still resolves
an older copy. Observed on 2026-09-23 with `prettier`, which read up to date while the lockfile
carried both 3.9.6 and 3.9.8; that pair has since been collapsed, so reproducing it needs a tree
where two manifests disagree.

- Seen: 2026-09-23
- Check: `grep -n 'highestInUse' scripts/check-external-dependencies.js` — the status line compares
  one aggregated version against npm, not each usage.
- Remove when the gate reports per-usage.

## The release verifier gives up before npm finishes indexing

The publish step waits 44 attempts over 1200 seconds for each package to appear with provenance. On
2026-09-23 `@crossbind/port-geos-wasm@2.0.0-beta.60` was published but not yet exposed, so the train
failed on verification; a re-run of the same job passed and all 107 packages were already there.
Until this is fixed, recover the same way — `gh run rerun <id> --failed` at the same commit, as
"Recovery and idempotency" in `docs/playbooks/releasing-crossbind.md` describes.

- Seen: 2026-09-23
- Check: `grep -n 'REGISTRY_MAX_DURATION_MS =' scripts/release/npm-registry.mjs` still shows the
  twenty-minute window that beta.60 outlasted.
- Remove when a publish that succeeded stops failing its own verification.

## npm's `latest` tag serves a placeholder and beta.50

Beta trains publish to `beta`, and only a stable train moves `latest`. An install without a tag thus
gets `crossbind@0.0.1`, the name-reservation placeholder, and 2.0.0-beta.50 of `create-crossbind`
and the `@crossbind/*` packages, while `beta` is on 2.0.0-beta.60. Most docs say `@beta`;
`docs/api/wasi.md`, `docs/api/rust.md` and `docs/api/lifecycle-and-types.md` do not. On 2026-09-16
`node scripts/check-port-links.mjs --tag latest`, which links GDAL, PROJ and GEOS from npm, failed
with `undefined symbol: _Unwind_CallPersonality`: beta.50 was compiled with an older toolchain image
than the one crossbind pins now.

- Seen: 2026-09-16
- Check: `npm view @crossbind/port-gdal-wasm dist-tags` shows `latest` behind `beta`.
- Remove when `latest` follows the trains or no install instruction depends on it.

## The React Native samples' `hermes-compiler` does not follow react-native's pin

All three React Native samples declare `hermes-compiler: "*"`, and on Android the declaration is
load-bearing. react-native no longer ships `sdks/hermesc`; its gradle plugin looks for the compiler
at `<app>/node_modules/hermes-compiler/hermesc/<os>-bin/hermesc` (`detectOSAwareHermesCommand`), and
pnpm links only direct dependencies there. Dropping the declaration would end that lookup in
`Couldn't determine Hermesc location` on every Android Release build. iOS takes hermesc from the
`hermes-engine` pod instead.

The `*` range resolves on its own, though. The two pnpm samples carry 250829098.0.10, while
react-native 0.87.1 depends on 250829098.0.17 and runs that Hermes version on Android.
react-native's own `react-native-xcode.sh` warns that a compiler and VM on different bytecode
versions crash at launch with `Wrong bytecode version`. Today's pair still passes the Android e2e,
but `*` lets Dependabot propose any Hermes release.

- Seen: 2026-09-23
- Check: `pnpm --filter @crossbind/example-mobile-reactnative-cli exec node -p "require('react-native/package.json').dependencies['hermes-compiler'] + ' vs ' + require('hermes-compiler/package.json').version"` prints two different versions.
- Remove when the samples pin the version react-native depends on.

## `plugins/react-native/cpp/CMakeLists.txt` is dead

Nothing references it — Android builds through `plugins/react-native/script/CMakeLists.txt` — and
two of the paths it compiles no longer exist (`plugins/react-native-embind`,
`plugins/react-native/ReactCommon`). Only the file is dead: `cpp/src/JSI_module.cpp` next to it is
compiled by `script/build_android.js`.

- Seen: 2026-09-23
- Check: `grep -rn 'cpp/CMakeLists\|\.\./cpp' plugins/react-native --exclude-dir=node_modules --exclude-dir=cpp` returns nothing.
- Remove when the file is deleted.

## Apps served from a subpath cannot find their loader

The boot code every bundler plugin injects (`getCrossbindScript`) imports a root-absolute
`/crossbind.js`, and the worker runtime's `resolveScriptUrl` turns a relative `path` into a root
one. An app served from `/app/` therefore asks the site root for its loader and wasm. The site's
live demos work only because `scripts/site/build-example-demos.mjs` rewrites both after the build.

- Seen: 2026-09-11
- Check: `grep -n "'/crossbind.js'" core/crossbind/src/integration/getCrossbindScript.js` finds the
  absolute import.
- Remove when the plugins honour the bundler's base (`base` in Vite, `output.publicPath` in Rspack)
  and the demo builder's rewrites can go.

## The docs describe a setting and a recipe hook that nothing reads

`LOG_LEVEL` in `~/.crossbind.json` (`docs/api/troubleshooting.md`, `docs/api/overrides.md`,
`docs/api/build-state.md`, `docs/ARCHITECTURE.md`) has no reader, so setting it changes nothing.
The `getSource` recipe hook (`docs/api/crossbind-build.md`, `docs/api/overrides.md`,
`docs/ARCHITECTURE.md`) has none either: `buildExternal` calls `getURL` unconditionally, so a recipe
that follows the docs and supplies only `getSource` fails with `getURL is not a function`.

- Seen: 2026-09-13
- Check: `grep -rnw 'LOG_LEVEL\|getSource' core/crossbind/src` returns nothing.
- Remove when both work or the docs stop describing them.
