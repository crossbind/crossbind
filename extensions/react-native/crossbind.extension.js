import expo from './src/expo.cjs';

// React Native and Expo apps, which install this extension for its native module. An Expo app lists it in
// crossbind.config.js too, and its app.json's "plugins": ["crossbind"] makes Expo call crossbind(config) with its config.
export default function reactNative() {
    return {
        name: 'react-native',
        contract: 5,
        root: import.meta.dirname,
        integration: {
            wraps: (config) => expo.isExpoConfig(config),
            wrap: (api, config) => expo.withCrossbind(config),
        },
    };
}
