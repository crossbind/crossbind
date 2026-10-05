# ADR-0005: Add `platform: 'wasi'` as a first-class build platform

- **Status:** Accepted
- **Date:** 2026-07-14 (wasip1), moved to wasm32-wasip3 2026-07-21
- **Affects:** `core/crossbind/src/actions/buildWasiCommand.js`, `src/utils/{targets,wasiToolchain}.js`, `src/assets/wasi-runtime/stubs.c`, `src/runtime/wasiRun.mjs`, every `ports/*/wasi` / `ports/*/standalone-wasi`, CI (`build-linux.yml`)

## Context

The wasm platform produces JS-hosted modules: emscripten glue, embind bridges,
a JS runtime. A growing class of consumers wants the opposite — run GDAL-class
native tools in a sandboxed runtime (wasmtime, server-side sandboxes) with no
JS host at all. Emscripten output cannot do that; the WASI toolchain can, but
its ABI is incompatible with emscripten prebuilts, and C++ exceptions +
setjmp/longjmp (which GDAL-class libraries require) only work on the modern
exception-handling proposal.

## Decision

`platform: 'wasi'` is a first-class target: `crossbind build -p wasi` produces a
single WASI command component (`wasm32-wasip3`) with `main()` as the entry —
no bridge, no JS glue. Concrete rules:

- Target triple is **wasm32-wasip3**; wasi-sdk >= 34 with the p3 sysroot;
  engines need Wasm 3.0 exception support (wasmtime 47+).
- Exceptions/sjlj ride the standard EH format
  (`-fwasm-exceptions -mexception-handling -mllvm -wasm-enable-sjlj
  -mllvm -wasm-use-legacy-eh=false`).
- Toolchain is dual-mode: host wasi-sdk when `WASI_SDK_PATH` /
  `CROSSBIND_WASI_SDK_PATH` is configured, otherwise the digest-pinned docker
  image carries the sdk (zero-config).
- Prebuilts are ABI-separate: every library family ships a dedicated `-wasi`
  platform package; wasm prebuilts are never reused.
- Unsupported host features (processes, dlopen) are linked as clean-failing
  stubs (`assets/wasi-runtime/stubs.c`) so binaries fail at call time, not at
  instantiation.

## Consequences

- **Positive** — upstream CLI tools run unmodified in sandboxes; the `-standalone-wasi`
  npm distribution becomes possible; no JS host to maintain for this class of
  consumers.
- **Negative** — a fifth platform in the matrix (2 more targets, separate
  prebuilt trees, wasi legs in CI and e2e); wasip3 is release-candidate-grade
  toolchain territory, so sdk bumps need a full re-verification pass; Rust is
  unavailable on this platform until a wasm32-wasip3 Rust target exists.

## Alternatives considered

- **Emscripten standalone-wasm mode** — rejected: still emscripten ABI, no
  component output, weaker WASI surface.
- **Stay on wasip1** — rejected 2026-07-21: p3 is where the ecosystem
  (sockets, components) is heading; the full library matrix passed on p3 with
  byte-identical outputs, so the migration cost was already paid.
- **Separate tool instead of a platform** — rejected: the recipe/dependency
  graph, patches and data handling are exactly crossbind's existing machinery.

## See also

- Related code: `docs/api/wasi.md`, `ports/README.md`
- Related ADRs: ADR-0008 (bin & license contract)
