# @crossbind/plugin-metro
**crossbind Metro plugin**  
A tool for seamless C++ integration with the Metro bundler.

<a href="https://www.npmjs.com/package/@crossbind/plugin-metro">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/plugin-metro?style=for-the-badge" />
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
