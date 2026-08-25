# Integration — Rollup (standalone)

> Persona 2 sub-playbook. The user's project uses Rollup directly (not via Vite). Detection: `rollup` in deps, `rollup.config.{js,mjs,ts}` at root, no `vite`/`webpack`/`@rspack/*`.

> **Most users want the Vite playbook**, not this one. Vite wraps Rollup, and `@crossbind/plugin-rollup` is the inner kernel of `@crossbind/plugin-vite`. Use this playbook only when the project authors a JS library/CLI directly with Rollup (not building an app).

## Goal

Add `@crossbind/plugin-rollup` to a Rollup config so:

- Rollup's `transform` hook handles `.h` files (generates the JS bridge).
- `generateBundle` runs `crossbind build` and emits `crossbind.js` + `crossbind.wasm` as Rollup assets.
- Rollup watch mode rebuilds wasm when native sources change.

## When to use

- Standalone Rollup (no Vite / Webpack / Rspack).
- Library output (`format: 'esm' | 'cjs' | 'umd'`), not an app bundle.
- Rare in app development; common for SDK / CLI authors.

## Files involved

| File | Role |
|------|------|
| `package.json` | + `@crossbind/plugin-rollup` (devDependency), optional `@crossbind/port-<name>` |
| `rollup.config.{js,mjs,ts}` | Add `rollupCrossbindPlugin()` to `plugins` |
| `crossbind.config.js` *(new at root)* | Project-level crossbind config |
| `src/native/` *(only if user wraps own C++)* | `.h` + `.cpp` source |

## Commands

```bash
pnpm add -D @crossbind/plugin-rollup
pnpm add @crossbind/port-<name>     # optional

# Build
pnpm rollup -c

# Watch
pnpm rollup -c -w
```

## Reference config

```js
import rollupCrossbindPlugin from '@crossbind/plugin-rollup';

export default {
    input: 'src/index.js',
    output: { file: 'dist/index.js', format: 'esm' },
    plugins: [
        rollupCrossbindPlugin(),
    ],
};
```

What the plugin gives you:

- `resolveId('crossbind')` — externalizes / resolves the crossbind loader to the freshly built file.
- `transform('.h')` — converts header files into JS bridge code (Embind/SWIG output).
- `buildStart` — adds `state.config.paths.native/**` to Rollup's watch list (via `addWatchFile`).
- `generateBundle` — runs `crossbind build` (mtime-aware: skips when artifacts are newer than sources) and emits `crossbind.js`, `crossbind.wasm`, `crossbind.data.txt` as bundle assets.

## No dev server (Rollup only)

Standalone Rollup doesn't have a dev server. If the user needs hot reload, they almost certainly want **Vite** instead. Suggest switching to Vite (which uses Rollup under the hood) for app-style projects:

> If you're building an app (not a library), Vite gives you Rollup + a dev server + COOP/COEP automation — see `docs/playbooks/integration/vite.md`.

## Multithread → COOP/COEP

If the user picks `runtime: 'mt'` in `crossbind.config.js`, the resulting library still needs COOP/COEP headers wherever it runs. Since Rollup just outputs the bundle, **the consuming app** must serve those headers — same matrix as the Vite playbook.

## Validation

- [ ] `pnpm install` succeeds.
- [ ] `pnpm rollup -c` runs without errors.
- [ ] `dist/` contains the user's bundle plus `crossbind.js`, `crossbind.wasm`.
- [ ] Watch mode picks up native source changes (`pnpm rollup -c -w`, edit a `.cpp`, see rebuild log).
- [ ] Library consumer can `import { initNative } from '<the lib>'; await initNative(); Module.fn(...)`.

## Common pitfalls

- **Using rollup standalone when you want an app.** Switch to Vite. Faster, has dev-server, COOP/COEP automation.
- **Missing `paths.native` in `crossbind.config.js`.** Watch list is empty → `.cpp` edits don't trigger rebuild. Default `src/native/` works; override only if you've moved sources.
- **Output format `iife` or `umd` for a library used by Node.** Choose `esm`/`cjs` — the crossbind loader expects standard module semantics.
- **Bundling `crossbind` itself into the library output.** The plugin externalizes `/crossbind.js` so the consumer fetches the actual built script. Don't mark crossbind as bundled.
- **Trying to add a dev-server middleware.** Rollup doesn't have one. Use Vite.

## Reference

- Plugin source: `plugins/rollup/index.js`
- Used as kernel of: `plugins/vite/index.js`
- No standalone Rollup example exists in this repo; `plugins/rollup` is exercised through `plugin-vite` and the Vite examples and fixtures.
