<!-- GENERATED from docs/playbooks/integration/vite.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Integration — Vite

> Persona 2 sub-playbook. The user's project uses Vite (`vite` in deps, `vite.config.{js,mjs,ts}` at root).

## Goal

Add crossbind to a Vite project so:

- WASM modules load via `pnpm dev` and `pnpm build` without 404s.
- `pnpm preview` serves the production build with COOP/COEP headers (multithread works locally).
- HMR rebuilds wasm when the user edits `.h`/`.cpp`/`.rs` files.

## When to use

- `vite` is in `dependencies` or `devDependencies`.
- A `vite.config.{js,mjs,cjs,ts}` exists at the project root.
- Framework on top of Vite: Vue, React, Svelte, SolidJS, Preact — all handled the same way.

## Files involved

| File | Role |
|------|------|
| `package.json` | + `@crossbind/plugin-vite` (devDependency), optional `@crossbind/port-<name>` |
| `vite.config.{js,ts}` | Add `viteCrossbindPlugin()` to the `plugins` array |
| `crossbind.config.js` *(new at project root)* | Project-level crossbind config: deps to consume, build target |
| `src/native/` *(only if user wraps own C++)* | `.h` + `.cpp` source files (default location) |
| Production headers config | Hosting-specific (Vercel `vercel.json`, Netlify `_headers`, nginx, …) — only for multithread builds |

## Commands

```bash
# Install
pnpm add -D @crossbind/plugin-vite
# Plus any prebuilt package the user wants to consume:
pnpm add @crossbind/port-<name>

# Dev (HMR rebuilds wasm; COOP/COEP set automatically)
pnpm dev

# Production build
pnpm build

# Local preview of the production build (still gets COOP/COEP headers)
pnpm preview
```

## Reference config

Mirror `examples/web-vue-vite/vite.config.js` (canonical):

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';                  // or react / svelte / solid
import viteCrossbindPlugin from '@crossbind/plugin-vite';

export default defineConfig({
    plugins: [
        vue(),
        viteCrossbindPlugin(),
    ],
});
```

The plugin handles:

- Setting `Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy` in **dev** AND **preview** server (multithread WASM works without manual server config).
- Watching native source files (`paths.native`, default `src/native/`) — saving a `.cpp`/`.h`/`.rs` triggers a rebuild + HMR.
- Routing `/crossbind.js`, `/crossbind.wasm`, `/crossbind.data.txt` to the freshly built artifacts.

`crossbind.config.js` at project root (only needed if wrapping own C++):

```js
export default {
    general: { name: 'my-app' },
    target: { runtime: 'mt' },   // omit for single-thread default
};
```

## Multithread → production headers

Dev/preview is handled by the plugin. **Production deploys are not.** The user's hosting layer must send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Recipe per host:

| Host | File / setting |
|------|----------------|
| Vercel | `vercel.json` → `headers` array with both keys |
| Netlify | `public/_headers` → `/*` block with both keys |
| Cloudflare Pages | `public/_headers` (same syntax as Netlify) |
| nginx | `add_header Cross-Origin-... always;` in the relevant `location` |
| Static host (S3 + CDN) | CDN's response header rules |
| Local `serve` | `serve.json` with `headers` array (see `examples/web-vue-vite/serve.json`) |

If the user picks `runtime: 'st'` (single-thread), none of this applies — no headers needed.

## Validation

- [ ] `pnpm install` succeeds.
- [ ] `pnpm dev` starts; opening the page shows no 404s for `/crossbind.js`, `/crossbind.wasm`, `/crossbind.data.txt` in DevTools Network tab.
- [ ] Console log shows the crossbind loader initializing (`wasm compiled for browser…` in dev terminal).
- [ ] User-side: `await initNative(); Module.someFn(...)` returns expected result.
- [ ] `pnpm build` produces `dist/` with the wasm + js artifacts.
- [ ] `pnpm preview` serves the build; multithread features still work (verify `crossOriginIsolated === true` in console).
- [ ] If multithread, production headers config exists for the target host.

## Common pitfalls

- **Setting COOP/COEP manually on top of the plugin.** Plugin already does this in dev/preview. Don't add another layer; you'll just confuse the next person reading the config.
- **Editing `vite.config` to inline crossbind paths.** Don't. The plugin resolves paths via `crossbind.config.js`. Touch that file instead.
- **Forgetting production headers** on hosts other than `vercel`/`netlify` (which the plugin doesn't touch). Multithread works in `pnpm preview` but breaks in production with no error in the build output.
- **Mismatched runtime.** If `crossbind.config.js` says `runtime: 'st'` but the user expected threading, threads won't run. Check both.
- **`pnpm dev` shows `crossbind build` errors but page loads.** The plugin reports build failures via the dev server overlay; if the page loads anyway, it's a stale cached artifact. Run `pnpm --filter=<example-name> run build` once explicitly to surface the error.
- **HMR doesn't rebuild after `.cpp` edit.** Check `paths.native` in the project's `crossbind.config.js`. Default `src/native/` works; if the user moved C++ files elsewhere, point at the new location.

## Reference examples

- `examples/web-vue-vite/` — Vue 3 + Vite, simplest reference
- `examples/web-react-vite/` — React + Vite
- `examples/web-svelte-vite/` — Svelte + Vite
- `e2e/web-vite/` — Vue + GDAL playground
- `e2e/web-vite-multithread/` — Vue + multithread + 13 packages (canonical for `runtime: 'mt'`)

Plugin source: `plugins/vite/index.js`.
