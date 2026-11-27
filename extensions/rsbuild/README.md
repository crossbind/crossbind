# @crossbind/extension-rsbuild

`crossbind()` in Rsbuild's plugin list.

crossbind has it as a dependency: there is nothing to install or list.

## Use

```js
// rsbuild.config.mjs
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import crossbind from 'crossbind';

export default defineConfig({
    plugins: [pluginReact(), crossbind()],
});
```

Rsbuild builds with Rspack, on which crossbind's webpack extension builds the page: it adds the rule for headers and
`.rs` files and puts `crossbind.js` and `crossbind.wasm` beside the production build. Rsbuild's dev and preview servers
send the headers that isolate the page, and the dev server gets the middleware that links and serves the glue the boot
code asks for, and reloads the page after a native source changes.

## Replace

An extension named `rsbuild` that `crossbind.config.js` lists, with an integration of its own, takes its place.
