# ADR-0007: Prefix direct crate imports with `cargo:`

- **Status:** Accepted
- **Date:** 2026-08-05
- **Affects:** `core/crossbind/src/integration/getDependFilePath.js`, bundler plugins (vite/rollup/metro), the top-level `cargoDependencies` config map, generated `.crossbind/rust-crates/types/`

## Context

Direct crate imports let JS import a crates.io crate with no local Rust file.
The first implementation used bare names (`import { Uuid } from 'uuid'`),
which collides head-on with the npm namespace: `uuid` and `semver` are also
npm packages, so resolution needed shadowing rules and importer-origin guards
to avoid hijacking `node_modules` code — fragile, and a dependency-confusion
hazard in the making.

## Decision

Crate imports carry an explicit store prefix: `import { Uuid } from
'cargo:uuid'` — the `node:`/`npm:`/`jsr:` convention. Rules:

- The bare-name path, its shadowing rules and the importer-origin guard are
  removed entirely.
- An undeclared `cargo:` import is a hard error pointing at the top-level
  `cargoDependencies` map.
- Ambient TypeScript declarations are emitted per crate as
  `declare module 'cargo:<name>'`.

## Consequences

- **Positive** — zero ambiguity with npm names; resolution needs no guards;
  the import line documents its own origin; type declarations get a stable
  module id.
- **Negative** — a crossbind-specific module scheme bundlers only understand
  through our plugins; version choice lives in config rather than the
  specifier (a `cargo:x@1` form stays open for later).

## Amendment (2026-09-26): module paths

`cargo:<crate>/<module>[/<submodule>…]` imports one public module of a
declared crate, for crates that keep their API in modules (xxhash-rust
exports nothing from its root). Each segment must be a Rust identifier, so a
specifier cannot name a path outside the marker directory. All imports of a
crate share one bridge (`crate_<crate>`): an item registers once, under a
name taken from the module that defines it, so a type reached through the
root and through a module is the same JS class; each import's JS module maps
its own names onto those registrations, and its `declare module` imports the
types it names from the import that exports them. The bridge serves the root
and every module import a marker names; a module that no longer resolves is
left out rather than failing the other imports. Its marker name joins the
path with dots, which crate and module names cannot contain. Metro only sees
markers that exist when it starts, so crossbind scans the app's sources for
module specifiers as it loads; bare crates keep their markers from
`cargoDependencies`.

## Alternatives considered

- **Bare names + shadowing guard** — implemented first, rejected: collision
  surface with npm names and silent-hijack risk.
- **Path-style pseudo-imports** (`./crates/uuid`) — rejected: lies about
  there being a file, breaks tooling that resolves paths.

## See also

- Related code: `docs/api/rust.md`
- Related ADRs: ADR-0006 (Rust binding architecture)
