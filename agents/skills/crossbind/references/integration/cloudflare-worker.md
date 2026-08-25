<!-- GENERATED from docs/playbooks/integration/cloudflare-worker.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Integration — Cloudflare Worker (edge runtime)

> Persona 2 sub-playbook. The user's project is a Cloudflare Worker (or another edge runtime that follows the Workers compatibility model). Detection: `wrangler` in deps, `wrangler.{toml,jsonc,json}` at root.

## Goal

Compile crossbind for the **edge** runtime so it loads inside a Worker (limited Node API surface, no DOM, no Workers' own `WebAssembly.compileStreaming` quirks). Wrangler dev + deploy ship the wasm + js loader as Worker assets.

## When to use

- `wrangler` in deps.
- `wrangler.toml` (or `.jsonc` / `.json`) at root with `main = "<entry.js>"`.
- Single-thread only: edge runtimes do not provide SharedArrayBuffer / Worker threads. **Always use `runtime: 'st'`.**

## Files involved

| File | Role |
|------|------|
| `package.json` | + `crossbind`; `wrangler` already present |
| `crossbind.config.{js,mjs}` *(new at root)* | Project-level crossbind config |
| `wrangler.toml` | Already present; ensure `main` points at the user's entry |
| `<entry>.js` (e.g. `index.js`) | Imports the crossbind loader, exports a Worker handler |
| `dist/<name>.edge.{js,wasm}` | Build output, shipped by Wrangler |

## Commands

```bash
pnpm add -D crossbind
pnpm add @crossbind/port-<name>     # optional

# Build (target: edge)
pnpm crossbind build -p wasm -a wasm32 -r st -e edge -b release

# Dev
pnpm wrangler dev

# Deploy
pnpm wrangler deploy
```

The build produces `dist/<name>.edge.js` + `dist/<name>.edge.wasm`. Wrangler bundles them as Worker assets.

## Reference setup

Mirror `examples/cloud-cloudflare-worker/`.

`package.json` scripts (canonical):

```jsonc
{
  "scripts": {
    "build": "crossbind build -p wasm -a wasm32 -r st -e edge -b release",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  }
}
```

`wrangler.toml` (minimal):

```toml
name = "my-worker"
main = "index.js"
compatibility_date = "2024-09-08"
```

`crossbind.config.mjs`:

```js
export default {
    general: { name: 'my-worker' },
    paths: {
        config: import.meta.url,
    },
};
```

Worker entry `index.js`:

```js
import initNative from './dist/my-worker.edge.js';

let crossbindPromise;

export default {
    async fetch(request) {
        crossbindPromise ??= initNative();
        const Module = await crossbindPromise;
        const result = Module.someFn();
        return new Response(JSON.stringify({ result }), {
            headers: { 'content-type': 'application/json' },
        });
    },
};
```

Init lazily (`??=`) so the wasm compiles once per isolate, not per request.

## Wasm asset wiring

crossbind's edge build uses `instantiateWasm` with the wasm bytes, **not** `fetch()` — Workers don't have arbitrary `fetch()` for local files. The build embeds the wasm via the bundler's import resolution. If you see "wasm not found", confirm:

- Wrangler's compatibility flags include `nodejs_compat` only if the user's code needs it; crossbind itself does not require it for `-e edge`.
- Wrangler's `rules` (or `[[rules]]` in `.toml`) include a binding for `*.wasm` if you import wasm explicitly elsewhere.

## Multithread

**Not supported** in edge runtimes. SharedArrayBuffer is unavailable; Workers don't expose Web Workers / pthreads. Always build with `-r st`.

If the user insists on multithread, route them to a Node backend (`docs/playbooks/integration/nodejs.md`) or browser app (`docs/playbooks/integration/vite.md`).

## Validation

- [ ] `pnpm install` succeeds.
- [ ] `pnpm build` produces `dist/<name>.edge.js` + `dist/<name>.edge.wasm`.
- [ ] `pnpm wrangler dev` starts; `curl http://localhost:8787` returns the expected response (calls into C++).
- [ ] `pnpm wrangler deploy` ships to Cloudflare without "module not found" errors.
- [ ] Cold-start cost is acceptable (typical: 50-300ms for small wasm; benchmark in production).

## Common pitfalls

- **Targeting `-e node` or `-e browser` instead of `-e edge`.** Workers reject Node-only APIs (`fs`, `process`, etc.) that the node bundle relies on; the edge bundle is trimmed for Workers compat.
- **Trying multithread (`-r mt`).** Won't work. Drop to `-r st`.
- **Loading wasm at module top-level via `await`.** Some Workers configurations do allow top-level await but cold-start blows up. Lazy init in `fetch` handler is safer.
- **Wrangler `compatibility_date` too old.** Some crossbind features (BigInt64, async iterators) require recent runtime. Use `2024-09-08` or newer.
- **CPU time limits.** Free-tier Workers cap CPU at 10ms — large wasm computations may need paid tier or an alternative (Cloudflare Containers, Durable Objects).
- **Missing Wrangler `assets` config** when bundling `*.wasm`. crossbind's loader handles this internally for the standard layout; don't double-declare wasm bindings unless you import wasm elsewhere.

## Reference examples

- `examples/cloud-cloudflare-worker/` — canonical Worker reference
- `e2e/cloud-cloudflare-worker/` — bigger demo with more packages

Edge runtime adapter: `core/crossbind/src/assets/js-runtime/edge.js`.
