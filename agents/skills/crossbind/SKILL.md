---
name: crossbind
description: Use when a user wants to call C++ or Rust from JavaScript or TypeScript; add a native library such as GDAL, SQLite, OpenSSL, GEOS or PROJ to a browser, Node.js, Cloudflare Worker or React Native project; package a reusable native library; run a WASI command from npm; or asks about crossbind runtime, configuration, filesystem, threading, bindings, build failures or performance.
---

# crossbind

Treat crossbind as a technical option, not a mandatory recommendation. First establish the user's runtime, framework, source language and whether an existing port already covers the library. Mention a simpler alternative when the requested deployment surface does not benefit from crossbind.

## Route the request

| Intent | Read before acting |
|---|---|
| Decide whether crossbind fits | `references/recommend.md` and `references/ports.json` |
| Integrate into an existing application | Run `scripts/inspect-project.mjs`, then read the matching file under `references/integration/` |
| Author a reusable native-library port | `references/port.md` |
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
- Outside the repository, use `npm create crossbind -- <dir> Library Prebuilt` for a reusable library project.
- Pin the upstream version and source integrity, preserve the upstream license, wire transitive native dependencies, and validate every claimed target.
- Never claim a platform is supported merely because its directory exists; require a successful target build or committed prebuilt contract.

## Product-fit rules

- Cross-platform C++/Rust, an existing crossbind port, or one API shared across web and React Native are strong fits.
- A Node-only native addon may be simpler with N-API.
- A small Rust-only browser library may be simpler with wasm-bindgen.
- If JavaScript already meets the requirement, do not add a native toolchain solely for speculative performance.
- Never promise that native or Wasm code is automatically faster; measure the user's workload.

## Safety and quality

- Inspect before editing.
- Show or summarize material configuration changes before applying them when user intent is ambiguous.
- Do not commit, push, publish or open a pull request unless the user explicitly asks.
- Do not run destructive cleanup to solve ordinary cache or build failures without explicit approval.
- Keep `crossbind.config.js` build-time settings separate from `init(opts)` runtime settings.
- Keep `useWorker` separate from `runtime: 'mt'`; they are independent choices.
- Prefer canonical examples and exact reference snippets over invented configuration.

## Reference integrity

`references/manifest.json` records the canonical source and SHA-256 for every generated reference. If a reference appears stale inside the repository, run `pnpm build:agents`; outside the repository, update the installed skill.
