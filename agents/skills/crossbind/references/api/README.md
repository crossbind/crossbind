<!-- GENERATED from docs/api/README.md by scripts/build-agent-skill.mjs. Do not edit. -->

# crossbind — Runtime & Config API Reference

> Every option, default and constraint in one place, for people and coding agents. Adding crossbind to a project? Start with [`init.md`](./init.md). Writing a `crossbind.config.js`? See [`crossbind-config.md`](./crossbind-config.md).

crossbind has **two API surfaces** that are easy to confuse, and a third for package authors:

- **`initNative(opts)`**, at run time, when your app calls into the module. Every app writes it: [`init.md`](./init.md).
- **`crossbind.config.js`**, at build time, read by `crossbind build` and the bundler plugins. Every app writes it: [`crossbind-config.md`](./crossbind-config.md).
- **`crossbind.build.js`**, at build time, only in a package that wraps a C or C++ library: [`crossbind-build.md`](./crossbind-build.md).

Cross-cutting topics:

- [`filesystem.md`](./filesystem.md) — Where files live in the browser, Node.js and edge runtimes: OPFS, memfs, the `useWorker` requirement and the fallback.
- [`threading.md`](./threading.md) — Single- and multithreaded Wasm, the COOP/COEP requirement, why `useWorker` is a separate choice, and what edge runtimes cannot do.
- [`remote-runner.md`](./remote-runner.md) — Builds without a local Docker: `RUNNER=REMOTE` sends each toolchain step to a runner (`REMOTE_URL_<IMAGE>`, or `REMOTE_URL` for every image), or to crossbind cloud after `crossbind login`; `crossbind runner start` and `runner init`.

C++ binding & build authoring:

- [`cpp-binding-rules.md`](./cpp-binding-rules.md) — Rules for writing C++ that crossbind can auto-bind (pointer handles and strings, C++11+, wrapper pattern, JSPI advanced).
- [`rust.md`](./rust.md) — Rust bindings: `cargo:` crate imports, app-local `.rs` sources, `export.type: 'cargo'` packages, `crossbind.cargo.lock`; idiom table.
- [`conan.md`](./conan.md) — C and C++ packages from ConanCenter: `packages.conan`, `conan:` header imports, `conan.lock`; web, Android, iOS and Node.js addon (Linux, macOS, Windows) builds.
- [`wasi.md`](./wasi.md) — `platform: 'wasi'` single-module command builds and HTTP components (`-e http`), `-wasi` prebuilts, `-standalone-wasi` npm CLI tool packages.
- [`native.md`](./native.md) — Desktop platforms beyond Node.js addons: native executables (`-e native`) and the `darwin`, `linux`, `linuxmusl` and `win32` prebuilt archives in your own C or C++ build.
- [`app.md`](./app.md) — Apps (`target.runtimeEnv: 'app'`) for macOS, Linux, Windows, iOS and Android: the page in the system webview, the bindings native on Hermes; `crossbind app dev` and `crossbind app build -p <platform>`, the app's functions (`crossbind/app`, `<crossbind/app.h>`), installers, stores, security defaults and licenses.
- [`extensions.md`](./extensions.md) — App extensions: native functions an app's host builds in from a package, which the page calls by name; `crossbind.extension.js`, `<crossbind/extension.h>`, Android's `Extension` class and `invoke`.
- [`swig-escape.md`](./swig-escape.md) — Manual SWIG `.i` files when auto-generation isn't enough.
- [`build-state.md`](./build-state.md) — The `state` and `target` objects that `crossbind.build.js` hooks receive, and every built-in build target.
- [`overrides.md`](./overrides.md) — Every override point, from the least to the most invasive.
- [`troubleshooting.md`](./troubleshooting.md) — Common errors and the override that fixes each; gotchas from real packages.
- [`performance.md`](./performance.md) — Default Emscripten + CMake flags reference; what's safe to override and what to leave alone.
- [`lifecycle-and-types.md`](./lifecycle-and-types.md) — What the garbage collector frees and when to call `.delete()` + TypeScript `.d.ts` notes.

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
│  │   fs: { opfs: true }, // default in mt browser builds  ││
│  │   env: { ... },                                        ││
│  │   onRuntimeInitialized: (m) => {...},                  ││
│  │ })                                                     ││
│  │ // m.FS, m.toVector, m.autoMountFiles, ...             ││
│  └────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Common pitfalls (read these even if you skip the rest)

1. **`crossbind.config.js` is not runtime config.** The build reads it, so `useWorker: true` there does nothing; runtime options go to `initNative(opts)`.
2. **Browser OPFS needs `useWorker: true`.** Browsers give synchronous file access only in workers, so mounting `/opfs/...` on the main thread throws.
3. **`runtime: 'mt'` fails in production without COOP/COEP headers.** The dev servers send them; a production host (Vercel, Netlify, nginx, Cloudflare Pages, …) has to be set up to send them.
4. **Edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge) have no Web Workers:** no `useWorker`, no OPFS and no threads; builds there are single-threaded with an in-memory filesystem.
5. **`paths.native` is an array.** Not a string. `fs.existsSync(paths.native)` is a bug.

## See also

- ADRs that constrain these APIs: [ADR-0003](../adr/0003-function-typed-env-values.md) (function-typed env values).
- High-level integration playbooks per framework: [`docs/playbooks/integration/`](../playbooks/integration/).
- Codemap for source pointers: [`docs/CODEMAP.md`](../CODEMAP.md).
