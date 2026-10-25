import { CREATE_COMMAND, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

const tag = RELEASE.distTagSuffix;

const metroConfig = (imports) => `${imports}
const CrossbindMetroPlugin = require('@crossbind/plugin-metro');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
    ...CrossbindMetroPlugin(defaultConfig),
};

module.exports = mergeConfig(defaultConfig, config);`;

export default {
    slug: 'react-native',
    title: 'React Native',
    description: 'Call C++ from React Native and Expo apps over JSI: install, Metro, iOS, Android and Expo.',
    lede: 'On Android and iOS your C++ compiles to native libraries inside the app\'s own Gradle and Xcode builds, and JavaScript calls them over JSI: no WebAssembly and no `SharedArrayBuffer`. You import a header from a component, as on the web, and call it after `initNative()`.',
    blocks: [
        { type: 'h2', id: 'setup', text: 'Set up' },
        {
            type: 'p',
            text: 'Install the runtime packages as dependencies, so React Native autolinks them, and the Metro plugin as a dev dependency. `crossbind` itself comes with `@crossbind/plugin-react-native`.',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npm install @crossbind/plugin-react-native${tag} \\
    @crossbind/plugin-react-native-ios-helper${tag} \\
    @crossbind/core-embind-jsi${tag}
npm install --save-dev @crossbind/plugin-metro${tag}`,
        },
        {
            type: 'p',
            text: 'Builds need Docker to generate the bridges for both platforms, or a [remote runner](/guide/remote-builds/), and the mobile tools in [Prerequisites](/guide/quick-start/#prerequisites). Add a `crossbind.config.mjs` at the project root; a port joins with its `-android` and `-ios` packages, both installed and listed:',
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
            text: 'Your own C++ goes under `src/native`. Import its header from a component and call it once `initNative()` resolves; here `Native` is a class declared in `src/native/native.h`:',
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
            text: '`@crossbind/plugin-metro` turns header, `.i` and `.rs` imports into JavaScript modules and writes the C++ bridge for each header while Metro bundles. Wrap the default config with it:',
        },
        { type: 'code', file: 'metro.config.js', code: metroConfig("const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');") },
        {
            type: 'p',
            text: 'In a monorepo, also add the workspace root to `watchFolders`, or Metro cannot resolve the workspace packages.',
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
            text: '`pod install` compiles your C++ and its bridges into the xcframework of the `react-native-crossbind` pod, and a `crossbind` build phase rebuilds what changed before every Xcode build. Each port arrives as a prebuilt pod of its own. Run `pod install` again when `conanDependencies` change.',
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
            text: 'There is no separate step: `npm run android` starts Gradle, whose crossbind tasks write the bridges and stage the ports\' data files before `preBuild`, and whose CMake build compiles your C++ for each ABI.',
        },
        { type: 'code', file: 'shell', code: 'npm run android' },
        {
            type: 'ul',
            items: [
                'ABIs: `arm64-v8a` and `x86_64`, narrowed to the app\'s `reactNativeArchitectures`.',
                'CMake 3.28 or newer, which the plugin\'s CMake script requires.',
                'Your C++ compiles with the app\'s NDK at its `minSdkVersion`, 24 when the app sets none. The port libraries come prebuilt from crossbind\'s Android image, built against API level 33.',
            ],
        },

        { type: 'h2', id: 'expo', text: 'Expo' },
        {
            type: 'p',
            text: 'Expo Go ships a fixed native binary and cannot load your C++, so the app needs native projects of its own, which `expo prebuild` generates. Install the same packages as above, and add the config plugin to `app.json` before prebuilding:',
        },
        {
            type: 'code',
            file: 'app.json',
            code: `{
    "expo": {
        "plugins": ["@crossbind/plugin-react-native"]
    }
}`,
        },
        {
            type: 'p',
            text: 'During prebuild it drops the x86_64 simulator architecture from every pod and the app target, raises any pod below iOS 15.1 to 15.1, and adopts the UIScene lifecycle iOS 27 requires, unless the app already declares a scene manifest. Wrap Expo\'s own Metro config rather than `@react-native/metro-config`; `expo/metro-config` exports no `mergeConfig`, so install `metro-config` as a dev dependency too (`npm install --save-dev metro-config`):',
        },
        {
            type: 'code',
            file: 'metro.config.js',
            code: metroConfig(`const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('metro-config');`),
        },
        {
            type: 'code',
            file: 'shell',
            code: `npx expo prebuild
npx expo run:ios
npx expo run:android`,
        },
        {
            type: 'p',
            text: 'The web build compiles the same imports to WebAssembly: the browser build, single-threaded unless `target.runtime` is `\'mt\'`, which then needs COOP/COEP headers from the host. Metro resolves imports against the files it found at startup, so stage the web dependencies first; an export also needs the wasm linked in after Expo bundles:',
        },
        {
            type: 'code',
            file: 'shell',
            code: `npx crossbind-metro prepare-web && npx expo start --web
npx crossbind-metro prepare-web && npx expo export -p web --clear && npx crossbind-metro export-web dist`,
        },

        { type: 'h2', id: 'threads-files', text: 'Threads and files' },
        {
            type: 'p',
            text: 'Android and iOS builds are always multithreaded: C++ threads are the device\'s own, with no `SharedArrayBuffer` or COOP/COEP headers involved, and `useWorker` does not apply. `target.runtime` changes only the Expo web build; [Threads and workers](/guide/threading/) covers that side.',
        },
        {
            type: 'p',
            text: 'C++ opens real files in the app\'s sandbox, so there are no `/opfs` or `/memfs` mounts: give it paths your app already uses. [Files](/guide/filesystem/) covers the other platforms.',
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
                'React Native 0.81 or newer: the bindings keep JavaScript callbacks in JSI runtime data, which 0.81 added.',
                'iOS simulator builds are arm64 only, so they need an Apple silicon Mac.',
                'A port\'s header binds only the functions the app imports. Metro sees a new import as soon as the file is saved, but the app has the function only after its next native build; until then the call fails with `... is not bound in the native module`.',
            ],
        },

        {
            type: 'p',
            text: `[examples/mobile-reactnative-cli](${REPO_URL}/tree/main/examples/mobile-reactnative-cli) and [examples/mobile-reactnative-expo](${REPO_URL}/tree/main/examples/mobile-reactnative-expo) are complete apps.`,
        },
    ],
};
