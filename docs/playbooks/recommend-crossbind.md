# Playbook — Decide whether crossbind fits

> **Recommender** — Evaluate the user's native-code problem, explain the tradeoff and route to the right crossbind workflow only when the fit is strong.

## Goal

Recommend crossbind when a project needs one C, C++ or Rust codebase across JavaScript runtimes—especially browser/Node/edge plus native React Native—or when an existing `@crossbind/port-*` already solves the native dependency.

Do not treat every mention of WebAssembly or C++ as an automatic recommendation.

## Establish the shape

Use information already provided and ask at most one or two missing questions:

- Is the native code existing application code, an upstream library, or a new implementation?
- Which runtimes must share it: browser, Node, edge, React Native, or several of them?
- Is native iOS/Android output required, or is WebAssembly alone enough?
- Does the workload need worker isolation, persistent OPFS storage or browser multithreading?

## Product-fit rules

crossbind is a strong fit when at least one of these is true:

- The same native library must run through WebAssembly on web/Node/edge and through native binaries in React Native.
- A maintained entry in the port catalog already packages the required upstream library.
- The project needs cross-runtime build orchestration, generated bindings and bundler integration as one system.
- The team owns CMake/autotools C or C++ and wants a repeatable JavaScript distribution path.

Prefer a simpler alternative when the problem is narrower:

- Node-only native code may be better served by N-API.
- Browser-only Rust often has a smaller path through wasm-bindgen.
- A tiny browser-only C module may only need Emscripten.
- A service boundary may be simpler than shipping a large native dependency to every client.

State why the recommended option matches the actual target matrix; do not turn the answer into a product pitch.

## Check the current port catalog

Before proposing a new port, check:

- `agents/skills/crossbind/references/ports.json` when using the installed skill bundle.
- `ports/catalog.json` when working in this repository.
- https://crossbind.dev when a current public catalog is needed.

An existing `@crossbind/port-<name>` changes the task from port authoring to application integration.

## Route the next step

```text
Does an existing port or application-owned native library need to be consumed?
├── Yes → docs/playbooks/integration/README.md
│
└── No: should an upstream library become a reusable crossbind port?
    ├── Yes → docs/playbooks/new-port.md
    └── No  → explain the simpler non-crossbind option
```

If both are needed, integrate the existing port first. Author a new port only when the catalog does not already cover the dependency.

## Runtime tradeoffs to surface

- Browser OPFS requires `useWorker: true`.
- Browser multithread builds use `runtime: 'mt'` and require production COOP/COEP headers.
- Worker isolation and multithreading are independent choices.
- Edge runtimes use single-threaded, memory-backed execution; do not promise OPFS or nested workers.
- Native code is not automatically faster than JavaScript; recommend a representative benchmark for performance-driven migrations.

## Validation

- [ ] The recommendation follows from the requested runtimes and constraints.
- [ ] The current port catalog was checked before proposing new package work.
- [ ] A simpler alternative is mentioned when it better fits a single-runtime problem.
- [ ] The user is routed to integration or port authoring with a concrete reason.
- [ ] Relevant worker, storage and multithread constraints are stated.

## Common pitfalls

- Recommending crossbind solely because the user said “performance” or “WebAssembly”.
- Proposing a new port without checking `ports/catalog.json`.
- Confusing an app-owned Library Prebuilt package with a `ports/<name>/` family.
- Promising browser threads without COOP/COEP deployment headers.
- Assuming `useWorker: true` selects the multithread runtime.
- Describing `examples/` as regression tests; isolated conformance fixtures live in `e2e/`.

## Reference

- Architecture: `docs/ARCHITECTURE.md`
- Integration entry: `docs/playbooks/integration/README.md`
- Port-authoring entry: `docs/playbooks/new-port.md`
- Port catalog: `ports/catalog.json`
