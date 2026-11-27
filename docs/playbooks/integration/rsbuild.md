# Integration — Rsbuild

> Persona 2 sub-playbook. The user's project builds with Rsbuild. Detection: `@rsbuild/core` in deps,
> `rsbuild.config.{js,mjs,ts}` at root.

## Goal

Add `crossbind()` to an Rsbuild config so:

- Header and `.rs` imports become modules in every web environment.
- `rsbuild build` puts `crossbind.js` and `crossbind.wasm` beside the build.
- `rsbuild dev` serves the glue, links it again after a C++ change and sends COOP/COEP; `rsbuild preview` sends them too.

## When to use

- Rsbuild 2 (`@rsbuild/core` 2.x), with any of its framework plugins: React, Vue, Svelte and the rest.
- Not Rspack on its own: that is `docs/playbooks/integration/webpack-rspack.md`.

## Files involved

| File | Role |
|------|------|
| `package.json` | + `crossbind` (devDependency), optional `@crossbind/port-<name>` |
| `rsbuild.config.{js,mjs,ts}` | `crossbind()` in `plugins` |
| `crossbind.config.js` *(new at root)* | Project-level crossbind config |
| `src/native/` *(only if the user wraps own C++)* | `.h` + `.cpp` source |

## Commands

```bash
pnpm add -D crossbind@beta
pnpm add @crossbind/port-<name>@beta     # optional

pnpm rsbuild dev
pnpm rsbuild build && pnpm rsbuild preview
```

## Reference config

```js
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import crossbind from 'crossbind';

export default defineConfig({
    plugins: [pluginReact(), crossbind()],
});
```

`crossbind()` goes in Rsbuild's `plugins`, not in `tools.rspack`: from there it adds crossbind's Rspack part to each web
environment and gives Rsbuild's own server what the page needs.

## Multithread → COOP/COEP

The dev and preview servers send them. In production the host must; see `docs/playbooks/integration/vite.md`
"Multithread → production headers" for the hosts.

## Validation

- [ ] `pnpm rsbuild dev`: the page's C++ call returns, with no 404 on `/crossbind.js` or `/crossbind.wasm`.
- [ ] `pnpm rsbuild build`: `dist/` holds `crossbind.js` and `crossbind.wasm`.
- [ ] `pnpm rsbuild preview`: the same page works from the build.

## Common pitfalls

- **`crossbind()` in `tools.rspack.plugins`.** It builds there, as webpack's integration, but Rsbuild's server gets
  neither the glue's middleware nor the headers: put it in `plugins`.
- **A server environment.** crossbind adds its part to web environments only; the C++ runs in the browser.

## Reference

- Extension: `extensions/rsbuild/` (its README and AGENTS.md).
- The e2e project: `e2e/web-rsbuild/`.
