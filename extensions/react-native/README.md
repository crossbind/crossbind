# @crossbind/extension-react-native

React Native and Expo apps: the native module, the builds Xcode and Gradle run, and `"plugins": ["crossbind"]` in an Expo
app's config.

## Install

```sh
npm install crossbind @crossbind/extension-react-native @crossbind/extension-react-native-ios @crossbind/core-embind-jsi
```

React Native's autolinking reads the app's own dependencies, so the app installs this package, and the package of its
iOS pod beside it.

## Use

```js
// metro.config.js
const { getDefaultConfig } = require('@react-native/metro-config');
const crossbind = require('crossbind');

module.exports = crossbind(getDefaultConfig(__dirname));
```

An Expo app lists the extension, and names crossbind among its config's plugins:

```js
// crossbind.config.js
import reactNative from '@crossbind/extension-react-native/crossbind.extension.js';

export default {
    extensions: [reactNative()],
};
```

```json
{ "expo": { "plugins": ["crossbind"] } }
```

`expo prebuild` then leaves out the x86_64 simulator architecture crossbind's libraries have no slice for, adopts the
scene lifecycle iOS 27 asks for, and sets the NDK crossbind's Android libraries build with.
