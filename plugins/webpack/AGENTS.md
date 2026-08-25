# AGENTS.md — @crossbind/plugin-webpack

> Webpack **and Rspack** integration plugin. Same package serves both — Rspack reuses the Webpack plugin contract.

## What lives here

- `index.js` — exports `class CrossbindWebpackPlugin`. Single class, no separate kernel.
- Sibling package `@crossbind/plugin-webpack-loader` ships the loader for `.h` files; `getRule()` references it by name.

## Class API surface

```
new CrossbindWebpackPlugin()
  ↓
  .apply(compiler)                   ← webpack standard plugin hook
  .getRule()                         ← module.rules entry for .h
  .getDevServerConfig()              ← devServer block w/ COOP+COEP + middleware
  .getLoaderOptions()                ← escape hatch: crossbind state passed to other rules
  .setDevServerMiddleware(...)        ← internal, called by getDevServerConfig
```

User config consumes all four; see `docs/playbooks/integration/webpack-rspack.md` for the canonical wiring.

## Hooks the plugin registers

| webpack hook | What it does |
|--------------|--------------|
| `compiler.hooks.done` | After every compilation: re-run `createLib + createXCFramework + buildWasm` (mtime-aware via `isSourceNewer`) |
| `compiler.hooks.afterCompile` | Adds `state.config.paths.native` to `compilation.contextDependencies` so webpack watch picks up `.cpp`/`.h` edits |

## DevServer middleware

`getDevServerConfig()` returns:

```js
{
  watchFiles: state.config.paths.native,
  hot: true,
  liveReload: true,
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
  setupMiddlewares: (middlewares, devServer) => { ... }
}
```

The middleware adds `/crossbind.js` and `/crossbind.wasm` routes that pipe the freshly built artifacts. Both routes also re-emit COOP/COEP per-response (belt-and-suspenders for caching layers that strip top-level headers).

## Rspack compatibility

Rspack copies webpack's plugin / loader shape. The plugin works without modification. The Rspack-specific wrinkle: `getRule()` returns a plain object that Rspack's TypeScript-strict config types may complain about — cast to `RspackOptions['module']['rules'][number]` if needed.

## Common pitfalls

- **Forgetting `getRule()` while passing the plugin instance.** The `.h` loader rule and the plugin instance are independent registrations; both are required.
- **Wrapping the plugin's `getDevServerConfig()` and dropping `headers`.** Always spread: `{ ...cppDev, ...custom, headers: { ...cppDev.headers, ...custom.headers } }`.
- **Trying to inject `getRule()` into `plugins:` array** instead of `module.rules:`. They are distinct.
- **Babel/SWC running on `.h` first.** Loader chain order matters; `getRule()` test is `/\.h$/` so other rules with broader tests can swallow it. Make sure no rule for `/\.[jt]sx?$/` accidentally matches `.h` (none do by default).
- **Adding `console.log` for debugging.** Route through `crossbind` exports — `state.config` carries the logger if you need it. Plugin output should be quiet by default.

## Validation

Strict gate:

```bash
pnpm run ci:linux:build && pnpm run e2e:dev && pnpm run e2e:prod
```

Smoke examples and E2E fixtures:

```bash
pnpm --filter=@crossbind/example-web-react-rspack run build
pnpm --filter=@crossbind/e2e-web-rspack run build
```

If you touch the dev-server middleware, also test:

```bash
pnpm --filter=@crossbind/example-web-react-rspack exec rspack serve
# verify in browser: COOP/COEP headers present, /crossbind.wasm 200
```

## Reference

- Loader package: `plugins/webpack-loader/`
- Integration recipe: `docs/playbooks/integration/webpack-rspack.md`
- Next.js variant (no devServer): `docs/playbooks/integration/nextjs.md`
- Canonical example and fixture: `examples/web-react-rspack`, `e2e/web-rspack`
