# @crossbind/extension-next

`crossbind(nextConfig)` around a Next.js config, under Turbopack or webpack. Next.js 16 or later.

crossbind has it as a dependency: there is nothing to install or list.

## Use

```js
// next.config.mjs
import crossbind from 'crossbind';

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default crossbind(nextConfig);
```

The C++ runs in the browser, so a component that calls it is a client component (`'use client'`) and calls
`initNative()` in an effect.

The wrapper adds Turbopack's rules and webpack's for headers and `.rs` files, and finds the file of each `cargo:` import
and dependency's header. `next build` puts `crossbind.js` and `crossbind.wasm` under `/_next/static/crossbind/`, and
`next dev` serves them from crossbind as the page asks, linked again after a change. A multithreaded page gets the
headers that isolate it on every route. Turbopack takes the named imports as the config loads, so under it `next dev`
finds a new one after a restart.

## Replace

An extension named `next` that `crossbind.config.js` lists, with an integration of its own, takes its place.
