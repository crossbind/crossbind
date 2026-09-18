# @crossbind/conformance

Cross-runtime conformance kit: every documented C++ and Rust binding feature as ONE
data-driven check list, shared verbatim by the node, browser and React Native legs. Legs
wire only the surfaces their runtime model has; everything else is an explicit `SKIP` line
with the reason — never a silent gap. Known engine gaps found by this suite stay visible as
skips (search `KNOWN ENGINE GAP` in `spec/run.mjs`).

## Pieces

- `native/conformance.h` — header-only C++ surface (class/fields/methods, string/vector,
  shared_ptr factory, virtual dispatch, exceptions, `std::optional`). Bundler apps import it
  by package subpath (`@crossbind/conformance/native/conformance.h`); standalone builds list
  `../conformance/native` in `paths.header`.
- `spec/run.mjs` — `runConformance(surfaces)` returning `{ pass, run, skipped, summary,
  lines }`. Every binding call is awaited, so the same list serves synchronous (jsi, direct
  wasm) and worker-backed runtimes.
- `native/confpointers.h`, `confcallbacks.h`, `conftext.h`, `confwrappers.h`, `conftypes.h` (+
  `conftypes2.h`, `confkinda.h`, `confkindb.h`, `confprelude.h`, `confpreludedeps.h`, `confexport.h`) — the pointer and handle
  rules: number/byte/void*/struct/opaque handles and their helpers, out-parameters, C function
  pointers, `const char *` as a string, smart pointer wrappers, unique_ptr references, enums,
  virtual bases, registration guards across headers, a header prelude and an ignored
  declaration. Also header-only, and prefixed because the kit directory joins every leg's include path (a
  `strings.h` here shadows the POSIX header). `config.mjs` carries the header options these need
  (`headerPrelude`, `ignoredDeclarations`); spread it into a leg's `export`. They need the
  toolchain image with crossbind's SWIG fork; the previously pinned image does not bind them.
- `spec/sections/*.mjs` — one check list per header, composed by `run.mjs`. Worker-backed legs
  run them too: handles and instances travel back through the adapter's object registry; only
  the checks that pass a JS function skip, and identity (`instanceof`) or vector shape differ
  by contract as in the cpp section. A field written through a worker proxy goes over the
  object's own port, a call over the module's: read the field back before handing the object
  to a call, or the call can overtake the write.
- `../conformance-rust/` — the Rust half: one plain crate (`src/lib.rs`, every construct in
  sections) built as a cargo package like `core/embind-rust/demo`; `spec/sections/rust/*.mjs` hold
  its checks. Constructs the generator does not carry yet are `todo` entries: a miss prints a
  `TODO` line and counts in the summary's `todo:` figure, not against pass/run, so the legs'
  gates stay green until the generator learns them; a todo that passes says so (promote it).
  `spec/sections/rust/parity.mjs` holds the napi.rs parity list (what napi-rs binds and ours
  does not yet), with the JS shapes napi.rs documents as the expected values.
- `spec/coverage.mjs` — `trackExports(module)` records what the checks touch, so the
  `coverage` section fails when a kit export goes untested; `spec/bridgeExports.mjs` reads the
  bridges' export lists (node only, so run.mjs stays loadable in browsers and on the edge).
  Wired by legs that build the bridges themselves (node).

## Legs

| Leg | App | Run |
|-----|-----|-----|
| node st (direct module) | `crossbind-e2e-backend-nodejs` | `pnpm build && pnpm e2e:prod` |
| node mt (direct module, pthreads) | `crossbind-e2e-backend-nodejs-multithread` | `pnpm build && pnpm e2e:prod` |
| browser ×3 (vite plugin, worker-backed) | `crossbind-e2e-web-vite` | `pnpm build && playwright test --config playwright.prod.config.cjs` |
| browser ×3 (vite plugin, mt + worker) | `crossbind-e2e-web-vite-multithread` | `pnpm build && playwright test --config playwright.prod.config.cjs` |
| browser ×3 (webpack plugin via rspack, mt, worker-backed) | `crossbind-e2e-web-rspack` | `pnpm build && pnpm e2e:prod` |
| browser ×3 (no plugin, CLI standalone, mt) | `crossbind-e2e-web-vanilla` | `pnpm build && pnpm e2e:prod` |
| edge (cloudflare worker, direct module) | `crossbind-e2e-cloud-cloudflare-worker` | `pnpm build && playwright test --config playwright.dev.config.cjs` |
| Android + iOS (jsi) | `crossbind-e2e-mobile-reactnative-cli` | `pnpm run:android` / `pnpm run:ios` — the screen prints `CONFORMANCE pass/run` |

Plugin coverage: the legs exercise every bundler plugin in the repo — vite st and mt (the
vite plugin wraps `@crossbind/plugin-rollup`, so the rollup core rides along), webpack/rspack,
metro + react-native — plus the no-plugin standalone CLI flow on node (st and mt), in the
browser (vanilla) and on the edge. Note the browser mt runtimes are worker-backed at the
binding layer even when React 19 renders their thenable results as if they were sync.

Capability flags per leg: `caps.worker` marks the proxy contracts (vector returns arrive as
plain arrays, plain arrays coerce into vector params, enum values cross as identity-stable
transfer-handler tokens, live-JS values cannot cross). `caps.jsiNative` is accepted but
currently drives no skip: the engine-gap wave closed the jsi C++ gaps (fields, exception
messages, by-value vectors, `std::optional`), so the full direct-runtime list runs there.
The Rust surface runs in full on every leg its import model reaches.
