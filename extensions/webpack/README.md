# @crossbind/extension-webpack

`crossbind()` in webpack's plugin list, and Rspack's, with the loader and the dev server's part it needs.

crossbind has it as a dependency: there is nothing to install or list.

## Use

```js
// rspack.config.mjs, or webpack.config.js
import crossbind from 'crossbind';

export default {
    entry: './src/main.jsx',
    plugins: [crossbind()],
};
```

The plugin adds the rule for headers and `.rs` files, and gives the dev server the headers that isolate the page and the
middleware that links and serves the glue the boot code asks for, under the public path. A production build puts
`crossbind.js` and `crossbind.wasm` beside webpack's output, or where `crossbind.config.js` names.

## Replace

An extension named `webpack` that `crossbind.config.js` lists, with an integration of its own, takes its place.
