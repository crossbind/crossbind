<!-- GENERATED from docs/api/README.md by scripts/build-agent-skill.mjs. Do not edit. -->

# crossbind — Runtime & Config API Reference

> **For AI agents and humans alike.** Every option, every default, every constraint — in one place. If you're integrating crossbind into a project, start with [`init.md`](./init.md). If you're authoring a `crossbind.config.js`, see [`crossbind-config.md`](./crossbind-config.md).

crossbind has **two API surfaces** that get confused often. Keep them straight:

| Surface | When | Authored by | Documented in |
|---------|------|-------------|---------------|
| `init(opts)` | **Runtime** — at the moment your app calls into Wasm | Every consumer | [`init.md`](./init.md) |
| `crossbind.config.js` | **Build-time** — read by the `crossbind build` CLI | Every consumer | [`crossbind-config.md`](./crossbind-config.md) |
| `crossbind.build.js` | **Build-time** — only inside `ports/*` source folders | Package authors only | [`crossbind-build.md`](./crossbind-build.md) |

Cross-cutting topics:

- [`filesystem.md`](./filesystem.md) — How files persist (or don't) across browser, Node, and edge runtimes. Covers OPFS, memfs, the `useWorker` requirement, and the auto-fallback chain.
- [`threading.md`](./threading.md) — Single-thread vs multi-thread Wasm, the COOP/COEP requirement, why `useWorker` is a *separate* axis from threading, and what edge runtimes can't do.

C++ binding & build authoring:

- [`cpp-binding-rules.md`](./cpp-binding-rules.md) — Rules for writing C++ that crossbind can auto-bind (no raw pointers, C++11+, wrapper pattern, JSPI advanced).
- [`rust.md`](./rust.md) — Rust bindings: `cargo:` crate imports, app-local `.rs` sources, `export.type: 'cargo'` packages; idiom table.
- [`wasi.md`](./wasi.md) — `platform: 'wasi'` single-module command builds, `-wasi` prebuilts, `-bin-wasi` npm CLI tool packages.
- [`swig-escape.md`](./swig-escape.md) — Manual SWIG `.i` files when auto-generation isn't enough.
- [`build-state.md`](./build-state.md) — `state` and `target` object shapes passed to `crossbind.build.js` hooks; full inventory of 30 built-in build targets.
- [`overrides.md`](./overrides.md) — Catalog of 20 override mechanisms ordered least → most invasive.
- [`troubleshooting.md`](./troubleshooting.md) — Common errors mapped to the right override; tribal-knowledge gotchas from real packages.
- [`performance.md`](./performance.md) — Default Emscripten + CMake flags reference; what's safe to override and what to leave alone.
- [`lifecycle-and-types.md`](./lifecycle-and-types.md) — Why JS-side `m.delete()` isn't a thing in crossbind + TypeScript `.d.ts` notes.

## The 30-second mental model

```
┌─────────────────────────────────────────────────────────────┐
│  Build time:  crossbind build CLI                               │
│  ┌────────────────────┐         ┌────────────────────┐     │
│  │ crossbind.config.js    │  +      │ crossbind.build.js     │     │
│  │ (consumer-side)    │         │ (package author    │     │
│  │ deps, paths, flags │         │  only — wraps a    │     │
│  │ runtime: st|mt     │         │  C++ library)      │     │
│  └────────────────────┘         └────────────────────┘     │
│            │                              │                 │
│            ▼                              ▼                 │
│  Emcc / wasi-sdk / cargo / NDK / Xcode produces             │
│  .wasm / .a / .xcframework                                  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Runtime:  your app                                         │
│  ┌────────────────────────────────────────────────────────┐│
│  │ const m = await initNative({                            ││
│  │   useWorker: true,    // for OPFS persistent storage   ││
│  │   fs: { opfs: true }, // browser default               ││
│  │   env: { ... },                                        ││
│  │   onRuntimeInitialized: (m) => {...},                  ││
│  │ })                                                     ││
│  │ // m.FS, m.toVector, m.autoMountFiles, ...             ││
│  └────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Common pitfalls (read these even if you skip the rest)

1. **`crossbind.config.js` is NOT runtime config.** It's read once by the `crossbind build` CLI. Putting `useWorker: true` here does nothing — that's a runtime option for `init(opts)`.
2. **OPFS persistent storage in browser requires `useWorker: true`.** OPFS API is only exposed in Worker scope. Mounting `/opfs/...` from the main thread throws.
3. **`runtime: 'mt'` in production silently fails without COOP/COEP headers.** Dev plugins inject them; prod hosts (Vercel, Netlify, nginx, Cloudflare Pages, …) need explicit configuration.
4. **Edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge) don't support Web Workers.** That means no `useWorker`, no OPFS, no multithread — only single-thread + in-memory fs.
5. **`paths.native` is an array.** Not a string. `fs.existsSync(paths.native)` is a bug.

## See also

- ADRs that constrain these APIs: [ADR-0003](../adr/0003-function-typed-env-values.md) (function-typed env values).
- High-level integration playbooks per framework: [`docs/playbooks/integration/`](../playbooks/integration/).
- Codemap for source pointers: [`docs/CODEMAP.md`](../CODEMAP.md).
