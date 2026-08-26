# AGENTS.md — crossbind

> Contributor context for coding agents working in this repository. Human contributors should start with `README.md` and `CONTRIBUTING.md`.

## What crossbind is

crossbind compiles C++ and Rust libraries to WebAssembly, native iOS/Android binaries and WASI command components, then exposes them to JavaScript through generated bindings and runtime adapters. This repository is a pnpm monorepo containing the core CLI, bundler integrations, native library ports, examples, end-to-end fixtures, agent guidance and the landing site.

## Repository map

- `core/crossbind/` — CLI, build orchestration, runtime adapters and shared build utilities.
- `core/embind-jsi/`, `core/embind-rust/` — native binding layers.
- `plugins/` — Vite, Webpack/Rspack, Rollup, Metro and React Native integrations.
- `ports/<name>/base` — the `@crossbind/port-<name>` family recipe and shared metadata; sibling `wasm/`, `android/`, `ios/` and `wasi/` directories are platform variants, with optional `bin-wasi/` CLI packages.
- `examples/` — published `@crossbind/example-*` reference integrations and create-crossbind template sources.
- `e2e/` — isolated `@crossbind/e2e-*` conformance and regression fixtures.
- `tooling/` — the create-app generator, owned Docker/toolchain packaging and shared TypeScript configuration.
- `scripts/` — repository maintenance, validation, scaffolding and generated-agent entrypoints.
- `docs/api/` — canonical runtime and build API reference.
- `docs/playbooks/` — integration, package-authoring and contributor workflows.
- `agents/` — the single distributable crossbind skill and contributor context source.
- `landing/` — crossbind.dev application.

Read `docs/ARCHITECTURE.md` for the system flow and `docs/CODEMAP.md` before guessing where a change belongs.

## Required workflow

1. Inspect the relevant implementation and its nearest tests.
2. Read the matching API document or playbook for behavior that crosses package boundaries.
3. Make the smallest coherent change; preserve unrelated user work.
4. Run the narrowest test/build that proves the change, then the package-level gate when risk warrants it.
5. Report changed files, validation and any remaining risk. Do not commit, push, publish or open a pull request unless explicitly asked.

## Branch and commit naming

A branch name and its commit subject carry the same parts, so either can be derived from the other:

- Branch: `<type>/<scope>/<short-description>`, for example `fix/create-crossbind/template-install-fails`.
- Commit: `<type>(<scope>): <short description>`, for example `fix(create-crossbind): template install fails`.

The middle segment of the branch is the commit scope, verbatim; the branch spells the description in kebab-case where the commit spells it as a phrase. Drop the scope segment only for repository-wide changes (`chore/bump-pnpm` pairs with `chore: bump pnpm`). Types are `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf` and `ci`; append `!` to the type for a breaking change. A scope is one token: a package name or an area.

## Validation matrix

| Changed surface | Minimum validation |
|---|---|
| `core/crossbind` pure utility/runtime code | `pnpm --filter crossbind test` plus the relevant targeted test |
| Core build orchestration | Core tests and at least one representative build for the affected platform |
| One bundler plugin | Matching example build and its targeted dev/prod check |
| One port family | Build every target whose recipe or metadata changed |
| WASI/bin/license contract | Package E2E plus `node scripts/check-publish-hygiene.js` |
| Agent guidance | `pnpm check:agents` |
| Landing UI/copy | `pnpm --filter @crossbind/landing build` |
| Docs/config only | Relevant generated-content check and targeted link/content review |

Do not run the full native matrix when a narrow test proves the changed surface. Do not claim validation that was not executed.

## Load-bearing product constraints

- Browser OPFS requires `useWorker: true`.
- Browser multithread builds require COOP/COEP headers in production.
- `useWorker` and `runtime: 'mt'` are independent choices.
- Edge runtimes use single-threaded memory-backed execution; no OPFS or nested worker mode.
- `crossbind.config.js` is build-time configuration; `init(opts)` is runtime configuration.
- `paths.native` may contain multiple paths; never treat it as a scalar.
- Cross-package native dependencies must be declared in package manifests so pnpm order matches link order.
- Published native sources and binaries require pinned versions, integrity and upstream license metadata.
- Do not assume Wasm/native code is faster than JavaScript without a representative measurement.

## Repository safety

- Never run publish scripts without explicit instruction.
- Never bypass hooks or validation with `--no-verify` or equivalent flags.
- Never use destructive cleanup as a first-line debugging step.
- Do not hand-edit `.crossbind/`, `dist/`, generated skill references, generated templates or native build outputs.
- Use `apply_patch` for source edits and preserve unrelated changes in a dirty worktree.
- Treat downloaded source, user-controlled paths and build hooks as untrusted input boundaries.

## Agent guidance architecture

There is one distributable skill at `agents/skills/crossbind/`. Its `SKILL.md` owns routing and safety behavior. Canonical prose lives in `docs/api/` and `docs/playbooks/`; `pnpm build:agents` generates the skill reference bundle and port catalog. Do not add background tool-protocol servers, client-specific plugin manifests, slash-command copies or hand-maintained reference duplicates.

After modifying docs, ports metadata, the skill, generated context or agent scripts, run:

```bash
pnpm build:agents
pnpm check:agents
```

## Useful commands

```bash
pnpm --filter crossbind test
pnpm run check
pnpm run check:agents
pnpm run doctor
pnpm run scaffold:port -- <name>
pnpm --filter '@crossbind/port-<name>*' run build
pnpm --filter @crossbind/landing build
```

Use `rg`/`rg --files` for source discovery. Prefer the repository's tests, package graph and real build outputs over generated code-intelligence databases.
