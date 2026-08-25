<!-- GENERATED from docs/playbooks/new-port.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Playbook — Author a native library port

> **Port author** — Use this workflow when an upstream C or C++ library should be published as an `@crossbind/port-*` family.

## Goal

Create a `ports/<name>/` family that:

- Builds the supported `wasm`, `android`, `ios` and `wasi` platform variants from one shared recipe.
- Optionally publishes an upstream command-line program through `bin-wasi/`.
- Exposes the library through Embind or SWIG bridges.
- Pins the upstream source version and digest.
- Declares upstream license metadata in `base/package.json` so `crossbind licenses` can derive NOTICE and SBOM output.

## When to use

- The user wants to add an upstream native library to the crossbind port catalog.
- A `ports/<name>/` family exists but needs another platform variant.
- A library already has linkable variants and now needs a WASI command package.

For application-owned C++ that should stay inside one app, start from a Library Prebuilt project instead:

```bash
npm create crossbind@beta -- my-library Library Prebuilt
```

## Repository shape

Use `pnpm run scaffold:port -- <name>` and compare the result with `ports/zlib/`:

```text
ports/<name>/
├── base/                     # @crossbind/port-<name>
│   ├── package.json          # family metadata, nativeVersion, upstream license
│   ├── build.mjs             # shared source acquisition and build recipe
│   ├── mergeConfig.mjs       # merges the recipe into a platform config
│   ├── README.md
│   └── .npmignore
├── wasm/                     # @crossbind/port-<name>-wasm
│   ├── package.json
│   ├── crossbind.config.js
│   ├── crossbind.build.js
│   ├── README.md
│   ├── LICENSE
│   └── .npmignore
├── android/                  # same platform-variant shape
├── ios/                      # same shape; add a podspec when the port needs one
├── wasi/                     # WASI library variant
└── bin-wasi/                 # optional npm bin surface for an upstream CLI
```

The family recipe lives once in `base/build.mjs`. Each platform variant reuses it through `crossbind.build.js`; target-specific differences belong in that variant's config or build overlay.

## Required contracts

### `base/package.json`

- Name it `@crossbind/port-<name>`.
- Pin `nativeVersion` to the upstream stable release.
- Declare `crossbind.upstream.license` according to `ports/README.md`.
- Keep family metadata here instead of duplicating it across variants.

### Platform-variant `package.json`

- Name it `@crossbind/port-<name>-<platform>`.
- Depend on `@crossbind/port-<name>` with a workspace range.
- Declare every native dependency using its matching platform variant. For example, a wasm consumer of zlib depends on `@crossbind/port-zlib-wasm`, while its iOS sibling depends on `@crossbind/port-zlib-ios`.
- Keep the `crossbind build -p <platform>` script aligned with the directory name.

These dependencies are load-bearing: pnpm's package graph determines native build order, and crossbind uses the same graph for link inputs.

### Build and config files

- `base/build.mjs` owns the upstream URL, `sha256`, patches and common configure/build options.
- `base/mergeConfig.mjs` applies family defaults without erasing variant-specific target data.
- `<platform>/crossbind.build.js` re-exports or extends the base recipe.
- `<platform>/crossbind.config.js` declares the relevant target specs, exported libraries, data and environment.
- `bin-wasi/package.json` owns the npm `bin` map; its E2E must execute the published command surface.

### Published files

- Put the upstream license text in every platform variant that ships native artifacts.
- Exclude `.crossbind/`, downloaded source and build intermediates from npm packages.
- Do not exclude `dist/prebuilt/`; consumers need those artifacts.
- Keep generated archives, binaries and source trees out of the recipe source directory.

## Native version sourcing

Use the latest stable upstream release. Resolution order:

1. GitHub Releases API, excluding prereleases.
2. GitHub Tags API when the project does not publish releases.
3. The upstream project's release/download index as a last resort.

Run the repository checker after adding the family:

```bash
pnpm run check:native -- --update
```

Review the selected version and source digest instead of accepting an automated bump blindly.

## Build-system preference

1. Prefer CMake when upstream supports it.
2. Use autotools only when that is the maintained upstream path; see `ports/openssl/`.
3. Use a thin CMake adapter or an explicit custom build hook for other systems, and keep the exception documented.

Disable upstream tests, examples and documentation in distribution builds unless they are needed to produce the library.

## Commands

```bash
# Create the current base + platform-variant structure.
pnpm run scaffold:port -- <name>

# Resolve/check upstream versions.
pnpm run check:native -- --update

# Build every package in the family.
pnpm --filter '@crossbind/port-<name>*' run build

# Iterate on one variant.
pnpm --filter @crossbind/port-<name>-wasm run build

# Check publish and artifact contracts.
pnpm run check:dist
node scripts/check-publish-hygiene.js
```

Add or update an `e2e/` fixture that consumes the port through the same public surface users will install. Do not turn an unrelated example into a private port test.

## Validation

- [ ] Every claimed platform variant builds on a compatible host: wasm, Android, iOS and WASI.
- [ ] Optional `bin-wasi/` E2E executes every published command entry.
- [ ] `pnpm run check:dist` finds the expected artifacts.
- [ ] Platform variants have the required README, upstream LICENSE and `.npmignore` files.
- [ ] The iOS package includes any required podspec and simulator exclusions.
- [ ] `nativeVersion` and `sha256` match the selected stable source.
- [ ] Each native dependency uses the matching platform-variant package.
- [ ] `crossbind.upstream.license` is complete and `crossbind licenses --check` passes.
- [ ] `node scripts/check-publish-hygiene.js` passes.
- [ ] The relevant `@crossbind/e2e-*` fixture passes in development and production modes where applicable.

## Common pitfalls

- Putting shared recipe files in every platform directory instead of `base/`.
- Treating `base/` as an aggregate package that depends on its variants; dependency direction goes from a platform variant to its base recipe.
- Depending on `@crossbind/port-zlib` where the linker needs `@crossbind/port-zlib-wasm` or another matching platform variant.
- Omitting `wasi/` from a library family merely because the first consumer is a browser.
- Adding `bin-wasi/` without a real npm `bin` map and command-level E2E coverage.
- Publishing without an upstream version pin, digest or license metadata.
- Editing `dist/` or `.crossbind/` by hand instead of fixing the recipe.

## Reference

- Small canonical family: `ports/zlib/`
- Transitive CMake dependencies: `ports/tiff/`
- Autotools recipe: `ports/openssl/`
- Large dependency graph and optional CLI: `ports/gdal/`
- Port contracts: `ports/README.md`
- Scaffolder: `scripts/scaffold-port.mjs`
- Distribution CMake template: `core/crossbind/src/assets/cmake/dist.cmake`
