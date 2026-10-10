# @crossbind/plugin-metro
**crossbind Metro plugin**  
A tool for seamless C++ integration with the Metro bundler.

<a href="https://www.npmjs.com/package/@crossbind/plugin-metro">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/plugin-metro/beta?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>
<a href="https://crossbind.dev/docs/guide/integrate-into-existing-project/react-native">
    <img alt="Docs - React Native" src="https://img.shields.io/badge/Docs_-_React%20Native-20B2AA?style=for-the-badge" />
</a>
<a href="https://crossbind.dev/docs/guide/integrate-into-existing-project/expo">
    <img alt="Docs - Expo" src="https://img.shields.io/badge/Docs_-_Expo-20B2AA?style=for-the-badge" />
</a>

## Integration
To integrate crossbind into your project using Metro as a bundler, you can utilize the @crossbind/plugin-metro plugin. Start by installing these package with the following command:

NPM
```sh
npm install @crossbind/plugin-metro@beta --save-dev
```
or YARN
```sh
yarn add @crossbind/plugin-metro@beta --dev
```
or PNPM
```sh
pnpm add @crossbind/plugin-metro@beta --save-dev
```
or BUN
```sh
bun add @crossbind/plugin-metro --dev
```

To enable the plugin, modify the metro.config.js file as shown below.

**React Native**
```diff
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
+const CrossbindMetroPlugin = require('@crossbind/plugin-metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
-const config = {};
+const config = {
+    ...CrossbindMetroPlugin(getDefaultConfig(__dirname)),
+};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
```

**Expo**
```diff
// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
+const { mergeConfig } = require('metro-config');
+const CrossbindMetroPlugin = require('@crossbind/plugin-metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

+const newConfig = {
+    ...CrossbindMetroPlugin(config),
+};

-module.exports = config;
+module.exports = mergeConfig(config, newConfig);
```

## Web
On Expo's web platform the plugin compiles the C++ to WebAssembly, the build the Vite plugin makes: single-threaded unless `crossbind.config.js` sets `target.runtime: 'mt'`.

Metro resolves imports against the files it found when it started, so the Conan packages and cargo builds the web build needs are staged first:
```sh
npx crossbind-metro prepare-web
npx expo start --web
```

`expo start --web` builds the wasm when the page first loads and serves it from the dev server. A multithreaded build also gets the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers it needs there. Metro does not watch the C++ sources; reload the page after an edit to rebuild.

`expo export` runs nothing after the bundle, so a web export takes a last command, which links the release wasm into the export:
```sh
npx crossbind-metro prepare-web
npx expo export -p web --clear
npx crossbind-metro export-web dist
```

Host `dist` as any static site (with `web.output: 'server'`, pass `dist/client`). A multithreaded build also needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` from the host.

If your Metro config sets `server.enhanceMiddleware`, set it before passing the config to `CrossbindMetroPlugin`, which chains it.
