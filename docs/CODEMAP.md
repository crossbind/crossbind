# crossbind — Codemap

> Concept → file pointers. When you know **what** you want to change, find **where** to change it here.
> Pair with `ARCHITECTURE.md` for the high-level mental model.

## Top-level layout

```
crossbind/
├── AGENTS.md                         ← agent entrypoint (read first)
├── docs/                             ← agent-context docs (this file lives here)
│   ├── ARCHITECTURE.md               ← high-level mental model
│   ├── CODEMAP.md                    ← concept → file pointer (this file)
│   ├── adr/                          ← architecture decision records (why-we-chose-X)
│   ├── api/                          ← runtime + build API reference (init, crossbind.config.js, fs, threading)
│   └── playbooks/                    ← per-persona / per-framework workflows
├── .github/                          ← workflows, PR + issue templates
├── scripts/                          ← repo-level Node CLIs (check-*, doctor.sh, …)
├── package.json                      ← root scripts: build, clear, ci:*, e2e, publish, check
├── pnpm-workspace.yaml               ← workspace globs
├── core/                             ← what ships into a consumer's build
│   ├── crossbind/                    ← the CLI + build orchestration (most-touched)
│   ├── embind-jsi/                   ← Embind/JSI helper used by RN bridge
│   └── embind-rust/                  ← Rust producer crate + per-host adapters (see docs/api/rust.md)
├── tooling/                          ← dev-time helpers, not part of a consumer build
│   ├── create-app/                   ← create-crossbind scaffolder (templates built from examples/)
│   ├── docker/                       ← pinned build image
│   └── typescript-config/            ← shared tsconfig
├── plugins/
│   ├── vite/
│   ├── webpack/
│   ├── rollup/
│   ├── react-native/
│   ├── metro/
│   └── react-native-ios-helper/
├── ports/                            ← native libraries built for crossbind's targets
│   ├── README.md                     ← Bin & License Contract (K1-K4 rules, bin map + provenance schemas)
│   └── <name>/
│       ├── base/                     ← brand package (@crossbind/port-<name>): recipe body (build.mjs) + upstream license truth
│       ├── wasm/                     ← per-platform variants
│       ├── android/
│       ├── ios/
│       ├── wasi/                     ← wasi prebuilt (wasm32-wasip3)
│       └── bin-wasi/                 ← upstream CLI as npm commands (where upstream ships one)
├── examples/                         ← reference integrations, published as create-crossbind templates
├── e2e/                              ← internal test benches + conformance kit
├── agents/                           ← one portable skill, generated references, contributor context
└── landing/                          ← crossbind.dev site
```

## "What options does the runtime / config accept?" → API reference

Every consumer-facing field, every default, every constraint lives in [`docs/api/`](./api/):

- [`init.md`](./api/init.md) — `init(opts)` runtime API, Module helpers.
- [`crossbind-config.md`](./api/crossbind-config.md) — `crossbind.config.js` field-by-field (build-time, every consumer).
- [`crossbind-build.md`](./api/crossbind-build.md) — `crossbind.build.js` lifecycle hooks (package authors only).
- [`filesystem.md`](./api/filesystem.md) — OPFS / memfs / node-fs / edge fs decision tree, including the `useWorker` requirement for OPFS.
- [`threading.md`](./api/threading.md) — `runtime: 'st' | 'mt'`, `useWorker`, COOP/COEP, edge-runtime limits.
- [`cpp-binding-rules.md`](./api/cpp-binding-rules.md) — what auto-binding handles + wrapper / SWIG escape patterns.
- [`rust.md`](./api/rust.md) — Rust bindings: `cargo:` imports, app-local `.rs`, cargo-type packages.
- [`wasi.md`](./api/wasi.md) — `platform: 'wasi'` command builds + `-bin-wasi` npm tool packages.
- [`swig-escape.md`](./api/swig-escape.md) — manual `.i` files for the rare cases auto-gen doesn't fit.
- [`build-state.md`](./api/build-state.md) — `state` and `target` shapes + 30 built-in target inventory.
- [`overrides.md`](./api/overrides.md) — 20 override mechanisms (least → most invasive).
- [`troubleshooting.md`](./api/troubleshooting.md) — common errors mapped to fixes.
- [`performance.md`](./api/performance.md) — default flag reference + safe-override guide.
- [`lifecycle-and-types.md`](./api/lifecycle-and-types.md) — JS-side memory + TypeScript notes.

Index + decision tree: [`docs/api/README.md`](./api/README.md).

Additional playbooks:

- [`playbooks/code-review.md`](./playbooks/code-review.md) — review checklist for package + fix/feature PRs.
- [`playbooks/verify-install.md`](./playbooks/verify-install.md) — verify the portable crossbind skill and its bundled inspector.
- [`playbooks/override-dependencies.md`](./playbooks/override-dependencies.md) — rebuild/override dependencies from source via `crossbind.overrides.js` (all platforms), marker/stamp mechanics, `crossbind clean-deps`.
- [`playbooks/licensing-lgpl.md`](./playbooks/licensing-lgpl.md) — shipping closed-source apps with LGPL native deps; `crossbind licenses` (SPDX table, `--notices`, `--check`).

## "Why was X decided this way?" → architecture decisions

Load-bearing decisions live in `docs/adr/`. Read the relevant ADR before changing the affected surface:

- [ADR-0001](./adr/0001-agent-first-class-support.md) — AI agents are first-class consumers.
- [ADR-0002](./adr/0002-pnpm-topological-build-order.md) — pnpm workspace deps drive C++ link order.
- [ADR-0003](./adr/0003-function-typed-env-values.md) — `env` values can be functions of `(state, target)`.
- [ADR-0004](./adr/0004-three-layer-agent-distribution.md) — historical three-layer distribution decision, superseded.
- [ADR-0005](./adr/0005-wasi-platform.md) — `platform: 'wasi'` command components (wasm32-wasip3, dual-mode toolchain).
- [ADR-0006](./adr/0006-rust-bindings.md) — Rust via a flat C ABI; consumers declare the binding layer, never the engine.
- [ADR-0007](./adr/0007-cargo-import-scheme.md) — `cargo:` prefix for direct crate imports (no npm-name collisions).
- [ADR-0008](./adr/0008-bin-license-contract.md) — derived Bin & License Contract (K1-K4) for published binaries.
- [ADR-0010](./adr/0010-skills-first-agent-architecture.md) — one portable agent skill, generated references and normal project tools.

Index + template: [`docs/adr/README.md`](./adr/README.md).

## "I want to change X" → look here

### Build orchestration (`core/crossbind/`)

| Concept | File |
|---------|------|
| CLI entry, command parsing | `src/bin.js` |
| Per-target static lib build | `src/actions/createLib.js` |
| Wasm linking + JS loader gen | `src/actions/buildWasm.js` |
| WASI command link (single .wasm) | `src/actions/buildWasiCommand.js` |
| Rust crate build (`export.type: 'cargo'`) | `src/actions/buildCargo.js` |
| -bin tool derivations (commands, multicall, provenance, license) | `src/actions/buildBinTools.js` |
| License/SBOM row collection (`crossbind licenses`) | `src/actions/licenses.js` |
| Rollup config for runtime adapters | `src/actions/buildJs.js` |
| iOS xcframework assembly | `src/actions/createXCFramework.js` |
| CMake parameter generation | `src/actions/getCmakeParameters.js` |
| Docker / Xcode shell-out | `src/actions/run.js` |
| Bridge file generation (SWIG) | `src/actions/createInterface.js` |
| Native version mtime check (force trigger) | `src/actions/isSourceNewer.js` |
| Resolve transitive C++ deps | `src/actions/getDependLibs.js` |
| Aggregate `env`/`data`/`cmake` per target | `src/actions/getData.js` |
| Target matrix + filtering | `src/actions/target.js` |
| Plugin extension hooks | `src/actions/extensions.js` |

### Configuration + state

| Concept | File |
|---------|------|
| Merge `crossbind.config.*` + defaults | `src/state/loadConfig.js` |
| Runtime config singleton | `src/state/index.js` |
| Default ext lists, paths.\*, dependency graph | `src/state/loadConfig.js` |

### Runtime (JS) layer

| Concept | File |
|---------|------|
| Shared core (createInitCrossbind, mergeDeep, locateFile, …) | `src/assets/js-runtime/core.js` |
| Browser shim (composes URL path + browser FS + worker) | `src/assets/js-runtime/browser.js` |
| Node shim (composes fs path + node FS) | `src/assets/js-runtime/node.js` |
| Edge shim (Cloudflare Workers, etc.) | `src/assets/js-runtime/edge.js` |
| URL-style locateFile | `src/assets/js-runtime/adapters/path-url.js` |
| FS path locateFile (factory) | `src/assets/js-runtime/adapters/path-fs.js` |
| Browser FS (OPFS, autoMount) | `src/assets/js-runtime/adapters/fs-browser.js` |
| Node FS helpers | `src/assets/js-runtime/adapters/fs-node.js` |
| Comlink + Embind worker bridge | `src/assets/js-runtime/adapters/worker-comlink.js` |

### C++ runtime

| Concept | File |
|---------|------|
| Browser entrypoint | `src/assets/cpp-runtime/browser.cpp` |
| Node entrypoint | `src/assets/cpp-runtime/node.cpp` |
| Shared bridge code | `src/assets/cpp-runtime/commonBridges.cpp` |
| Empty-source placeholder (silences ranlib) | `src/assets/cpp-runtime/crossbindEmptySource.cpp` |

### CMake infrastructure

| Concept | File |
|---------|------|
| Top-level CMakeLists template | `src/assets/cmake/CMakeLists.txt` |
| Distribution CMake template (consumer-side) | `src/assets/cmake/dist.cmake` |
| iOS toolchain reference (legacy) | `src/assets/cmake/ios.toolchain.cmake` |

### Packaging

| Concept | File |
|---------|------|
| iOS package podspec template | `src/assets/packaging/crossbind-port.podspec` |

### Utilities

| Concept | File |
|---------|------|
| Structured logger (TTY-aware, colored) | `src/utils/logger.js` |
| Filesystem helpers (findFiles, getParentPath) | `src/utils/{findFiles,getParentPath,getAbsolutePath}.js` |
| JSON I/O | `src/utils/{loadJson,writeJson}.js` |
| JS module loading | `src/utils/loadJs.js` |
| Content-hash for cache keys | `src/utils/hash.js` |
| Docker image pull (digest-pinned) | `src/utils/pullDockerImage.js` |
| Download + extract sources | `src/utils/downloadAndExtractFile.js` |
| System config schema | `src/utils/systemKeys.js` |
| Target inventory single source (TARGETS, targetPathOf) | `src/utils/targets.js` |
| wasi toolchain flags + sdk resolution | `src/utils/wasiToolchain.js` |
| Bin map rendering (commands, npmignore, dispatcher) | `src/utils/binTools.js` |
| K4 provenance block derivation | `src/utils/provenance.js` |
| Family manifest resolution (license/provenance identity) | `src/utils/familyManifest.js` |
| NOTICE/SBOM formatting + derived license expression | `src/utils/licenseReport.js` |
| crossbind target → cargo triple | `src/utils/cargoTarget.js` |
| Rust bridge generation (crate surface parsing, dts) | `src/utils/rustBridgeGen.js` |
| @crossbind/core-embind-rust resolution (consumer-declared) | `src/utils/resolveEmbindRust.js` |
| wasi bin command runner (npm shims import this) | `src/runtime/wasiRun.mjs` |

## Plugins (`plugins/`)

| Plugin | Entry | What it does |
|--------|-------|--------------|
| `plugins/rollup` | `index.js` | Inner kernel: rollup transform for `.h`, watch native paths, build on `generateBundle` |
| `plugins/vite` | `index.js` | Wraps `plugins/rollup`; dev/preview servers with COOP/COEP, HMR force-rebuild |
| `plugins/webpack` | `index.js` | Webpack/Rspack equivalent; dev-server middleware + COOP/COEP |
| `plugins/react-native` | `index.js`, `script/build_{android,ios,js}.js`, `cpp/CMakeLists.txt` | RN integration: Gradle CMake hook, podspec hook |
| `plugins/react-native-ios-helper` | (small helper) | iOS-side RN glue |
| `plugins/metro` | (small bundler hook) | Metro bundler integration |

## Packages (`ports/`)

Each `ports/<name>/<name>-<arch>/` has the same skeleton:

| File | Purpose |
|------|---------|
| `package.json` | npm metadata + `nativeVersion` + workspace deps to other `@crossbind/port-*-<arch>` |
| `crossbind.config.js` | exported targetSpecs (env, data, libName, build params) |
| `crossbind.build.js` | source acquisition (URL, copy, patches), CMake/configure invocation |
| `assets/CMakeLists.txt` *(if needed)* | per-package CMake override |
| `crossbind-port-<name>.podspec` *(ios only)* | CocoaPods manifest with `EXCLUDED_ARCHS[sdk=iphonesimulator*] = x86_64` |
| `README.md` | one-paragraph intent + license note |
| `LICENSE` | upstream library license |
| `.npmignore` | exclude `.crossbind/`, `dist/.../source/`, etc. from publish |

To add a new `ports/<X>`: see `docs/playbooks/new-port.md` (uses `ports/zlib` as the canonical reference).

## Samples (`examples/`)

| Sample | Use as reference for |
|--------|----------------------|
| `examples/web-vue-vite` | Vite + Vue integration |
| `examples/web-react-vite` | Vite + React |
| `examples/web-svelte-vite` | Vite + Svelte |
| `examples/web-react-rspack` | Rspack/Webpack + React |
| `examples/web-vanilla` | Plain HTML + bundler-less |
| `examples/backend-nodejs-wasm` | Node.js consumer |
| `examples/cloud-cloudflare-worker` | Cloudflare Worker / edge |
| `examples/mobile-reactnative-cli` | RN-cli (canonical mobile reference; CI uses `ci/crossbind-snapshot/`) |
| `examples/mobile-reactnative-expo` | RN with Expo |
| `examples/lib-prebuilt-matrix` | Minimal C++ library packaging (no UI) — canonical for Persona 3 |
| `e2e/*` | Internal test benches: bigger demos against multiple `@crossbind/port-*` (curl, gdal, geos, …) + the conformance kit |

## Repo-level scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `check-dist.js` | Verify each package has prebuilt artifacts for expected targets |
| `check-external-dependencies.js` | npm dep version drift (use `--check`/`--update`); all-`*` ranges report as host-provided, never a strict failure |
| `check-native-versions.js` | Native lib version drift via GitHub/registry/HTML scrape (use `--check`/`--update`) |
| `check-beta-status.js` | npm beta tag inventory + `--bump` |
| `check-publish-hygiene.js` | K1/K4 gates: no executable leaks, provenance + derived license on -bin packages |
| `generate-third-party.js` | K3 wrapper: `crossbind licenses --notices --sbom --platform` per dist host |
| `pin-docker-image.js` | Re-pin the digest-locked build image after a docker publish |
| `build-agent-context.mjs` | Generate repository instruction files from `agents/contributor-context.md` |
| `build-agent-skill.mjs` | Generate the installed skill's reference and port-catalog bundle |
| `check-agent-surface.mjs` | Reject stale generated content and obsolete agent integration surfaces |
| `doctor.sh` | Toolchain readiness (Node, pnpm, Docker, emscripten, NDK, Xcode) |
| `scaffold-port.mjs` | Generate a new in-repository `ports/<name>` skeleton |
| `help.js` | `pnpm run help` — grouped, annotated script listing |

All `check:*` and `clear:*` are exposed as `pnpm run` aliases — see `package.json`.

## CI workflows (`.github/workflows/`)

| Workflow | What runs |
|----------|-----------|
| `build-linux.yml` | `pnpm install` → `pnpm run ci:linux:build` → `e2e:prod`; installs a pinned wasi-sdk + wasmtime and runs `ci:linux:e2e:wasi` + the K1/K4 publish-hygiene gate |
| `build-macos.yml` | `pnpm run ci:macos:build` (iOS samples + zlib-ios) |
| `build-windows.yml` | `pnpm run ci:windows:build` (wasm + android subset) |
| `test-android-sample.yml` | RN-cli Android E2E |
| `test-ios-sample.yml` | RN-cli iOS E2E (uses `ci/crossbind-snapshot/` bridge fixtures) |

## Common recipes

### "Add a new C++ library as a crossbind port"

1. Read `docs/playbooks/new-port.md`.
2. Mirror `ports/zlib/` (smallest, simplest).
3. Add workspace deps in each sub-arch's `package.json` to its native deps.
4. Run `pnpm --filter=@crossbind/port-<name>* run build`.

### "Support a new bundler"

1. Read `plugins/vite/index.js` (most-evolved reference).
2. Mirror in a new `plugins/<bundler>/`.
3. Provide: dev/preview server middleware (COOP/COEP), watch-rebuild hook, transform for `.h` files (delegate to `plugins/rollup`).

### "Add a runtime adapter (Deno, Bun, etc.)"

1. Read `core/crossbind/src/assets/js-runtime/core.js` (the contract).
2. Add `<runtime>.js` shim composing the right adapters from `js-runtime/adapters/`.
3. Add the runtime to `core/crossbind/src/state/index.js` target matrix if a new `runtimeEnv` is needed.
4. Update `core/crossbind/src/actions/buildJs.js` rollup options if the bundle format differs.

### "Bump a native library's version"

1. `pnpm run check:native` to see drift.
2. `pnpm run check:native -- --update` to auto-bump `nativeVersion` in every affected `package.json`.
3. `pnpm --filter=@crossbind/port-<name>* run build` to verify.

### "Fix a build pipeline bug"

1. Reproduce locally with the smallest sample (often `examples/lib-prebuilt-matrix` or `examples/backend-nodejs-wasm`).
2. Adjust `core/crossbind/src/actions/<file>.js` per the codemap above.
3. Validation: `pnpm run ci:linux:build && pnpm run e2e:dev && pnpm run e2e:prod`.

### "Integrate crossbind into my own project"

→ `docs/playbooks/integration/README.md` (decision tree + per-framework playbooks).
