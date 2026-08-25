# AGENTS.md — @crossbind/plugin-vite

> Vite (and any framework on top of it: Vue, React, Svelte, Solid) integration plugin. Wraps `@crossbind/plugin-rollup` and adds Vite-specific dev/preview server wiring.

## What lives here

- `index.js` — single-file plugin. Returns the Vite plugin array `[rollupCrossbindPlugin, viteCrossbindPlugin]`.

That's it. The package is intentionally thin; logic that's bundler-agnostic lives in `@crossbind/plugin-rollup`.

## Hooks the plugin implements

| Hook | What it does |
|------|--------------|
| `configResolved` | Detects dev vs build (`config.command === 'serve'`); allows reading `state.config.paths.build` |
| `configureServer` | Adds COOP/COEP middleware **+** rewrites `/crossbind.wasm` and `/crossbind.data.txt` to `@fs/...` paths |
| `configurePreviewServer` | Same COOP/COEP middleware (so `pnpm preview` works for multithread) |
| `load('/crossbind.js')` | First request to `/crossbind.js` triggers `createLib + createXCFramework + buildWasm` (mtime-aware via `isSourceNewer`); returns the built loader contents |
| `handleHotUpdate` | On `.h` change → bridge rebuild + buildWasm + full-reload. On `.cpp`/`.c`/`.cxx` change → source rebuild (force, bypassCmake) + buildWasm + full-reload. |

The inner rollup plugin handles `transform('.h')` (turn header into JS bridge) and `buildStart` (`addWatchFile` for native sources).

## Key invariants

- **COOP/COEP set in BOTH dev and preview.** If you're tempted to only set them in `configureServer`, don't — production-build smoke tests need preview to be header-correct too. (Discovered the hard way on `e2e/web-vite-multithread`.)
- **`load('/crossbind.js')` runs `force = isSourceNewer(...)`.** Without this, `pnpm dev` after editing native sources outside of an active dev session would serve stale wasm.
- **`handleHotUpdate` source-path rebuild uses `bypassCmake: true`.** CMake re-config is expensive and unnecessary when only `.cpp`/`.c` changed (header structure unchanged). For `.h` we skip this — bridge layout might shift.
- **`paths.native` glob expansion is array-aware.** `existsSync(array)` was a real bug; the inner rollup plugin iterates entries.

## Common pitfalls

- **Forgetting to forward `headers` to preview server.** Vite's preview server is a separate Express-like middleware chain; without `configurePreviewServer`, multithread sites break in `pnpm preview` even though `pnpm dev` works.
- **Returning a single object instead of an array from the plugin factory.** The factory returns `[rollupCrossbindPlugin(options, bridges), viteCrossbindPluginObject]` — flatten it and Vite registers both.
- **Calling `createLib`/`buildWasm` without `force`-aware logic.** Plugin uses `isSourceNewer` so user edits outside the dev session still get picked up. New code paths that build should follow the same.
- **Touching paths.cli / paths.build absolute strings instead of going through `state.config`.** Plugins import from `crossbind`; use the public API.

## Validation

Strict gate (touches plugin → consumers):

```bash
pnpm run ci:linux:build && pnpm run e2e:dev && pnpm run e2e:prod
```

Plus smoke-test against the canonical Vite examples and E2E fixtures:

```bash
pnpm --filter=@crossbind/example-web-vue-vite run build
pnpm --filter=@crossbind/example-web-vue-vite exec vite preview &
# then open in browser, verify crossOriginIsolated === true (multithread)
```

Multithread-specific check: `e2e/web-vite-multithread/`.

## Reference

- Inner kernel: `plugins/rollup/index.js`
- Integration recipe: `docs/playbooks/integration/vite.md`
- Canonical examples and fixtures: `examples/web-{vue,react,svelte}-vite`, `e2e/web-vite{,-multithread}`
