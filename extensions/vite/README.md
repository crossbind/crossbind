# @crossbind/extension-vite

`crossbind()` in Vite's plugin list: a web build's page, an app's page and a preview's.

crossbind has it as a dependency: there is nothing to install or list.

## Use

```js
// vite.config.js
import { defineConfig } from 'vite';
import crossbind from 'crossbind';

export default defineConfig({
    plugins: [crossbind()],
});
```

A page imports a header as a module, as `import { initNative, Native } from './native/native.h'` does. `vite` serves the
glue the page's boot code asks for, linked again after the native code changes, and `vite build` puts `crossbind.js`
and `crossbind.wasm` beside the page.

## Builds

- A web build: wasm for a browser, multithreaded where `crossbind.config.js` asks for it, which the dev server and
  `vite preview` serve with the headers that isolate the page.
- An app's build, as `crossbind app build` and `crossbind app dev` run Vite: the app's host, and the session that opens
  the app and opens it again after a native change.
- A preview, which `crossbind app preview` runs.

## Replace

An extension named `vite` that `crossbind.config.js` lists, with an integration of its own, takes its place.
