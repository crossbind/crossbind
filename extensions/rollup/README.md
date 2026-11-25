# @crossbind/extension-rollup

`crossbind()` in Rollup's plugin list, and Rolldown's.

crossbind has it as a dependency: there is nothing to install or list.

## Use

```js
// rollup.config.js
import crossbind from 'crossbind';

export default {
    input: 'src/main.js',
    output: { dir: 'dist', format: 'es' },
    plugins: [crossbind()],
};
```

A module that imports a header gets the header's bindings, and the build puts `crossbind.js` and `crossbind.wasm`,
which the page's boot code loads, beside its output. Watch mode builds again after the native code changes.

## Replace

An extension named `rollup` that `crossbind.config.js` lists, with an integration of its own, takes its place.
