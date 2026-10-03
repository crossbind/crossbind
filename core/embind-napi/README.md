# @crossbind/core-embind-napi
**crossbind Node-API host**  
Runs the crossbind embind runtime inside a native Node.js addon, so the bindings that serve
WebAssembly and React Native also build `.node` addons for Node.js and Electron.

<a href="https://www.npmjs.com/package/@crossbind/core-embind-napi">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/core-embind-napi?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>

## Use

Add it next to `crossbind` and build the native platform:

```bash
pnpm add -D crossbind @crossbind/core-embind-napi
pnpm crossbind build -p darwin
```

`dist/` then holds one addon per platform and architecture (`<name>.darwin-arm64.node`,
`<name>.darwin-x64.node`) and the loader that picks one at runtime:

```js
const initNative = require('./dist/<name>.native.cjs');

const { Native } = await initNative();
```

crossbind resolves this package from your project; you never import it yourself. See the
[Node.js integration guide](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/integration/nodejs.md#native-addon-node-api) for
requirements and current limits (macOS only, no `worker_threads` yet).

## Contents

- `cpp/` — the addon's CMake project and its Node-API entry point.
- `js/loader.js` — the loader crossbind bundles into `dist/<name>.native.cjs`.
- `js/addonPlatform.js` — tells glibc and musl Linux apart, so the loader picks the `linux` or `linuxmusl` addon.
- `third_party/node-api-jsi/` — Microsoft's JSI implementation over Node-API (MIT), vendored at a
  pinned commit; provenance and local patches are in its README.

## License

MIT
