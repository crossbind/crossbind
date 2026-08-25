<!-- GENERATED from docs/playbooks/integration/webpack-rspack.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Integration — Webpack / Rspack

> Persona 2 sub-playbook. The user's project uses Webpack or Rspack (`webpack` / `@rspack/core` in deps; `webpack.config.*` or `rspack.config.*` at root).

> The same `@crossbind/plugin-webpack` package supports **both** Webpack and Rspack — Rspack reuses the Webpack plugin API surface.

## Goal

Wire `@crossbind/plugin-webpack` into the bundler config so dev-server serves wasm with COOP/COEP, the loader handles `.h` and `.rs` files (plus `cargo:` crate imports and bare Rust package imports), and prod build emits `crossbind.js` + `crossbind.wasm` artifacts.

## When to use

- `webpack`, `webpack-cli` in deps, OR
- `@rspack/core`, `@rspack/cli` in deps.
- Config file at root: `webpack.config.{js,mjs,cjs,ts}` or `rspack.config.{js,mjs,ts}`.

## Files involved

| File | Role |
|------|------|
| `package.json` | + `@crossbind/plugin-webpack`, `@crossbind/plugin-webpack-loader` (devDependencies), optional `@crossbind/port-<name>` |
| `webpack.config.*` / `rspack.config.*` | Construct plugin, register loader rule, plug `devServer` config |
| `crossbind.config.js` *(new at root)* | Project-level crossbind config |
| `src/native/` *(only if user wraps own C++)* | `.h` + `.cpp` source files |
| Production headers config | Hosting layer (only for multithread) |

## Commands

```bash
pnpm add -D @crossbind/plugin-webpack @crossbind/plugin-webpack-loader
pnpm add @crossbind/port-<name>     # optional, for prebuilt libraries

# Dev (Rspack)
pnpm dev    # or `pnpm rspack serve`
# Dev (Webpack)
pnpm dev    # or `pnpm webpack serve`

# Production
pnpm build
```

## Reference config

Mirror `examples/web-react-rspack/rspack.config.mjs` (canonical for Rspack; Webpack identical except imports):

```js
import { defineConfig } from '@rspack/cli';
import CrossbindWebpackPlugin from '@crossbind/plugin-webpack';

const crossbindWebpackPlugin = new CrossbindWebpackPlugin();

export default defineConfig({
    entry: { main: './src/main.jsx' },
    module: {
        rules: [
            crossbindWebpackPlugin.getRule(),    // .h loader, hands work to plugin-webpack-loader
            // ... other rules
        ],
    },
    plugins: [
        crossbindWebpackPlugin,                  // register the plugin
    ],
    devServer: crossbindWebpackPlugin.getDevServerConfig(),  // COOP/COEP + middleware
});
```

What the plugin gives you:

- `getRule()` — webpack module rule for `.h` files (delegates to `@crossbind/plugin-webpack-loader`).
- `getDevServerConfig()` — devServer config with `headers` (COOP/COEP) and middleware that serves `/crossbind.js`, `/crossbind.wasm`, `/crossbind.data.txt` from the build output.
- `getLoaderOptions()` — escape hatch when you need crossbind state inside the config (target filtering, etc.).

For Webpack (CommonJS-style):

```js
const CrossbindWebpackPlugin = require('@crossbind/plugin-webpack').default;
const crossbindWebpackPlugin = new CrossbindWebpackPlugin();

module.exports = {
    // …same shape as the Rspack example
};
```

## Customizing devServer

If the project already has a `devServer` block, **merge** with `getDevServerConfig()`:

```js
const cppDev = crossbindWebpackPlugin.getDevServerConfig();
export default defineConfig({
    // …
    devServer: {
        ...cppDev,
        port: 4000,
        proxy: [...],
        headers: { ...cppDev.headers, 'X-Custom': 'value' },
    },
});
```

Key headers are `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Don't drop them.

## Multithread → production headers

Same as the Vite playbook — devServer is handled by the plugin, production deploy is the user's hosting layer's responsibility. See `docs/playbooks/integration/vite.md` "Multithread → production headers" table for per-host recipes.

## Validation

- [ ] `pnpm install` succeeds.
- [ ] Dev server starts, page loads with no 404 on `/crossbind.js`, `/crossbind.wasm`.
- [ ] Browser console: `crossOriginIsolated` returns `true` (only required if multithread).
- [ ] Saving a `.cpp`/`.h` file under `src/native/` triggers a rebuild + page refresh.
- [ ] `pnpm build` produces `dist/` with `crossbind.js`, `crossbind.wasm` (and `crossbind.data.txt` if data preloaded).
- [ ] User-side: `await initNative(); Module.someFn(...)` returns expected result.

## Common pitfalls

- **Missing `@crossbind/plugin-webpack-loader`.** The plugin's `getRule()` references a loader by package name; if it's not installed, webpack throws "Module not found".
- **Forgetting `crossbindWebpackPlugin.getRule()`.** Plugin alone isn't enough — `.h` files need the loader rule too. Register both.
- **Dropping plugin's `headers`** when merging custom devServer config. Use spread: `{ ...cppDev.headers, ...custom }`.
- **Babel/SWC ahead of crossbind loader.** The loader chain matters. `getRule()` returns a `test: /\.h$/` rule; place it among other rules (order doesn't matter — webpack picks per-test). Don't wrap `.h` in a babel/swc rule.
- **Trying to use `getRule()` outside `module.rules`** (e.g. inside `plugins`). It's a rule, not a plugin instance. Plugin instance also goes in `plugins:` array.
- **TurboPack / Next 13+ App Router.** This playbook is for plain Webpack/Rspack. For Next, see `docs/playbooks/integration/nextjs.md`.

## Reference examples

- `examples/web-react-rspack/` — React + Rspack, canonical
- `e2e/web-rspack/` — React + Rspack + GDAL/CURL playground

Plugin source: `plugins/webpack/index.js`.
Loader source: `plugins/webpack-loader/`.
