# ADR-0011: Build native Node.js addons from the same bindings, on embind-jsi over Node-API

- **Status:** Proposed
- **Date:** 2026-09-24
- **Affects:** `core/embind-napi/` (new), `core/embind-jsi/` (value conversion), `core/embind-rust/adapters/jsi.cpp`, `core/crossbind/src/actions/{buildNode,getLinkInputs,buildWasm,createLib,run}.js`, `src/utils/{targets,linkLayout,cargoTarget,runCargo,pullDockerImage}.js`, `src/bin.js`, `tooling/docker/{linux,windows}.Dockerfile`, `ports/*/{darwin,linux,win32}`, `examples/backend-nodejs-native`, `e2e/backend-nodejs-native`, `test-node-native-sample.yml`

## Context

Node users get WebAssembly today (`-p wasm -e node`). Some need a native build instead: system
access, native memory, and Electron apps that load code into their main process. The same SWIG
bridges and Rust adapters already serve two hosts through two embind implementations,
emscripten's for wasm and `@crossbind/core-embind-jsi` for React Native.

Node-API is the ABI-stable surface for native addons: one binary per platform and architecture
loads in every supported Node release and in Electron.

`core-embind-jsi` exposed native memory to JavaScript as external ArrayBuffer "heap windows" and
read C++ values out of them on the `emscripten::val` paths. Electron's V8 memory cage refuses
external ArrayBuffers; Electron 44 failed at startup with `napi_no_external_buffers_allowed`.

Measured per call on an M-series Mac (spike, 24 Sep): a string-returning function took about
350 ns on wasm, 500 ns through JSI over Node-API and 170 ns through raw Node-API; an int call took
130, 148 and 85 ns. Compute-bound runs were layout-dependent and inconclusive.

## Decision

Native Node.js addons reuse `core-embind-jsi` unchanged at the binding level, hosted by a JSI
implementation over Node-API (Microsoft's node-api-jsi, vendored), and every value crosses the
boundary already converted, so JavaScript never reads native memory.

- `platform: 'darwin' | 'linux' | 'win32'`, `arch: 'arm64' | 'x64'`, `runtimeEnv: 'node'`. darwin
  builds on the macOS host against the SDK alone. linux builds in the `linux` toolchain image with
  clang against glibc 2.28 sysroots, win32 in the `windows` image with llvm-mingw against the
  Universal C Runtime; both link the C++ runtime statically. The platforms are opt-in: a plain
  `crossbind build` does not build them.
- Output is one addon per platform and architecture, `<name>.<platform>-<arch>.node`, and one
  CommonJS loader per build type, `<name>.native.cjs`, that picks the addon for
  `process.platform`/`process.arch` and keeps the wasm `initNative()` contract, `terminate()`
  included.
- The host ships in `@crossbind/core-embind-napi`, declared by the consumer and only resolved by
  the engine: the direction rule of ADR-0006.
- Values cross as JSI values (`toWireType2` / `fromWireType2`) on every path, emval included;
  `memory_view` crosses as a copy in a typed array JavaScript allocated. No ArrayBuffer over native
  memory exists, on Node or on React Native.
- The link keeps the bridge archive whole (`-force_load` on ld64, `--whole-archive` elsewhere)
  and lets only Node-API symbols stay undefined (a `-U` list derived from node-api-jsi's function
  table on macOS, a post-link symbol check on Linux); everything else must resolve at link time.
  A Windows DLL cannot leave symbols undefined, so the addon looks Node-API up at run time in the
  executable that loaded it and imports nothing from `node.exe`.

## Consequences

- **Positive** — one set of bindings serves wasm, React Native, Node and Electron. The conformance
  kit passes 252/252 on Node (macOS arm64) and under Electron 44, and 256/256 with rust 45/45 on
  React Native iOS and Android after the conversion change. Moving the conversions into C++ fixed
  `val`-path bugs every JSI host had (a strict-mode `ReferenceError` in `val::as` and
  `val::call`, enum readers, 64-bit pointer truncation, a leaked allocation per string `get`) and
  removed about 700 lines of heap plumbing.
- **Negative** — node-api-jsi is vendored third-party code pinned to one commit, with local patches
  listed in its README that keep crossing values cheap: a call returning a short string went from
  about 370 to 70 ns, against 160 ns on wasm. Native is still not automatically faster: a
  `const char*` argument costs about 1.2 µs against 0.33 µs on wasm and a callback into
  JavaScript about 2.1 µs against 0.5 µs, because the bridge crosses into JavaScript several times
  for each, and compute-bound runs went either way. SWIG bridges are
  still generated in the wasm toolchain image, so a macOS build needs Docker for them and macOS CI
  restores committed bridge snapshots. `worker_threads` are not supported yet: embind-jsi keeps a
  single current runtime per process, so a second environment's `start()` is refused with a clear
  error rather than left to race the first. Every port family has `-darwin`, `-linux` and
  `-win32` packages with arm64 and x64 archives. Rust packages build for macOS only: crossbind has
  no cargo target for the Linux and Windows addons yet.

## Alternatives considered

- **A third embind implementation written directly against Node-API** — the fastest per call, but
  a third binding layer to keep at feature parity with emscripten and JSI, SWIG helpers and the
  Rust adapter included. Rejected for the first phase; revisit if the per-call cost matters to a
  real workload.
- **Keep the heap windows** — rejected: Electron, a stated target, refuses external ArrayBuffers.
- **Per-platform npm packages with `optionalDependencies`, as napi.rs does** — deferred: the loader
  resolves files next to itself; per-platform packaging is a publishing concern for later.

## See also

- Related ADRs: ADR-0006 (Rust bindings, the direction rule), ADR-0009 (toolchain images)
- Related code: `core/embind-napi/`, `core/crossbind/src/actions/buildNode.js`,
  `docs/playbooks/integration/nodejs.md`
