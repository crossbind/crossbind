# @crossbind/extension-metro

`crossbind(config)` around Metro's config, for React Native and Expo apps and Expo's web.

crossbind has it as a dependency: there is nothing to install or list.

## Use

```js
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config'); // or '@react-native/metro-config'
const crossbind = require('crossbind');

module.exports = crossbind(getDefaultConfig(__dirname));
```

`crossbind(config)` gives Metro a Promise of the config, which Metro and Expo wait for, so it wraps the others: a wrapper
that adds to the config, as one for styles does, goes inside it.

## Expo's web

`expo start --web` and `expo export --platform web` run as they are. In an app with `react-native-web`, the config
stages the web build's dependencies before Metro starts, the dev server serves the glue the page asks for, and an
export puts `crossbind.js` and `crossbind.wasm` beside the page.

## Replace

An extension named `metro` that `crossbind.config.js` lists, with an integration of its own, takes its place.
