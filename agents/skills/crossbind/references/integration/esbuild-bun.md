<!-- GENERATED from docs/playbooks/integration/esbuild-bun.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Integration — esbuild and Bun

> Persona 2 sub-playbook. The user's project builds with esbuild's JS API or with `Bun.build`. Detection: `esbuild` in
> deps with no Vite, webpack, Rspack, Rsbuild or Rollup, or `@types/bun` / `bun-types` with `bun.lock` or `bunfig.toml`.

## Goal

Add `crossbind()` to the build's `plugins` so:

- Header and `.rs` imports become modules, and a `cargo:` import or a dependency's header resolves to its file.
- Each build puts `crossbind.js` and `crossbind.wasm` beside its output.

## When to use

- esbuild 0.17 or later through its JS API (`esbuild.build`, `esbuild.context`), with `bundle: true`.
- Bun 1.2.22 or later through `Bun.build`.
- Not esbuild's command line alone: a plugin needs the JS API.

## Files involved

| File | Role |
|------|------|
| `package.json` | + `crossbind` (devDependency), optional `@crossbind/port-<name>` |
| `build.mjs`, or the project's build script | `crossbind()` in `plugins` |
| `crossbind.config.js` *(new at root)* | Project-level crossbind config |
| `src/native/` *(only if the user wraps own C++)* | `.h` + `.cpp` source |

## Reference build scripts

```js
// build.mjs, with esbuild
import * as esbuild from 'esbuild';
import crossbind from 'crossbind';

await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', outdir: 'dist', plugins: [crossbind()] });
```

```js
// build.mjs, run with bun
import crossbind from 'crossbind';

const result = await Bun.build({ entrypoints: ['./src/main.js'], outdir: './dist', plugins: [crossbind()] });
if (!result.success) process.exit(1);
```

The page loads the glue from the build's `publicPath`, or from the root: set `publicPath` when `outdir` is served from a
subfolder.

## Multithread → COOP/COEP

esbuild's `serve` sends no headers of the app's, so a multithreaded page needs another server in dev, any static server
that sends the two (`serve` with a `serve.json`, for one), and the host's headers in production: see
`docs/playbooks/integration/vite.md` "Multithread → production headers".

## Validation

- [ ] The build exits 0, and `dist/` holds the bundle, `crossbind.js` and `crossbind.wasm`.
- [ ] Served with the page's `index.html`, the C++ call returns.

## Common pitfalls

- **`bundle: false`.** esbuild leaves the header import as it is, and the browser cannot load a header.
- **Bun before 1.2.22.** The plugin links in `onEnd`, which Bun added in 1.2.22: an older Bun stops the build.
- **A rebuild in watch mode after a C++ edit.** `context.watch()` rebuilds and relinks; reload the page for the new wasm.

## Reference

- Extension: `extensions/esbuild/` (its README and AGENTS.md).
- The e2e project: `e2e/web-esbuild/`, one page built with both.
