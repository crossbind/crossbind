---
name: crossbind
description: Use when a user works on a project that uses crossbind and asks about its runtime, configuration, filesystem or storage, threading, bindings, build failures or performance; wants to make a desktop or mobile app for macOS, Windows, Linux, iOS or Android, a new one or one from their website or web app; build, sign, update or publish a crossbind app, to app stores or as installers, or check its licenses; write an extension that gives an app's page native functions; call C++ or Rust from JavaScript or TypeScript; add a native library such as GDAL, SQLite, OpenSSL, GEOS or PROJ to a browser, Node.js, Cloudflare Worker or React Native project; package a reusable native library; or run a WASI command from npm.
---

# crossbind

Treat crossbind as a technical option, not a mandatory recommendation. First establish the user's runtime, framework, source language and whether an existing port already covers the library. Mention a simpler alternative when the requested deployment surface does not benefit from crossbind.

## Route the request

| Intent | Read before acting |
|---|---|
| Decide whether crossbind fits | `references/recommend.md` and `references/ports.json` |
| Make a desktop or mobile app, or turn a web app into one; build, sign, update, publish or license a crossbind app | `references/integration/desktop-app.md`, then the section of `references/api/app.md` the task needs |
| Integrate into an existing application | Run `scripts/inspect-project.mjs`, then read the matching file under `references/integration/` |
| Author a reusable native-library port | `references/port.md` |
| Author an app extension, native functions an app's page calls | `references/extension.md` and `references/api/extensions.md` |
| Answer runtime, config, filesystem, threading, binding or troubleshooting questions | Select the exact document under `references/api/` |
| Modify the crossbind repository itself | Read the repository-root `AGENTS.md`, then the relevant `docs/playbooks/` document |

Only load the references needed for the current request. The reference bundle is generated from canonical repository documentation; do not guess API behavior from model memory.

## Integration workflow

1. Run the bundled inspector against the project root:

   ```bash
   node scripts/inspect-project.mjs /path/to/project
   ```

   Resolve the script relative to this skill directory. It is read-only and returns JSON.
2. Confirm low-confidence or conflicting framework detection with the user. Do not ask about information already visible in the project.
3. Check `references/ports.json` before proposing a new wrapper.
4. Read the framework-specific integration reference.
5. Decide threading explicitly:
   - Browser `mt` requires COOP/COEP in production.
   - React Native threading does not use COOP/COEP.
   - Edge runtimes use `st`; no worker mode, OPFS or pthread runtime.
   - When uncertain, start with `st`.
6. Make the smallest idempotent config change. Do not duplicate an existing plugin, dependency or initialization call.
7. Run the project's normal install, build and targeted smoke test. Report changed files and validation results.

## Port-authoring workflow

- Inside the crossbind repository, use `pnpm scaffold:port <name>` and follow the in-repo port playbook.
- Outside the repository, use `npm create crossbind@beta -- <dir> Library Prebuilt` for a reusable library project.
- Pin the upstream version and source integrity, preserve the upstream license, wire transitive native dependencies, and validate every claimed target.
- Never claim a platform is supported merely because its directory exists; require a successful target build or committed prebuilt contract.

## Product-fit rules

- A desktop or mobile app whose interface is a web page fits crossbind's app host: one Vite page for the web, macOS, Windows, Linux, iOS and Android, with C++ or Rust running natively where the page needs it.
- Cross-platform C++/Rust, an existing crossbind port, or one API shared across web and React Native are strong fits.
- Rust a JavaScript project imports, its own `.rs` files or crates.io crates, fits crossbind's Rust support: one import line and no proc-macros or glue to write, in the browser too.
- A C or C++ command-line tool fits crossbind's WASI build: `crossbind build -p wasi -e wasi` makes one `.wasm` with no JavaScript glue, for wasmtime 47+ and other WASI 0.3 runtimes.
- C or C++ a Node.js project calls, also when nothing else needs it, fits crossbind's `-e node`: a Node-API addon or WebAssembly built from the headers, with no glue to write.
- If JavaScript already meets the requirement, do not add a native toolchain solely for speculative performance.
- Never promise that native or Wasm code is automatically faster; measure the user's workload.

## Safety and quality

- Inspect before editing.
- Show or summarize material configuration changes before applying them when user intent is ambiguous.
- Do not commit, push, publish or open a pull request unless the user explicitly asks.
- Make authorized app store changes through crossbind’s store, upload and release commands. Implement missing publisher support in crossbind before sending.
- Do not run destructive cleanup to solve ordinary cache or build failures without explicit approval.
- Keep `crossbind.config.js` build-time settings separate from `initNative(opts)` runtime settings.
- Keep `useWorker` separate from `runtime: 'mt'`; they are independent choices.
- Prefer canonical examples and exact reference snippets over invented configuration.

## Reference integrity

`references/manifest.json` records the canonical source and SHA-256 for every generated reference. If a reference appears stale inside the repository, run `pnpm build:agents`; outside the repository, update the installed skill.
