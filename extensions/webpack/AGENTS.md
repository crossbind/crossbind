# AGENTS.md — @crossbind/extension-webpack

> Webpack **and Rspack** integration extension. One integration serves both: each calls a plugin's `apply(compiler)` first, and `crossbind()` stands for this plugin from then on.

## What lives here

- `crossbind.extension.js` — the descriptor: contract 5, an `integration` with `calls: ['apply']`, which claims an `apply` whose argument has `hooks` and `options`, a compiler.
- `src/plugin.js` — `webpackPlugin(api)`, the plugin itself. `apply(compiler)` adds all of crossbind's part: the loader's rule, the request rewrites and the dev server's options.
- `src/loader.cjs` — the loader for headers and `.rs` files, which gets the api in the rule's options.

## What `apply` adds

| Where | What it does |
|-------|--------------|
| `module.rules` | A rule whose `test` asks `api.kindOf` (a header or a Rust file), once the api is ready, with the loader |
| `NormalModuleReplacementPlugin(/./)` | A `cargo:` import and a dependency's header become their files (`api.resolve`), and a Rust package's name its crate root (`api.rustPackages`) |
| `beforeRun`, `watchRun` | `api.ready()`, then `api.prepare` for the mode's target |
| `afterCompile` | Adds `api.nativeDirs()` to `compilation.contextDependencies`, so watch mode picks up `.cpp`/`.h` edits |
| `done` | `api.link` (mtime-aware via `isSourceNewer`); in production `api.writeOutputs` copies the files beside webpack's output |
| `devServer` | COOP/COEP `headers` under the project's own, `hot` and `liveReload` unless the project sets them, and `setupMiddlewares` with crossbind's middleware in front; once ready, the server's `watchFiles(api.nativeDirs())` reloads the page after a native change |

The middleware, `api.serve(debug, { isolate: true })`, answers `/crossbind.js`, `/crossbind.wasm` and `/crossbind.data.txt` under webpack's public path from the build directory, waiting for a link in flight.

webpack-dev-server 6 is a plugin webpack-cli 7 makes from the raw `devServer` before any plugin runs, so the plugin finds it in `compiler.options.plugins` by its `getFreePort` static and edits its `options` too.

## The api's timing

`apply` is synchronous, and the tool loaded its config without waiting for crossbind's state, so `apply` reads nothing of the api: it registers what reads it. The rule's `test` and the replacement callback do nothing until `beforeRun` or `watchRun` has awaited `api.ready()`, which comes before any module resolves.

## Common pitfalls

- **Reading the api in `apply`.** It throws before `api.ready()`; register hooks there and read the api inside them.
- **A rule of the app's own for `.h` files.** Babel or SWC would take headers; the plugin's rule is the one.
- **Adding `console.log` for debugging.** Plugin output should be quiet by default.

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

If you touch the dev-server part, also test:

```bash
pnpm --filter=@crossbind/example-web-react-rspack exec rspack serve
# verify in browser: COOP/COEP headers present, /crossbind.wasm 200
```

A plain webpack 5 build through `crossbind()` runs in `core/crossbind/test/bundlerRuns.test.js`.

## Reference

- Integration recipe: `docs/playbooks/integration/webpack-rspack.md`
- Next.js variant (no devServer): `docs/playbooks/integration/nextjs.md`
- Canonical example and fixture: `examples/web-react-rspack`, `e2e/web-rspack`
- The contract: `docs/api/extensions.md` "Integrations"
