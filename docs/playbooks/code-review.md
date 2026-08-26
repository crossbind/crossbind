# Code review playbook

> What to check on a crossbind PR — for human reviewers and AI agents alike. Two checklists: **package PRs** and **fix/feature PRs**. Use the matching one.

## Universal checks (every PR)

Run these before any code-specific review:

- [ ] CI is green. If not, comment "rerun CI when X is fixed" and stop.
- [ ] PR describes the change, the validation that was run, and the risk.
- [ ] Branch named per `CONTRIBUTING.md` convention (`feat/`, `fix/`, `package/`, …).
- [ ] Commits use Conventional Commits format.
- [ ] No `console.log` left in source (check the diff).
- [ ] No secrets, tokens, API keys, or `.env`-like files committed.
- [ ] `.gitignore` not weakened to allow build artifacts (`.crossbind/`, `dist/`, `*.xcframework`).
- [ ] LICENSE file untouched (unless intentional).

## Port PRs (new `ports/*` family or upstream-version bump)

For PRs touching `ports/`:

### Structure

- [ ] The family uses `ports/<name>/{base,wasm,android,ios,wasi}`; add `bin-wasi/` only when an upstream CLI is published.
- [ ] `base/` contains `package.json`, `build.mjs`, `mergeConfig.mjs`, `README.md` and `.npmignore`.
- [ ] Each platform variant has `package.json`, `crossbind.config.js`, `crossbind.build.js`, `README.md`, upstream `LICENSE` and `.npmignore`.
- [ ] The iOS variant has any required `crossbind-port-<name>.podspec`, including `EXCLUDED_ARCHS[sdk=iphonesimulator*] = x86_64` when its prebuilt slices require that exclusion.
- [ ] `.npmignore` excludes `.crossbind/`, source tarballs, intermediates — but **keeps** `dist/prebuilt/`.

### `crossbind.build.js`

- [ ] `getURL(version)` returns a stable URL pattern (or `getSource` is justified by a comment).
- [ ] `buildType` is `'cmake'` (preferred) or `'configure'` (autotools only).
- [ ] `getBuildParams` disables tests, examples, docs (`-DBUILD_TESTING=OFF`, `-DBUILD_EXAMPLES=OFF`, etc.).
- [ ] Per-platform branches (wasm/android/ios) are minimal — only the actual differences.
- [ ] If `replaceList` patches upstream source: each entry has a comment explaining **why** the patch is needed (often: CPU intrinsics, raw pointers, platform-specific assembly).
- [ ] If `prepare` or `build` hook is used: justified by the upstream's specific build system. Not used as a "I want more control" shortcut.

### `crossbind.config.js`

- [ ] `general.name` matches the lib short name.
- [ ] `dependencies: []` lists every transitive C++ dep at workspace level (`workspace:^`).
- [ ] `targetSpecs[]` filters are tight — overrides apply only to the targets that need them.
- [ ] `target.runtime: 'mt'` is set only when the upstream library requires threading; otherwise leave default.
- [ ] `export.libName: []` matches the actual `.a` files produced by the build.

### `package.json`

- [ ] `nativeVersion` field set to the latest stable upstream release (run `pnpm run check:native`).
- [ ] `dependencies` mirrors `crossbind.config.js` `dependencies`.
- [ ] `keywords` include `crossbind`, `webassembly`, and the lib's domain (e.g. `geo`, `crypto`, `image`).

### Validation

- [ ] Every claimed platform variant builds clean: `pnpm --filter '@crossbind/port-<name>*' run build`.
- [ ] An isolated `e2e/` fixture exercises the public port surface; an optional `bin-wasi/` package executes its published commands.
- [ ] e2e: `pnpm run e2e:dev && pnpm run e2e:prod` pass.

## Fix / feature PRs (everything else)

For PRs touching `core/`, `tooling/`, `plugins/`, `examples/`, `e2e/`, or `scripts/`:

### Reproducibility

- [ ] Bug fix PRs reference the failing scenario in the description (or link to an issue with one).
- [ ] Feature PRs describe the use case the feature unblocks.
- [ ] If the fix involves a behavior change, the test plan covers both old and new behavior.

### Scope

- [ ] PR touches one logical concern. Refactors mixed with fixes get split.
- [ ] No drive-by code reformatting (Prettier diff noise) on unrelated files.
- [ ] No "while I was here" feature additions in a fix PR.

### Code quality (skim, not exhaustive)

- [ ] Functions are small (< ~50 lines). Long functions usually mean missed extraction.
- [ ] Files don't grow past ~800 lines without reason. Split when they do.
- [ ] No deep nesting (>4 levels). Use early returns instead.
- [ ] Errors handled explicitly. No empty `catch` blocks unless commented.
- [ ] Booleans named with `is`/`has`/`should`/`can` prefix.
- [ ] Constants in `UPPER_SNAKE_CASE`. Magic numbers extracted to named constants.

### crossbind-specific

- [ ] If touching a bundler plugin (Vite/Webpack/Rollup/RN), check the **other plugins** for the same behavior and validate affected siblings.
- [ ] If `paths.native` is read, it's iterated as an array — never `fs.existsSync(paths.native)` directly.
- [ ] If `force: true` is added to a build call, there's a comment explaining why the cache invalidation is needed.
- [ ] If a new env var or build flag is introduced, it's documented in the relevant `docs/api/*.md` (likely `overrides.md` or `performance.md`).
- [ ] If a new override mechanism is introduced, [`docs/api/overrides.md`](../api/overrides.md) is updated.

### Tests

- [ ] New utility / helper has a Vitest unit test in `core/crossbind/test/`.
- [ ] Bug fix has a regression test that **fails on `main` and passes after the fix**.
- [ ] Test inputs are synthetic constants. No production data, no real network calls.
- [ ] AAA structure (Arrange / Act / Assert).

### Validation matrix

The right validation depends on what changed:

| Changed | Run |
|---------|-----|
| `core/crossbind/src/utils/` | `pnpm test` |
| `core/crossbind/src/actions/` | `pnpm test` + at least one wasm + one ios + one android package build |
| One bundler plugin | The matching example's `dev` + `build` (e.g. plugin-vite → `examples/web-vue-vite`) |
| One port family | `pnpm --filter '@crossbind/port-<name>*' run build` for every affected variant |
| An example | Run that `@crossbind/example-*` package's build and relevant smoke check |
| An E2E fixture | Run that `@crossbind/e2e-*` package's dev/prod or native gate |

For multithread (`mt`) fixes, also verify `crossOriginIsolated === true` in the browser console.

### Documentation

- [ ] Public API change → update relevant `docs/api/*.md`.
- [ ] Build pipeline change → update `docs/api/build-state.md` if `state` / `target` shape changed.
- [ ] New override mechanism → update `docs/api/overrides.md`.
- [ ] Load-bearing decision → write an ADR in `docs/adr/`.
- [ ] Per-package change → update that package's `AGENTS.md` if it has one.

## Severity flags

When commenting, mark severity:

| Tag | Meaning | Action |
|-----|---------|--------|
| 🚨 **CRITICAL** | Security, data loss, or production-breaking | BLOCK merge until fixed |
| ⚠️ **HIGH** | Bug, regression risk, missing test for new behavior | Should fix before merge |
| 💬 **MEDIUM** | Maintainability, naming, structure | Consider fixing |
| 💡 **LOW** | Style, suggestion, "nice if" | Optional |

## Approval criteria

- ✅ **Approve**: No CRITICAL or HIGH issues. Optional MEDIUM/LOW noted.
- ⚠️ **Approve with comments**: HIGH issues exist but author has acknowledged a follow-up plan.
- 🚫 **Block / request changes**: Any CRITICAL issue.

## When you're stuck on review

- The PR touches an area you don't know → ask the contributor for more context, or invite a co-reviewer who does know the area.
- The validation matrix takes too long locally → comment with what you've verified, leave the rest as a checklist for CI / contributor.
- The change feels architectural → request an ADR be added to `docs/adr/` first.

## See also

- [`bug-fix.md`](./bug-fix.md) — fix-a-bug workflow (use this BEFORE writing the fix).
- [`new-port.md`](./new-port.md) — author a new port family (this is what's reviewed).
- [`../api/overrides.md`](../api/overrides.md) — override mechanism catalog.
- [`../adr/README.md`](../adr/README.md) — when to write an ADR.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — contributor process.
- [`../../AGENTS.md`](../../AGENTS.md) — repository map, safety rules and validation matrix.
