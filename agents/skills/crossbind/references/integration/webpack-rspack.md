<!-- GENERATED from docs/playbooks/integration/webpack-rspack.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Integration — Webpack / Rspack

> Persona 2 sub-playbook. The user's project uses Webpack or Rspack (`webpack` / `@rspack/core` in deps; `webpack.config.*` or `rspack.config.*` at root).

> `crossbind()` serves **both** Webpack and Rspack: each calls a plugin's `apply(compiler)` first, and crossbind's webpack integration answers either.

## Goal

Put `crossbind()` into the bundler's plugins so the dev server serves wasm with COOP/COEP, headers and `.rs` files become modules (plus `cargo:` crate imports, `conan:` header imports and bare Rust package imports), and a production build emits `crossbind.js` + `crossbind.wasm` artifacts.

## When to use

- `webpack`, `webpack-cli` in deps, OR
- `@rspack/core`, `@rspack/cli` in deps.
- Config file at root: `webpack.config.{js,mjs,cjs,ts}` or `rspack.config.{js,mjs,ts}`.

## Files involved

- `package.json`: add `crossbind` (devDependency), optional `@crossbind/port-<name>`.
- `webpack.config.*` / `rspack.config.*`: `crossbind()` in `plugins`.
- `crossbind.config.js` *(new at root)*: Project-level crossbind config.
- `src/native/` *(only if user wraps own C++)*: `.h` + `.cpp` source files.
- Production headers config: Hosting layer (only for multithread).

## Commands

```bash
pnpm add -D crossbind@beta
pnpm add @crossbind/port-<name>@beta     # optional, for prebuilt libraries

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
import crossbind from 'crossbind';

export default defineConfig({
    entry: { main: './src/main.jsx' },
    module: {
        rules: [
            // ... the app's own rules
        ],
    },
    plugins: [
        crossbind(),
    ],
});
```

What `crossbind()` adds as the compiler applies it:

- The rule for headers and `.rs` files, whose loader makes their modules.
- The dev server's `headers` (COOP/COEP) and, in front of the app's own, the middleware that links and serves `/crossbind.js`, `/crossbind.wasm` and `/crossbind.data.txt`, with a reload after a change under `paths.native`.
- The runtime loads from `output.publicPath` as webpack resolves it, `auto` included, so an app served from `/app/` finds it there.

For Webpack (CommonJS-style):

```js
const crossbind = require('crossbind');

module.exports = {
    // …same shape as the Rspack example
    plugins: [crossbind()],
};
```

## Customizing devServer

A `devServer` block of the project's own stays as it is: crossbind adds its headers to the project's and puts its middleware in front of those the project's `setupMiddlewares` gives.

```js
export default defineConfig({
    // …
    plugins: [crossbind()],
    devServer: {
        port: 4000,
        proxy: [...],
        headers: { 'X-Custom': 'value' },
    },
});
```

Key headers are `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. A project header of either name takes the place of crossbind's.

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

- **A rule of the project's own for `.h` files.** `crossbind()` adds the rule; another would hand headers to Babel or SWC, which cannot parse C.
- **Overriding COOP/COEP with other values** in the project's `devServer.headers`. A multithreaded build needs `same-origin` and `require-corp`.
- **TurboPack / Next 13+ App Router.** This playbook is for plain Webpack/Rspack. For Next, see `docs/playbooks/integration/nextjs.md`.

## Reference examples

- `examples/web-react-rspack/` — React + Rspack, canonical
- `e2e/web-rspack/` — React + Rspack + GDAL/CURL playground

Plugin and loader source: `extensions/webpack/src/`.
