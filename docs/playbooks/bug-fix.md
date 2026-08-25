# Playbook — Fix a bug in crossbind

> **Contributor** — The user is editing this repo to fix a defect in the CLI, a plugin, a port, an example or an E2E fixture.

## Goal

Land a minimal, well-validated fix that:

- Reproduces in the smallest possible scope first.
- Passes the right validation gate for the area touched.
- Does not silently widen blast radius (no opportunistic refactors riding along).

## When to use

- A CI workflow is failing.
- A user reports a runtime error from `crossbind build` or an example.
- A plugin / runtime adapter behaves incorrectly in a specific framework.
- An e2e test is flaky or wrong.

## Files involved

Depends on the bug. Use `docs/CODEMAP.md` to find the right file:

| Symptom | Likely area |
|---------|-------------|
| `crossbind build` errors out | `core/crossbind/src/{actions,state,utils}/` |
| Wrong artifact path / cache miss | `actions/createLib.js`, `actions/buildWasm.js`, `actions/isSourceNewer.js` |
| iOS-only / xcframework issue | `actions/createXCFramework.js`, package podspec |
| Bundler dev server / HMR misbehaving | `plugins/{vite,webpack,rollup}/index.js` |
| RN build crash | `plugins/react-native/script/build_{android,ios,js}.js`, `script/CMakeLists.txt` |
| Linker error in package | the package's `crossbind.config.js` / `package.json` workspace deps |
| Browser runtime error after `init` | `core/crossbind/src/assets/js-runtime/` |

## Reproduction strategy

1. **Reproduce in the smallest example or E2E fixture first.** Don't debug against `examples/mobile-reactnative-cli` if `examples/backend-nodejs-wasm` reproduces the same bug — the smaller the surface, the faster the loop.
2. **Use `pnpm --filter` for incremental builds.** Avoid `pnpm run clear` unless you've already tried `pnpm --filter=<scope> run build` and rebuild semantics are demonstrably wrong (mtime check missed something).
3. **Read logs from `core/crossbind/src/utils/logger.js` output.** Step lines update in place; non-TTY (CI) shows a chronological log. Errors print to stderr in red.

## Validation matrix

Pick the gate that matches the **scope of the change**, not the bug:

```
Did you change anything inside core/crossbind/ ?
│
├─ YES → Run: pnpm run ci:linux:build && pnpm run e2e:dev && pnpm run e2e:prod
│         All three must pass.
│
└─ NO ↓

Did you change anything inside plugins/ ?
│
├─ YES → Same gate as above:
│         pnpm run ci:linux:build && pnpm run e2e:dev && pnpm run e2e:prod
│
└─ NO ↓

Did you change a single ports/<X> family?
│
├─ YES → pnpm --filter='@crossbind/port-<name>*' run build
│         Plus: pnpm run check:dist (confirm artifacts exist).
│         Plus: the relevant @crossbind/e2e-* consumer still passes
│         (find via `pnpm why -r @crossbind/port-<name>`).
│
└─ NO ↓

Example-only change?
│
├─ YES → pnpm --filter=@crossbind/example-<name> run build
│         Plus its matching E2E fixture when one exists.
│
└─ NO ↓

E2E-only change?
│
├─ YES → Run that @crossbind/e2e-<name> package's dev/prod or native gate.
│
└─ NO → Docs / scripts / CI only:
         pnpm run check
         Plus targeted manual smoke (e.g. run the script you changed).
```

`ci:linux:build` runs `pnpm run build:examples && pnpm run ci:linux:build:port` — it builds every example plus zlib as a smoke. `e2e:dev` runs browser fixtures in development mode; `e2e:prod` runs them against built artifacts.

## Commands

```bash
# Discover what's changed and where:
git status --short
git diff --stat

# Health snapshot (~5s):
pnpm run check

# Reproduce locally (smallest example):
pnpm --filter=@crossbind/example-backend-nodejs-wasm run build
pnpm --filter=@crossbind/example-backend-nodejs-wasm exec node dist/main.js

# Iterate fast (one package, port variant, example or E2E fixture):
pnpm --filter=<scope> run build

# Full validation (core / plugin changes):
pnpm run ci:linux:build && pnpm run e2e:dev && pnpm run e2e:prod
```

## Validation

- [ ] Bug reproduces deterministically before the fix.
- [ ] Fix is minimal (no opportunistic refactors). If you found other issues, file separate issues / PRs.
- [ ] The matching validation gate from the matrix above passes.
- [ ] `pnpm run check` shows no new outdated entries you didn't intend.
- [ ] If you touched a public API in `crossbind` exports, search consumers (`rg "from ['\"]crossbind['\"]" plugins examples e2e scripts`) and confirm none break.
- [ ] If the bug had a CI signal (workflow failure), the same workflow now passes locally via the same command sequence.

## Common pitfalls

- **Cache-shaped bugs misdiagnosed as code bugs.** If a change "doesn't take effect", check whether `actions/isSourceNewer.js` correctly detects the touched file's mtime. Rebuild with `force: true` or filter-rebuild before assuming the code is wrong.
- **Confusing CI pass with local pass.** CI runs Linux, no Xcode; iOS-affecting fixes need a darwin host to actually validate.
- **Changing `state/loadConfig.js` defaults.** This affects every package, port variant, example and E2E fixture. Run the full validation matrix even if the change "looks small".
- **Forgetting transitive plugin impact.** A change in `plugins/rollup` affects `plugins/vite` (which wraps it). Validate the relevant examples and E2E fixtures for both plugins.
- **Editing `.crossbind/` or `dist/` by hand.** They're generated. Find the source.
- **Grafting the fix onto an example's own config.** If the bug is in a plugin, fix the plugin — don't paper over it with an example config tweak.

## Reference

- Validation matrix is also summarized in `AGENTS.md` (root, "Commands → Validation matrix").
- Logger semantics: `core/crossbind/src/utils/logger.js`.
- Force-rebuild semantics: `core/crossbind/src/actions/isSourceNewer.js`.
- CI workflow definitions: `.github/workflows/build-{linux,macos,windows}.yml`.
