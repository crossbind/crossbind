# AGENTS.md — @crossbind/extension-rsbuild

> Rsbuild integration extension, for Rsbuild 2. Rsbuild calls a plugin's `apply(config, { action })` before its
> `setup(api)` when `apply` is a function, and `crossbind()` has one, so the integration claims that call, and `setup`
> with Rsbuild's api for a run without an action.

## What lives here

- `crossbind.extension.js` — the descriptor: contract 5, an `integration` with `calls: ['apply', 'setup']`.
- `src/plugin.js` — `rsbuildPlugin(api)`, whose `apply` answers true for each action.

## What `setup` adds

| Where | What it does |
|-------|--------------|
| `modifyRspackConfig` | For a web environment, crossbind's webpack plugin (`@crossbind/extension-webpack/plugin`), which builds the page on Rspack |
| `server.headers` | COOP/COEP, on the dev and preview servers |
| `server.setup` (dev) | The middleware that links and serves the debug glue, `api.serve(debug, { isolate: true })`, in front of Rsbuild's own |
| `dev.watchFiles` | `api.nativeDirs()`, reloading the page after a native source changes |

The webpack plugin's `devServer` part is for webpack-dev-server, which Rsbuild's server is not: it reads none of it.

## Validation

```bash
pnpm --filter crossbind test
pnpm --filter @crossbind/e2e-web-rsbuild run build && pnpm --filter @crossbind/e2e-web-rsbuild run e2e:prod
pnpm --filter @crossbind/e2e-web-rsbuild run e2e:dev
```
