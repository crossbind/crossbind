# @crossbind/extension-esbuild

`crossbind()` in esbuild's plugin list, and Bun's.

crossbind has it as a dependency: there is nothing to install or list.

## Use

```js
// build.mjs
import * as esbuild from 'esbuild';
import crossbind from 'crossbind';

await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'esm',
    outdir: 'dist',
    plugins: [crossbind()],
});
```

```js
// build.mjs, run with Bun 1.2.22 or later
import crossbind from 'crossbind';

await Bun.build({ entrypoints: ['./src/main.js'], outdir: './dist', plugins: [crossbind()] });
```

The plugin turns header and `.rs` imports into modules and a `cargo:` import or a dependency's header into its file.
After each build it puts `crossbind.js` and `crossbind.wasm` beside the build's output, or where `crossbind.config.js`
names, and the page loads them from `publicPath`, or from the root. esbuild's own server sends no headers, so a
multithreaded page needs a server that isolates it.

## Replace

An extension named `esbuild` that `crossbind.config.js` lists, with an integration of its own, takes its place.
