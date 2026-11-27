# Integration — Next.js

> Persona 2 sub-playbook. The user's project is a Next.js app. Detection: `next` in deps, `next.config.{js,mjs,ts}` at
> root.

## Goal

Wrap the Next config with `crossbind(nextConfig)` so:

- Header and `.rs` imports become modules under Turbopack, Next 16's default, and webpack (`--webpack`) alike.
- `next build` puts `crossbind.js` and `crossbind.wasm` under `/_next/static/crossbind/`, which `next start` serves.
- `next dev` serves the debug glue, linked again after a C++ change.
- A multithreaded page gets COOP/COEP on every route, in dev and on `next start`.

## When to use

- Next.js 16 or later, App Router or Pages Router.
- The C++ runs in the browser: the component that calls it is a client component.

## Files involved

| File | Role |
|------|------|
| `package.json` | + `crossbind` (devDependency), optional `@crossbind/port-<name>` |
| `next.config.{js,mjs,ts}` | `export default crossbind(nextConfig)` |
| `crossbind.config.js` *(new at root)* | Project-level crossbind config |
| `src/native/` *(only if the user wraps own C++)* | `.h` + `.cpp` source |

## Commands

```bash
pnpm add -D crossbind@beta
pnpm add @crossbind/port-<name>@beta     # optional

pnpm next dev                      # Turbopack; --webpack for webpack
pnpm next build && pnpm next start
```

## Reference config

```js
// next.config.mjs
import crossbind from 'crossbind';

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default crossbind(nextConfig);
```

A CommonJS config takes it the same way, `module.exports = crossbind(nextConfig)`, and a config that is a function stays
one: `crossbind((phase) => ({ ... }))`.

```jsx
// app/page.jsx
'use client';

import { useEffect, useState } from 'react';
import { initNative, Native } from '../src/native/native.h';

export default function Page() {
    const [result, setResult] = useState('');
    useEffect(() => {
        initNative().then(() => setResult(Native.sample()));
    }, []);
    return <p>{result}</p>;
}
```

Beside the app's own keys, the wrapper adds Turbopack's `rules` and `resolveAlias`, the `webpack` hook, under `next dev`
a `rewrites` entry for `/_crossbind/:file`, the isolation `headers` for an `mt` build, and
`compiler.runAfterProductionCompile`, which runs after the app's own.

## Multithread → COOP/COEP

The wrapper adds the two headers to every route when `crossbind.config.js` sets `target.runtime: 'mt'`, and `next dev`
and `next start` send them. A static export (`output: 'export'`) has no server: the host must send them, see
`docs/playbooks/integration/vite.md` "Multithread → production headers".

## Validation

- [ ] `pnpm next dev`: the page's C++ call returns, and the glue answers 200 at `/_crossbind/crossbind.js`.
- [ ] `pnpm next build`: `.next/static/crossbind/` holds `crossbind.js` and `crossbind.wasm`.
- [ ] `pnpm next start`: the same page works.
- [ ] Both again with `--webpack`, if the project builds with webpack.

## Common pitfalls

- **A server component calling C++.** Call it from a client component, `initNative()` in an effect.
- **A new `cargo:` import or dependency header under `next dev` with Turbopack.** Turbopack takes them as the config
  loads: restart `next dev`.
- **The dev server opened by another host name than its own.** Next refuses its `/_next/*` resources to it (`127.0.0.1`
  for a server on `localhost`): open the host it prints, or set `allowedDevOrigins`.
- **Next 15 or older.** `crossbind(nextConfig)` needs Next 16: its build hook and its dev output folder.
- **A C++ edit under `next dev`.** The glue links again as the page asks for it: reload the page.

## Server vs client

The Next integration builds the browser's wasm. A route handler or server component that needs C++ on the server uses a
Node build instead: see `docs/playbooks/integration/nodejs.md`.

## Reference

- Extension: `extensions/next/` (its README and AGENTS.md).
- The e2e project: `e2e/web-next/`, Turbopack and webpack, dev and production.
