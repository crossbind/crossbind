import { CREATE_COMMAND, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

const tag = RELEASE.distTagSuffix;

const metroConfig = (from) => `const { getDefaultConfig } = require('${from}');
const crossbind = require('crossbind');

module.exports = crossbind(getDefaultConfig(__dirname));`;

export default {
    slug: 'react-native',
    title: 'React Native',
    description: 'Call C++ from React Native and Expo apps over JSI: install, Metro, iOS, Android and Expo.',
    lede: 'On Android and iOS your C++ compiles to native libraries inside the app\'s Gradle and Xcode builds, and JavaScript calls them over JSI, with no WebAssembly. You import a header from a component, as on the web, and call it after `initNative()`.',
    blocks: [
        { type: 'h2', id: 'setup', text: 'Set up' },
        {
            type: 'p',
            text: 'Install the runtime packages as dependencies, so React Native autolinks them, and `crossbind` as a dev dependency.',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install @crossbind/extension-react-native${tag} \\
    @crossbind/extension-react-native-ios${tag} \\
    @crossbind/core-embind-jsi${tag}
npm install --save-dev crossbind${tag}`,
        },
        {
            type: 'p',
            text: 'Android builds need Docker or a [remote runner](/guide/remote-builds/); iOS builds run on the Mac. Both need the mobile tools in [Prerequisites](/guide/quick-start/#prerequisites). Add a `crossbind.config.mjs` at the project root; a port needs its `-android` and `-ios` packages, both installed and listed:',
        },
        {
            type: 'code',
            file: 'crossbind.config.mjs',
            code: `import zlibAndroid from '@crossbind/port-zlib-android/crossbind.config.js';
import zlibIos from '@crossbind/port-zlib-ios/crossbind.config.js';

export default {
    dependencies: [zlibAndroid, zlibIos],
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: 'Your C++ goes in `src/native`. Import its header from a component and call it once `initNative()` resolves (`Native` is a class in `src/native/native.h`):',
        },
        {
            type: 'code',
            file: 'src/App.tsx',
            code: `import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { initNative, Native } from './native/native.h';

export default function App() {
    const [message, setMessage] = useState('loading');

    useEffect(() => {
        initNative().then(() => setMessage(Native.sample()));
    }, []);

    return <Text>{message}</Text>;
}`,
        },
        {
            type: 'p',
            text: `To start from a template instead: \`${CREATE_COMMAND} -- my-app Mobile "React Native" "Native CLI"\`, or \`Expo\` as the last argument.`,
        },

        { type: 'h2', id: 'metro', text: 'Metro' },
        {
            type: 'p',
            text: '`crossbind()` turns header, `.i` and `.rs` imports into JavaScript modules and writes the C++ bridge for each header while Metro bundles. Metro has no plugin list, so it wraps the config, as the outermost wrapper:',
        },
        { type: 'code', file: 'metro.config.js', code: metroConfig('@react-native/metro-config') },
        {
            type: 'p',
            text: 'A config of your own merges inside it: `crossbind(mergeConfig(getDefaultConfig(__dirname), config))`. In a monorepo, also add the workspace root to `watchFolders`, or Metro cannot resolve the workspace packages.',
        },

        { type: 'h2', id: 'ios', text: 'iOS' },
        {
            type: 'p',
            text: 'iOS libraries build on the Mac itself, with the Xcode at `/Applications/Xcode.app`, for iOS 15.1 and later. Install the pods, then run the app:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `cd ios && pod install && cd ..
npm run ios`,
        },
        {
            type: 'p',
            text: '`pod install` compiles your C++ into the `react-native-crossbind` pod, and a `crossbind` build phase rebuilds what changed before every Xcode build. Run `pod install` again when `packages.conan` changes.',
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Xcode cannot find Node.js',
            text: 'The `crossbind` build phase runs `node` by name, from Xcode\'s environment rather than your shell\'s. If it is not found there, link it once: `ln -s $(which node) /usr/local/bin/node`.',
        },

        { type: 'h2', id: 'android', text: 'Android' },
        {
            type: 'p',
            text: 'There is no separate step: `npm run android` builds the bridges and your C++ inside Gradle.',
        },
        { type: 'code', file: 'shell', code: 'npm run android' },
        {
            type: 'ul',
            items: [
                'ABIs: `arm64-v8a` and `x86_64`, narrowed to the app\'s `reactNativeArchitectures`.',
                'CMake 3.28 or newer, which the extension\'s CMake script requires.',
                'Your C++ compiles with the app\'s NDK at its `minSdkVersion`, 24 when the app sets none. The port libraries come prebuilt from crossbind\'s Android image, built against API level 33.',
            ],
        },

        { type: 'h2', id: 'expo', text: 'Expo' },
        {
            type: 'p',
            text: "Expo Go cannot load your C++, so the app needs native projects of its own, which `expo prebuild` generates. Install the same packages as above, add `crossbind` to `app.json`'s plugins and list the React Native extension in `crossbind.config.mjs` before prebuilding; `crossbind add @crossbind/extension-react-native` installs and lists it in one step.",
        },
        {
            type: 'code',
            file: 'app.json',
            code: `{
    "expo": {
        "plugins": ["crossbind"]
    }
}`,
        },
        {
            type: 'code',
            file: 'crossbind.config.mjs',
            code: `import reactNative from '@crossbind/extension-react-native/crossbind.extension.js';

export default {
    extensions: [reactNative()],
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: "During prebuild the extension sets up the iOS project for crossbind: arm64 simulators only, iOS 15.1 at least, and the UIScene lifecycle iOS 27 requires. Wrap Expo's own Metro config the same way:",
        },
        { type: 'code', file: 'metro.config.js', code: metroConfig('expo/metro-config') },
        {
            type: 'code',
            file: 'shell',
            code: `npx expo prebuild
npx expo run:ios
npx expo run:android`,
        },
        {
            type: 'p',
            text: "Expo's web build compiles the same imports to WebAssembly, single-threaded unless `target.runtime` is `'mt'`, which needs COOP/COEP headers from the host. With `react-native-web` installed, Expo's own commands do it all: `crossbind()` stages the web dependencies as Metro starts, and Expo's export carries the compiled module.",
        },
        {
            type: 'code',
            file: 'shell',
            code: `npx expo start --web
npx expo export -p web --clear`,
        },

        { type: 'h2', id: 'threads-files', text: 'Threads and files' },
        {
            type: 'p',
            text: 'Android and iOS builds are always multithreaded with the device\'s own threads: no headers are needed, and `useWorker` does not apply. `target.runtime` changes only the Expo web build.',
        },
        {
            type: 'p',
            text: 'C++ opens real files in the app\'s sandbox; there are no `/opfs` or `/memfs` mounts.',
        },

        { type: 'h2', id: 'release', text: 'Release builds' },
        { type: 'p', text: 'The C++ compiles inside the app\'s own build, so a release build needs no extra step:' },
        {
            type: 'code',
            file: 'shell',
            code: `npx react-native run-ios --mode Release
npx react-native run-android --mode Release
npx expo run:ios --configuration Release
npx expo run:android --variant release`,
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                'React Native 0.81 or newer.',
                'iOS simulator builds are arm64 only, so they need an Apple silicon Mac.',
                'A function newly imported from a port\'s header works only after the next native build; until then the call fails with `... is not bound in the native module`.',
            ],
        },

        {
            type: 'p',
            text: `[examples/mobile-reactnative-cli](${REPO_URL}/tree/main/examples/mobile-reactnative-cli) and [examples/mobile-reactnative-expo](${REPO_URL}/tree/main/examples/mobile-reactnative-expo) are complete apps.`,
        },
    ],
};
