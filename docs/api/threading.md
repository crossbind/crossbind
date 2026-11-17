# Threading — `runtime: 'st'` vs `'mt'`, `useWorker`, and edge limits

> Two independent choices: **threading** (single- or multithreaded Wasm) and **`useWorker`** (whether the module runs in a Web Worker).
>
> **`useWorker` is on by default in a browser**, wherever `globalThis.Worker` exists, so browser code awaits its calls, construction included. Pass `useWorker: false` to turn it off.

## The two axes

```
                    │ runtime: 'st'        │ runtime: 'mt'
────────────────────┼──────────────────────┼─────────────────────────
useWorker: false    │ Opt-out: main thread │ Wasm runs main-thread,
                    │ Wasm. Smallest setup.│ pthreads via SharedArray-
                    │                      │ Buffer. Needs COOP/COEP.
────────────────────┼──────────────────────┼─────────────────────────
useWorker: true     │ Wasm in 1 Web Worker.│ Wasm in 1 Web Worker;
                    │ Comlink bridge. Main │ pthreads spawn ADDITIONAL
                    │ thread free. Required│ workers from there. Needs
                    │ for OPFS persistence.│ COOP/COEP + Worker support.
```

## When you need each

| You want | Pick |
|----------|------|
| Quickest path to C++ in the browser | `runtime: 'st'`, the defaults |
| Persistent storage in the browser | `runtime: 'mt'` with the default worker, or `st` with `fs: { opfs: true }` |
| CPU-bound parallelism (image / geo / crypto) | `runtime: 'mt'` |
| Both: persistent storage AND parallelism | `runtime: 'mt'`, `useWorker: true` |
| Cloudflare Worker / Deno Deploy / Vercel Edge | `runtime: 'st'` only; no `mt`, no `useWorker` |
| React Native | always `mt` on Android and iOS; no COOP/COEP, except on an Expo app's web build |

## Setting `runtime: 'mt'`

In `crossbind.config.js`:

```js
export default {
  general: { name: 'myapp' },
  paths: { config: import.meta.url },
  target: { runtime: 'mt' },  // ← here
}
```

The Wasm then compiles with `-pthread`. If any dependency is `mt`, the project becomes `mt` too; it cannot go back to `st`.

## The COOP/COEP requirement

Multi-threaded Wasm uses `SharedArrayBuffer`, which browsers gate behind **cross-origin isolation**. Your hosting layer must send these response headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them, `SharedArrayBuffer` is `undefined` and the Wasm init silently fails.

### How to verify (in the browser console)

```js
console.log(crossOriginIsolated)   // must be true for `mt`
console.log(typeof SharedArrayBuffer)  // must be 'function'
```

### Per-host configuration

- **Vite dev server and preview:** `@crossbind/plugin-vite` sends them.
- **Webpack and Rspack dev servers:** `@crossbind/plugin-webpack` sends them.
- **Vercel:** in `vercel.json`, `{ "headers": [{ "source": "/(.*)", "headers": [{ "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }, { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }] }] }`.
- **Netlify:** in `_headers`, `/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp`.
- **Cloudflare Pages:** a `_headers` file, as on Netlify.
- **nginx:** `add_header Cross-Origin-Opener-Policy same-origin; add_header Cross-Origin-Embedder-Policy require-corp;`.
- **Express or a custom Next.js server:** middleware that sets both on every response.

### COEP gotcha

`require-corp` blocks cross-origin resources unless they explicitly opt in (`Cross-Origin-Resource-Policy: cross-origin` on the response, or `crossorigin` attribute on `<img>` / `<script>` tags). If your page loads third-party images / fonts / scripts, you'll either need to:

- Switch to `Cross-Origin-Embedder-Policy: credentialless` (more permissive, supported in Chrome 96+, Firefox 110+).
- Or proxy third-party assets through your own origin.

### Known environment quirk: Playwright's WebKit ships a broken OPFS backend

In Playwright's bundled WebKit, `navigator.storage.getDirectory()` exists but always
rejects with `UnknownError: The operation failed for an unknown transient reason`.
Threads work there, and real Safari works fully, OPFS included. The runtime probes
`getDirectory()` before mounting and falls back to `/memfs` with a logged error, so mt
modules start on all three Playwright engines. If an mt init ever hangs with no error,
suspect a blocked storage backend first: the OPFS API being there does not mean it works.

## `useWorker: true` (independent of threading)

Wasm runs in a single dedicated Web Worker; main thread receives a Comlink-bridged proxy.

```js
const m = await initNative({ useWorker: true })
// m looks identical, but every call is async.
const result = await m.add(2, 3)
```

You want this when:

- You need OPFS persistent storage (mandatory: crossbind's OPFS backend runs on synchronous access handles, which only exist in Worker scope).
- Your C++ is slow and you don't want to block the main thread paint loop.
- You're using `runtime: 'mt'` and want pthread workers spawned from a non-main scope (cleaner architecture).

You don't need it when:

- The C++ is fast (sub-frame) and main-thread blocking doesn't matter.
- You're already using `mt` for parallelism (pthread workers are separate from `useWorker`).

### What changes when `useWorker: true`

| Aspect | Without worker | With worker |
|--------|----------------|-------------|
| `m.add(2, 3)` returns | `5` | `Promise<5>` |
| `m.FS.writeFile(...)` returns | `undefined` | `Promise<undefined>` |
| Synchronous callbacks | Work | Don't work — use returned promises |
| OPFS storage | Throws | Works (if browser supports) |
| Termination | n/a | `initNative.terminate()` kills the worker |

Bound objects such as vectors and structs are proxied too; `m.toArray(vec)` and `m.toVector(cls, arr)` work as on the page thread.

## Edge runtime limits (Cloudflare Workers, Deno Deploy, Vercel Edge)

These platforms run JavaScript in V8 isolates that **don't expose the Web Worker API**. Therefore:

- ❌ `useWorker: true` — fails (no Worker constructor).
- ❌ `runtime: 'mt'` — fails (pthreads need workers + SharedArrayBuffer).
- ❌ OPFS — fails (browser-only API anyway).
- ✅ `runtime: 'st'` + memory fs — works.

For persistence on the edge, use an external store such as R2, KV or S3: call it from JavaScript and pass the bytes in with `m.FS.writeFile(...)`.

## React Native

Android and iOS builds are always `mt`, with the device's own threads through JSI: no `SharedArrayBuffer`, no COOP/COEP. `useWorker` does not apply.

An Expo app that also runs on the web gets the same `runtime` on its web build, which is a browser build: with `mt` it needs COOP/COEP there (`docs/playbooks/integration/react-native-expo.md`).

## Common pitfalls

1. **`mt` works in dev but not in prod.** The dev server and preview send COOP/COEP; a production host has to be set up to. If `crossOriginIsolated` is `false` in the console, the headers are missing.
2. **Mixing `mt` and `st` artifacts in one bundle** — they have incompatible memory layouts. The CLI prevents this at build time but if you manually copy `.wasm` files between projects, you'll see "wasm streaming compile failed" errors.
3. **Calling sync callbacks across `useWorker: true`** — Comlink can't invoke main-thread sync code from worker. If your C++ needs a JS callback, design it as a promise round-trip.
4. **Assuming `runtime: 'mt'` enables `useWorker`** — they're independent. `runtime: 'mt'` without `useWorker` runs pthreads on the main thread; `useWorker: true` without `runtime: 'mt'` runs single-thread Wasm in a worker.
5. **Loading third-party scripts on a COEP page** — `require-corp` blocks them unless they send `Cross-Origin-Resource-Policy: cross-origin`. Switch to `credentialless` or proxy.

## See also

- [`init.md`](./init.md) — `useWorker`, `runtime` (via `crossbind.config.js`), `getWasmFunction`.
- [`crossbind-config.md`](./crossbind-config.md) — `target.runtime: 'st' | 'mt'`.
- [`filesystem.md`](./filesystem.md) — why OPFS depends on `useWorker`.
- `docs/playbooks/integration/*.md` — per-framework COOP/COEP setup.
