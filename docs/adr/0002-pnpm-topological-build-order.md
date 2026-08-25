# ADR-0002: Use pnpm workspace dependencies for transitive C++ build order

- **Status:** Accepted
- **Date:** 2026-05-03
- **Affects:** `ports/*/ports/*/package.json` (the `dependencies` field of every sub-arch package), root `pnpm-workspace.yaml`, CI build scripts.

## Context

Many crossbind packages link against other crossbind packages. GDAL needs PROJ, GEOS, libtiff, libgeotiff, OpenSSL, zlib, zstd, libcurl, libexpat, iconv, lerc, jpegturbo, sqlite3, spatialite, webp. PROJ needs libtiff and SQLite. SQLite is leaf. Building these in the wrong order produces "undefined symbol" linker errors that surface much later than the root cause.

We had three options for managing build order:

1. A hand-maintained list in a script (`build-packages.sh` with explicit order).
2. A separate manifest file describing the C++ link graph.
3. Encoding the dependency graph in `package.json` so pnpm can derive topological order.

## Decision

Each sub-arch's `package.json` declares its C++ dependencies as `"dependencies": { "@crossbind/port-X-<arch>": "workspace:^" }`. The build is invoked with `pnpm --filter='@crossbind/port-*' run build`, which pnpm executes in topological order derived from those dependencies.

The dependency edge encodes both:

- **Build order** — the dependent package can't build until its dependency's `dist/` is on disk.
- **Workspace publish wiring** — pnpm rewrites `workspace:^` to a real version number on `pnpm publish`, so consumers get a coherent dep graph.

## Consequences

**Positive:**

- The build order is automatically correct without any manual maintenance.
- A new package just declares its deps in `package.json`; no separate manifest to update.
- pnpm catches cycles and reports them clearly. CI fails fast if someone declares a cycle.
- Publish-time version pinning is consistent with build-time topology — one source of truth.

**Negative:**

- The `dependencies` field is now load-bearing for *both* npm semantics *and* C++ link order. Forgetting to add a dep produces a linker error, not a JS-level error, which is harder to diagnose.
- pnpm's filter+topological behavior is a pnpm-specific feature. Migrating to npm or yarn would require a different build orchestrator. We accept this lock-in.
- Each sub-arch (`-wasm`, `-android`, `-ios`) maintains its own `dependencies` list, even though they're usually the same. We accept the duplication for explicitness.

## Alternatives considered

- **Hand-maintained shell script** — fast to start, fragile at scale. Every new package needs the script updated; merge conflicts when two PRs add packages. Rejected.
- **Separate manifest file** (`build-graph.json`) — single source of truth, but disconnected from the npm-level dep graph. We'd have to keep them in sync manually. Rejected for redundancy.
- **CMake `find_package` discovery only** — relies on the build sequence being right; doesn't help pnpm decide what to build first. Still used inside each package's CMake config, but doesn't replace the npm-level ordering.

## See also

- Root `pnpm-workspace.yaml` — workspace globber declaring `ports/*/*` as a workspace.
- Any `ports/gdal/wasm/package.json` — example with 13 transitive deps.
- `docs/playbooks/new-port.md` — port dependency guidance references this ADR.
