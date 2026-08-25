<!-- GENERATED from docs/playbooks/integration/README.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Playbook — Integrate crossbind into a JavaScript project

> **Persona 2** — Integrator. The user has an existing (or new) JavaScript / TypeScript / React Native project and wants to consume a `@crossbind/port-*` (e.g. GDAL) **or** wrap their own C++ code from inside it.

## Goal

Drop crossbind into the user's project with the smallest, most idiomatic config change for their framework. Choose the right plugin, wire up the bundler, set up COOP/COEP for multithread when needed, and verify with a smoke build.

## Step 0 — Detect the framework first

Don't guess. If the portable crossbind skill is installed, run its bundled read-only inspector:

```bash
node <crossbind-skill>/scripts/inspect-project.mjs [path-to-project] --json
```

When working from this repository, the same inspector is at `agents/skills/crossbind/scripts/inspect-project.mjs`. If it is unavailable, inspect `package.json`, lockfiles and framework config files directly.

The detector inspects `package.json` deps + filesystem signatures (`vite.config.*`, `next.config.*`, `metro.config.*`, `wrangler.toml`, etc.) and returns:

```json
{
  "framework": "vite" | "webpack" | "rspack" | "rollup" | "react-native-cli"
              | "react-native-expo" | "cloudflare-worker" | "nextjs"
              | "nodejs" | "vanilla" | "unknown",
  "confidence": "high" | "medium" | "low",
  "evidence": [...],
  "recommendedPlaybook": "docs/playbooks/integration/<framework>.md"
}
```

If `confidence` is `low` or `unknown`, **ask the user** before continuing.

## Step 1 — Decision tree

```
What does package.json deps + filesystem look like?
│
├─ has "vite"                         → docs/playbooks/integration/vite.md
├─ has "webpack" or "@rspack/*"        → docs/playbooks/integration/webpack-rspack.md
├─ has "rollup" (only)                 → docs/playbooks/integration/rollup.md
├─ has "next"                          → docs/playbooks/integration/nextjs.md
├─ has "react-native" + no "expo"      → docs/playbooks/integration/react-native-cli.md
├─ has "expo"                          → docs/playbooks/integration/react-native-expo.md
├─ has "wrangler" or worker config     → docs/playbooks/integration/cloudflare-worker.md
├─ Node-only project (no bundler)      → docs/playbooks/integration/nodejs.md
└─ plain HTML / no bundler             → docs/playbooks/integration/vanilla.md
```

Per-framework playbooks contain:

- Which plugin to install (`@crossbind/plugin-vite`, etc.)
- The exact config diff
- Where to call `init(...)`
- Headers / build hooks specific to that bundler
- A reference example (`examples/web-vue-vite/`, etc.) to mirror

## Step 2 — Multithread decision

Ask once, early:

> Will this need to use multiple CPU threads (image processing, large data, crypto, geospatial)? Or is single-threaded fine?

| User answer | Recommend |
|-------------|-----------|
| "Yes, perf matters" / image / video / geo / crypto / large data | `runtime: 'mt'` + COOP/COEP headers in production |
| "No, simple use" / occasional one-off calls | `runtime: 'st'` (default), no headers needed |
| "Not sure" | Start with `st`; switching to `mt` later is a config flag away |

When recommending `mt`, **always** mention production headers:

> In dev/preview, the crossbind bundler plugin sets these for you. In production, your hosting layer (Vercel, Netlify, Cloudflare, nginx, S3+CloudFront, …) must send:
>
> ```
> Cross-Origin-Opener-Policy: same-origin
> Cross-Origin-Embedder-Policy: require-corp
> ```
>
> Without them, browsers disable SharedArrayBuffer and threading silently fails.

The framework playbook will name the host-specific config file (`vercel.json`, `_headers`, nginx snippet, etc.).

## Step 3 — Pick what to consume

```
Does the user need a library crossbind already prebuilds?
│
├─ Browse ports/ (or https://crossbind.dev packages page) for matches:
│   gdal, openssl, geos, geotiff, proj, sqlite3, tiff, lerc, zstd, jpegturbo,
│   webp, iconv, expat, curl, zlib, spatialite
│
├─ YES → pnpm add @crossbind/port-<name> + matching plugin.
│         Skip to Step 4.
│
└─ NO → User has their own .cpp / a library not yet packaged.
          Two sub-options:
            (a) Inline in their project: write `crossbind.config.js` pointing at
                their src/native/, no separate package needed.
            (b) Publish a reusable port: see docs/playbooks/new-port.md
                (Persona 3).
          Sub-option (a) is most common for "my own code".
```

## Step 4 — Touch the config files

The agent **may** edit the user's bundler config (`vite.config.*`, `next.config.*`, `metro.config.js`, `webpack.config.*`, `wrangler.toml`). Per-framework playbooks specify exactly what changes. Always show the diff before applying when the file isn't trivially blank.

Common touchpoints:

| File | What changes |
|------|--------------|
| `package.json` | + `@crossbind/port-<name>`, + `@crossbind/plugin-<bundler>` |
| `vite.config.*` / `webpack.config.*` / etc. | Add the crossbind plugin to `plugins: []` |
| `crossbind.config.js` *(new)* | Project-level crossbind config (deps to consume, build target) |
| Public env / headers config | COOP/COEP for `mt` builds in production |
| `tsconfig.json` *(if TS)* | No change needed — types ship with each `@crossbind/port-*` |

## Step 5 — Smoke build

After integrating:

```bash
# Install
pnpm install

# Dev (verifies plugin wires up, bundler loads crossbind)
pnpm dev   # or `pnpm start`, framework-dependent

# Production build
pnpm build
```

The framework playbook lists what to look for in the dev/build output (e.g. "you should see `crossbind compiled for browser` in the log", "`/crossbind.wasm` should be served at runtime").

## Validation

- [ ] Framework detected with `high` confidence (or user-confirmed otherwise).
- [ ] Correct plugin installed.
- [ ] Bundler config diff applied and explained to the user.
- [ ] Multithread decision made; if `mt`, COOP/COEP setup documented for the user's deploy target.
- [ ] `pnpm dev` succeeds, the bundle loads `crossbind.js`/`crossbind.wasm` without 404s.
- [ ] `pnpm build` produces artifacts.
- [ ] User can call into a crossbind function from JS (e.g. `await initNative(); Module.someFn(...)` returns expected result).

## Common pitfalls

- **Wrong plugin for the bundler.** Vite ≠ Webpack ≠ Rspack ≠ Rollup. Use the framework playbook to pick.
- **Forgetting COOP/COEP in prod.** Dev works, prod fails silently with "SharedArrayBuffer is not defined". Always tell the user upfront.
- **Mixing `mt` and `st` artifacts.** Once the user picks a runtime, config it consistently. Don't half-migrate.
- **TypeScript in user project, expecting types from crossbind.** Types ship per-package; if a `@crossbind/port-*` lacks `.d.ts`, file an issue.
- **Editing config blindly.** Show the diff. Bundler configs are the user's source of truth — bad edits break their whole app, not just crossbind.
- **Not using filter-detect on monorepos.** If the user's repo has multiple apps, run detection in the right subdir.

## Reference

- Plugin sources: `plugins/{vite,webpack,rollup,react-native,metro}/index.js`
- Reference integrations: `examples/web-*` and `examples/mobile-*`
- Project inspector: `agents/skills/crossbind/scripts/inspect-project.mjs`
- Per-framework playbooks: `docs/playbooks/integration/<framework>.md`
