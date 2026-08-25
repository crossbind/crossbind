<!-- GENERATED from docs/playbooks/integration/vanilla.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Integration — Vanilla HTML / no bundler

> Persona 2 sub-playbook. The user's project is plain HTML + JavaScript with no bundler. Detection: `index.html` at root (or `public/index.html`), no Vite/Webpack/Rspack/Rollup deps, possibly no `package.json` at all.

## Goal

Build crossbind artifacts for the browser, ship them as static files, and load via plain `<script>` tags. Optional `serve.json` (or hosting config) sets COOP/COEP for multithread.

## When to use

- A static HTML site, demo page, or proof-of-concept.
- The user explicitly wants no bundler (size budget, education, simplicity).
- Hosting is a static file server (S3, GitHub Pages, Netlify, Cloudflare Pages, nginx, `serve`).

## Files involved

| File | Role |
|------|------|
| `package.json` | + `crossbind`, optional `@crossbind/port-<name>`, optional `serve` for local preview. Declare a `build` script that runs `crossbind build -e browser` |
| `crossbind.config.{js,mjs}` *(new at root)* | Project-level crossbind config |
| `index.html` | Loads `<script src="./dist/<name>...browser.js"></script>` and calls `initNative({ path: './dist' })` |
| `src/native/` *(if user wraps own C++)* | `.h` + `.cpp` source |
| `serve.json` *(local preview, optional)* | COOP/COEP headers for `serve` |
| `dist/<name>-<target>.browser.{js,wasm}` | Build output |

## Commands

```bash
pnpm add -D crossbind
pnpm add @crossbind/port-<name>     # optional
pnpm add -D serve                   # optional, for local preview

# Build
pnpm crossbind build -p wasm -a wasm32 -r st -e browser -b release

# Local preview (with COOP/COEP via serve.json)
pnpm serve -c ./serve.json
```

## Reference setup

Mirror `examples/web-vanilla/`.

`package.json`:

```jsonc
{
  "scripts": {
    "build": "crossbind build -p wasm -a wasm32 -r st -e browser -b release",
    "preview": "serve -c ./serve.json"
  },
  "devDependencies": {
    "crossbind": "^2.0.0",
    "serve": "^14.0.0"
  }
}
```

`crossbind.config.mjs`:

```js
export default {
    general: { name: 'my-static-site' },
    paths: {
        config: import.meta.url,
        output: 'dist',
    },
};
```

`index.html` (canonical pattern):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>My static site</title>
  <script src="./dist/my-static-site-wasm-wasm32-st-release.browser.js"></script>
  <script>
    initNative({ path: './dist' }).then(async ({ Native }) => {
      document.querySelector('#out').innerHTML = await Native.sample();
    });
  </script>
</head>
<body>
  <p id="out">loading…</p>
</body>
</html>
```

The `path: './dist'` option tells the loader where to find `crossbind.wasm` / `crossbind.data.txt` relative to the page URL.

`serve.json` (for local preview, also matches Netlify/Cloudflare Pages `_headers` semantics):

```json
{
  "headers": [
    {
      "source": "**/*",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

## Multithread → COOP/COEP

For `runtime: 'mt'`, the static host MUST set:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

| Host | How |
|------|-----|
| Local `serve` | `serve.json` (above) |
| Netlify / Cloudflare Pages | `public/_headers` with same content |
| GitHub Pages | **Doesn't support custom headers.** Multithread won't work on GH Pages — use Cloudflare Pages or Netlify instead. |
| Vercel | `vercel.json` `headers` array |
| nginx | `add_header Cross-Origin-... always;` in `location` |
| S3 + CloudFront | CloudFront response header policy |

For `runtime: 'st'`, no headers needed — works on any static host including GH Pages.

## Validation

- [ ] `pnpm install` succeeds.
- [ ] `pnpm build` produces `dist/<name>-<target>.browser.{js,wasm}` (and optionally `.data.txt`).
- [ ] `pnpm preview` (or any static server) serves `index.html`; opening it in browser shows the page rendered with the C++-computed value.
- [ ] No 404s on `/dist/...js`, `/dist/...wasm`, `/dist/...data.txt`.
- [ ] If multithread, `crossOriginIsolated === true` in browser console.
- [ ] If hosting publicly, the live site's response headers include COOP/COEP (use `curl -I <url>` to verify).

## Common pitfalls

- **Loading `<script type="module">`** when the `crossbind build` output is UMD (which it is by default). Drop `type="module"`; `initNative` becomes a global.
- **Wrong `path` in `initNative(...)`**. The loader resolves wasm relative to this. If your HTML lives at `/index.html` and dist at `/dist/`, use `path: './dist'`. If served from a CDN at `/assets/dist/`, use that.
- **Forgetting to copy `dist/` to your deploy.** A static host needs the actual files; nothing magical happens.
- **GH Pages + multithread.** Doesn't work — no custom headers. Drop to single-thread or move to a host that allows headers.
- **Trying `import` from the loader script** — the build emits UMD with a global `initNative`. For ES modules, you'd need a different output target (currently not exposed for vanilla).
- **`serve.json` ignored.** `serve` reads `serve.json` from the current working directory. Run `serve` from the same directory the JSON lives in (or pass `-c <path>`).

## Reference examples

- `examples/web-vanilla/` — single-thread vanilla, canonical
- `e2e/web-vanilla/` — bigger demo with multiple packages

Browser runtime adapter: `core/crossbind/src/assets/js-runtime/browser.js`.
