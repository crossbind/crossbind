# AGENTS.md — @crossbind/extension-esbuild

> esbuild **and Bun** integration extension. Each calls a plugin's `setup(build)` first, with the build's options in
> `build.initialOptions` (Bun 1.2.22 or later, which has `onEnd`), and `crossbind()` stands for this plugin from then on.

## What lives here

- `crossbind.extension.js` — the descriptor: contract 5, an `integration` with `calls: ['setup']`, which claims a
  `setup` whose argument has `initialOptions` and `onLoad`.
- `src/plugin.js` — `esbuildPlugin(api)`.

## What `setup` does

`setup` awaits `api.ready()` and `api.prepare(release)` before it registers any hook: Bun starts its first build before
an async `setup` settles. Then:

| Hook | What it does |
|------|--------------|
| `onStart` | `api.prepare(release)` again, for a rebuild |
| `onResolve` | A `cargo:` import, a dependency's header and a Rust package's name become their files |
| `onLoad` | Headers, `.i` modules and `.rs` files become modules (`api.transform`), watching the app's sources and the native files |
| `onEnd` | `api.link(release)`, and the glue beside the build's output (`outdir`, or `outfile`'s folder), or where `crossbind.config.js` names |

esbuild refuses a plugin with a key it does not know, which is why the core's `crossbind()` lists only `name` before a
tool's first call.

## Validation

```bash
pnpm --filter crossbind test
pnpm --filter @crossbind/e2e-web-esbuild run build && pnpm --filter @crossbind/e2e-web-esbuild run e2e:prod
```
