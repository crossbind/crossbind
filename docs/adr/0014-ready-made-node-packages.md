# ADR-0014: Publish each port as a standalone Node-API package with an addon package per platform

- **Status:** Proposed
- **Date:** 2026-10-04
- **Affects:** `ports/*/standalone-napi` and `ports/*/standalone-napi-<platform>-<arch>`, `ports/*/standalone-wasi`,
  `examples/lib-prebuilt-matrix`, `scripts/scaffold-node-packages.mjs`,
  `scripts/check-node-package.mjs`, `scripts/release/node-packages.mjs`,
  `scripts/release/verify-node-packages.mjs`, `scripts/lib/node-registry.mjs`, `.github/workflows/release-crossbind.yml`,
  `core/crossbind/src/actions/licenses.js`, `core/crossbind/src/utils/boundHeaders.js`,
  `core/crossbind/src/utils/runtimeEntries.js`

## Context

ADR-0011 builds Node-API addons from an app's own build: the app installs a port's platform
packages, and `crossbind build -e node` links them, which needs Docker for SWIG and the linux and
windows images. A Node.js user who only wants a library (zlib, GEOS, GDAL) has no build to run.
npm can deliver a binary per machine without one: a package lists one package per platform as
optional dependencies, each filtered by `os`, `cpu` and `libc`, and npm installs only the match.

The constraints:

- A port binds through one bridge, which SWIG writes from the headers of one target in the web
  image's macro table, and that bridge compiles for every desktop target. GitHub's macOS runners
  have no Docker, so SWIG cannot run there.
- crossbind keys its interface and bridge caches by absolute path, and every runner checks out
  at its own path.
- An addon links every component statically: the port and its dependencies, crossbind's runtime
  (embind-jsi adapts Emscripten's embind), node-api-jsi, and on Linux and Windows the toolchain's
  C++ runtime, plus mingw-w64 on Windows. GEOS and libiconv are LGPL, and spatialite offers the
  LGPL among its licenses.
- The release train publishes from main through npm Trusted Publishing, which npm configures only
  on a package that already exists.
- Several packages load into one process, each with its own addon.

## Decision

Each port family publishes `@crossbind/port-<family>-standalone-napi`, the JavaScript bindings of its
public headers, and eight addon packages, `@crossbind/port-<family>-standalone-napi-<platform>-<arch>`,
for darwin, linux, linuxmusl and win32 on arm64 and x64.

- **Name.** The `standalone-` prefix marks a package that runs with nothing to build, as
  `-standalone-wasi` does for a port's command tools; a package without it is an input to a crossbind
  build. `napi` names the format, since `node` is also the runtime environment of a wasm build.
- **Surface.** The bindings package binds the headers its family lists in `export.publicHeaders`,
  every constant included, and its root exports every name with its types (`dist/node/napi.mjs`,
  which `crossbind build -e node` writes). The names are filled when `initNative()` resolves, as in
  a bundler's module for a header, so init options still reach the addon. Typed shim headers stand
  in for varargs C APIs.
- **Each package builds itself.** An addon package's `build` links its own addon into its `dist`, with
  a config that reads the bindings package's, so the headers it binds are listed once. The package of
  the bindings links none, nor an archive of its own: a package that lists addon packages in
  `optionalDependencies` writes only the loader, the entry, the types and the data. The packages it lists
  are the platforms it publishes for, so a package may publish for fewer than eight; on any other
  machine the loader names the platforms it has addons for. Each build ends with
  `crossbind licenses --package`, so nothing copies one package's output into another.
- **One bridge.** Every addon of a family compiles the same bridge, read from a linux package's
  headers. A build that makes no linux addon still resolves them there when a linux package is
  installed (`bridgeTargets`), so the macOS runner compiles the bridges the Linux job generated.
- **One process, several packages.** Each addon keeps its embind state in its own scope, exports
  only its Node-API entry points on macOS, and shares one ordered exit listener.
- **The example library.** `@crossbind/example-lib-prebuilt-matrix` ships its eight addons inside
  the package, next to its wasm and mobile builds, with `node/napi`, `node/wasm` and `edge/wasm`
  entries; its addons are small, so one package is the simpler shape. The train's node runners build
  them into the multi-platform assembly; `examples/backend-nodejs-standalone` uses it.
- **Licenses (ADR-0008, K4).** Each package's `license` is the compound expression
  `crossbind licenses [--platform <platform>] -e node --package` derives for it, and its `LICENSE` carries
  every component's text and its `sbom.cdx.json` the inventory. LGPL libraries stay statically
  linked: the `LICENSE` of an addon that links one names the exact source tag and the steps to
  relink it with a modified library. The `license` field is committed; `LICENSE` and the SBOM are
  build outputs (vendored copies' texts and the windows image's notices come from the build).
- **Train.** A `node` job builds the Linux and Windows addon packages and the packages of the
  bindings after the Linux shards, from the platform packages those shards packed, and runs the
  macOS addon packages' darwin build there too, which generates their bridges without linking; a
  `node-macos` job builds the macOS addon packages after it, from the bridges it hands over with their
  paths moved to the macOS checkout, and fails if its build changed any of them. The plan refuses a train that publishes a standalone Node-API package without the
  platform packages it links. `prepack` refuses a package a build did not fill. Before anything is
  published, `verify_node` installs the exact tarballs from a local registry on all eight targets
  with Node.js 24 and 22 and runs every family's check, one package per app and all in one process.
  A dry run assembles and verifies too.
- **First publication.** npm configures a Trusted Publisher only on a package that exists, so a
  maintainer runs `scripts/release/bootstrap-npm-packages.mjs` once for every new name; it publishes
  a placeholder and configures the trust. A writing train refuses a name npm has never seen, and a
  dry run lists it.

## Consequences

- **Positive:** `npm install @crossbind/port-gdal-standalone-napi` gives a working GDAL with nothing to build,
  on any of the eight targets. The bridges always come from the release commit, so a SWIG or header
  change needs no regenerated files in git. A hollow package or one that does not load on a target
  stops the train before npm sees it.
- **Negative:** 144 more packages per train, each bootstrapped and trusted once by hand. SWIG runs
  once per package rather than once per family, which lengthens the `node` job. The train
  runs longer: the `node` job waits for every Linux shard, the macOS addons wait for it, and
  verification adds sixteen jobs. GDAL's addon packages are about 25 MB packed each. A bridge cache
  miss on the macOS runner fails the build, since nothing there can run SWIG. The LGPL route is a
  maintainer's assessment, not legal advice. The twelve published `-bin-wasi` packages become
  `-standalone-wasi`, and their old names are deprecated with a pointer to the new ones.

## Alternatives considered

- **Committed bridge snapshots** for the macOS runner. Rejected because: every SWIG, header or port
  update would have to regenerate and commit them, dependency-bot pull requests included, and a stale
  snapshot would bind a different surface on macOS.
- **Dynamic linking of the LGPL libraries** (shared GEOS and libiconv beside the addon). Rejected
  for now because: it needs shared builds in the port recipes and per-platform loader paths, while
  static linking with the source tag and relink steps meets the same goal.
- **Holding back the LGPL families.** Rejected because: GDAL, the most wanted package, links GEOS
  and libiconv.
- **One package with every addon inside.** Rejected for the ports because: every install would download
  all eight addons (GDAL's take over 700 MB unpacked). The example library takes this shape.
- **One module per header** (`<package>/<header>.h`). Rejected because: a user of a standalone package
  should not need to know which header declares a name, and the addon loads whole either way.
- **A self-hosted macOS runner with Docker.** Rejected because: it is infrastructure to secure and
  maintain for a public repository.

## See also

- Related ADRs: ADR-0008 (license contract), ADR-0011 (native Node addons), ADR-0012 (musl addons)
- Related code: `scripts/release/node-packages.mjs`, `core/crossbind/src/utils/packageLicense.js`,
  `scripts/release/verify-node-packages.mjs`, `core/crossbind/src/utils/scopedEmbind.js`,
  `core/embind-napi/js/stopOnExit.js`
- Playbooks: `docs/playbooks/releasing-crossbind.md`, `docs/playbooks/licensing-lgpl.md`
