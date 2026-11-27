# AGENTS.md — @crossbind/extension-next

> Next.js integration extension, for Next 16 and later, under Turbopack (its default) and webpack. Next has no plugin
> list, so the app writes `crossbind(nextConfig)`, and this extension's integration `wraps` it.

## What lives here

- `crossbind.extension.js` — the descriptor: contract 5, an `integration` whose `wraps` takes an object or function
  config while Next's CLI runs (`NEXT_RUNTIME` is set before Next loads its config), and whose `wrap` is `src/wrap.js`.
- `src/wrap.js` — returns the config Next calls with its phase (`config(phase, { defaultConfig })`, awaited).
- `src/loader.cjs` — the loader for headers and `.rs` files under both bundlers.

## What the wrapped config adds

| Where | What it does |
|-------|--------------|
| `turbopack.rules` | `*.h`, `*.i`, `*.rs` (and the config's own extensions) through the loader, `as: '*.js'` |
| `turbopack.resolveAlias` | Each `cargo:` import, dependency header and Rust package the app's sources name, to its file, relative to the project |
| `webpack(config, context)` | The same loader in `module.rules`, and a `NormalModuleReplacementPlugin` that replaces named imports as they come |
| `rewrites` (dev only) | `/_crossbind/:file` to crossbind's own server, which links and serves the debug glue as the page asks |
| `headers` (mt only) | COOP/COEP on every route |
| `compiler.runAfterProductionCompile` | The release link (`allBridges`), and the glue into `<distDir>/static/crossbind/` |

## Why it is shaped so

- **Turbopack's loaders run in processes of their own**, with options that are plain JSON: the loader makes an api from
  `api.workerModule`, as Metro's transformer does. Turbopack waits 5 minutes for a loader's answer, so the loader only
  transforms; a slow first header in each process (the import scan) once made it time out.
- **Turbopack has no resolver hook**: the aliases are read from `api.appImports()` as Next loads the config, so a new
  named import needs a restart under `next dev`, and an import in a comment names nothing. webpack reads `cargo:` and
  `conan:` as URL schemes before any alias, which is why its hook replaces requests instead.
- **The glue is at the module's base, not webpack's public path** (`transform(…, { atBase: true })`): Next serves only
  its chunks under `/_next/`, and the static files under `/_next/static`.
- **Links run after transforms**: a loader that linked while other loader processes still wrote `cargo:` bridge crates
  built a broken super-crate. `next dev` links on the glue's request instead, and `next build` after its compile.
- **The release target binds and resolves in either phase**: a port ships release prebuilts, which a debug link reads.

## Validation

```bash
pnpm --filter crossbind test
pnpm --filter @crossbind/e2e-web-next run build && pnpm --filter @crossbind/e2e-web-next run e2e:prod
pnpm --filter @crossbind/e2e-web-next run e2e:dev
```
