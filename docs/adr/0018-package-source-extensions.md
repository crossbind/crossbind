# ADR-0018: Make package sources an extension role, with Conan the first

- **Status:** Proposed
- **Date:** 2026-11-10
- **Affects:** `core/crossbind/src/utils/{packageSources,packageSourceImport,packageSourceInstall,packageSourceApi,packageSourceStage,runPackageSource,targetToolchain}.js`, `src/state/{attach,refresh}PackageSources.js`, `src/actions/preparePackageSources.js`, `extensions/conan/`, the extension contract (version 2), `packages.<name>` and `<name>:` imports, `tooling/cloud/scripts/node-modules.mjs`

## Context

ADR-0013 put ConanCenter's packages behind `conanDependencies` and the `conan:` import scheme, all of it in the
core: Conan's profiles, the arguments of `conan install` and the reading of its graph, and beside them the parts that
have nothing of Conan in them, as where a tool runs, what of a recipe's output is taken, and how a package is staged
and linked.

Another package manager would have meant a second copy of those parts, or switches in them for each. The extension
contract (ADR-0017) already lets a package add a store, an installer or a command, each with an api of its own and
the version of the contract it is written for.

## Decision

A package manager reaches a project through a role of the extension contract, and Conan moves out of the core as the
first to hold it.

- A package source is a role of the extension contract, `packageSource`, which version 2 of the contract adds:
  `check(declared)`, `install(api, { dependencies, toolchain, lock })`, and the optional `inputs` and `storeUnits`.
  `docs/api/extensions.md` is the contract.
- The extension's name decides all that is the source's: `packages.<name>` in the config, `<name>:<package>/<header>`
  imports, `<name>.lock`, `.crossbind/<name>/`, `~/.crossbind/<name>` and `~/.crossbind/<name>-local`, and
  `/var/cache/crossbind/<name>` in a container. With `conan` every import, file and folder of ADR-0013 stays.
- What a project declares is under one key, `packages`, by each source's name: `packages.conan.zlib` is what
  `conan:zlib/…` imports. `conanDependencies` stops the config, with the new spelling in its error, and so does a name
  under `packages` that is no source of the project. `cargoDependencies` is unchanged here; its move under `packages`
  is a change of its own.
- The core keeps what is the same for every source and what guards the developer: where a tool runs and what it
  mounts, the environment allowlist, a work directory per run, the check of every field a tool reports, the path and
  link rules of staging, the link order, manifests, stamps, the lock's file and the license rows.
- A source keeps what is its tool's: its home, its profiles, its command line, what it reads back, and the oldest
  version of a tool of the machine it takes.
- The core gives a source the toolchain it builds a target's own archives with, as plain data (`targetToolchain.js`),
  so that a package matches the module it links into and a source imports nothing of crossbind's.
- Conan is `@crossbind/extension-conan`, a dependency of `crossbind` at its exact version, which the core loads itself:
  a project has it without installing or listing it, and an extension listed under its name takes its place.
- `cargo:` stays in the core. The schemes an import may open with are `cargo` and the names of the project's sources,
  in one list.

## Consequences

- **Positive** — Another package manager is a package of its own, with no change to the core. The checks of what
  recipes report cannot be skipped: staging takes what a source returns through them.
- **Positive** — What is Conan's changes and is tested by itself. Its profile is byte for byte what the core wrote,
  compared for every target before the core's copy went.
- **Negative** — The contract now has build-time code that runs recipes, and what a source does with a file a recipe
  wrote is the source's to get right. The api gives `work.read()`, which follows no link, and the core takes the
  control characters out of a failure that is not its own.
- **Negative** — `crossbind` depends on a package of the workspace, which every install and deploy of the CLI has to
  bring: it is published with the core, and `tooling/cloud/scripts/node-modules.mjs` lays it into the compiler image.
- **Negative** — crossbind downloads no tool. A source other than Conan takes an image of the project's own that has
  its tool, or the machine's under `RUNNER=LOCAL` and for iOS and macOS.
- **Negative** — A project that declares `conanDependencies` rewrites it as `packages.conan` before it builds again;
  the error says how.
- Each target is staged again once and headers bind again, as the stamp and the cache keys changed shape.
  `prepareConanDependencies` is `preparePackageSources` and a staged dependency carries `general.packageSource` where it
  carried `general.conan`, so `@crossbind/plugin-react-native` moves with the core.

## Alternatives considered

- **Keeping Conan in the core and adding the next manager beside it** — Each would copy the runner, the staging and
  the checks, or grow switches in them.
- **Making the languages extensions too** — Binding generation, the embind layers and each platform's link are where
  C++ and Rust differ most and share least, and no other language is asked for. Left until one is.
- **Making `cargo:` a source** — cargo builds a crate with the bridge crate crossbind generates for it, where a
  source's package comes built from its tool and is staged: another shape. Its scheme is listed beside the sources'.
- **A key per source, `<name>Dependencies`** — Every source a project lists would add a top-level key to the config,
  spelt after an extension's name, and a misspelt one would be left unread. Under `packages` each name is checked
  against the project's sources.
- **Reading `conanDependencies` beside `packages.conan`** — Two spellings to document and test for good, and a project
  could hold both. crossbind 2 is still in beta, so the old key stops with an error that says the new one.
- **A switch that turns the built-in off** — Without packages under `packages.conan` the source does nothing, so
  there is nothing to turn off.
- **Letting a source check and stage its own packages** — The checks keep a recipe's output from reaching paths, CMake
  text and linker arguments. In the core they hold for every source.

## See also

- Related ADRs: ADR-0013 (the `conan:` scheme and the staging, which stand; its `conanDependencies` is
  `packages.conan` now), ADR-0015 (runners),
  ADR-0017 (the host whose extensions the contract began with)
- Related code: `extensions/conan/`, `core/crossbind/src/utils/packageSource*.js`,
  `core/crossbind/src/utils/runPackageSource.js`, `core/crossbind/src/utils/targetToolchain.js`,
  `core/crossbind/test/{packageSource*,runPackageSource,conanExtension,conanGraph,conanProfile}.test.js`
- `docs/api/extensions.md` (Package sources), `docs/api/conan.md`
