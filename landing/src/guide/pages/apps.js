import extensionsCatalog from '../../../generated/extensions-catalog.js';
import { CREATE_COMMAND, EXTENSIONS_URL, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

const suffix = RELEASE.distTagSuffix;
const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;
const NPM_KEYWORD_SEARCH = 'https://www.npmjs.com/search?q=keywords%3Acrossbind-extension';

// crossbind's own extensions npm serves on the site's channel, as scripts/site/build-extensions-catalog.mjs finds them,
// and where the others are.
export const extensionBlocks = (extensions) => {
    const published = extensions.filter((extension) => extension.version);
    return [
        { type: 'h2', id: 'extensions', text: 'Extensions' },
        {
            type: 'p',
            text: "An extension gives the page more of the app's functions, from a package of its own: `crossbind add <package>` installs one with the project's package manager and lists it in `crossbind.config.js`, and the app's host builds its native code in.",
        },
        ...(published.length > 0
            ? [{ type: 'ul', items: published.map((extension) => `[${extension.name}](https://www.npmjs.com/package/${extension.name}): ${extension.summary}`) }]
            : []),
        {
            type: 'p',
            text: `Every extension carries the npm keyword [crossbind-extension](${NPM_KEYWORD_SEARCH}), crossbind's own as well, and crossbind has not reviewed the ones others publish. \`${CREATE_COMMAND} -- my-extension Extension\` starts one of your own, and [extensions.md](${REPO_URL}/blob/main/docs/api/extensions.md) is the contract it is written to. [Extensions](/guide/extensions/) shows how to use and write one, and [the catalog](${EXTENSIONS_URL}) lists crossbind's own.`,
        },
    ];
};

export default {
    slug: 'apps',
    title: 'Apps',
    description: 'Build a page and the C++ or Rust it imports into an app for macOS, Linux, Windows, iOS and Android, with no Node.js and no browser engine inside.',
    lede: 'crossbind builds a Vite page and the native code it imports into an app for macOS, Linux, Windows, iOS and Android. The page runs in the system webview; the C++ and Rust run natively in the app\'s own process, with no Node.js and no browser engine of its own.',
    blocks: [
        { type: 'h2', id: 'setup', text: 'Setup' },
        { type: 'p', text: 'Start from the template:' },
        { type: 'code', file: 'shell', code: `${CREATE_COMMAND} my-app Desktop App` },
        { type: 'p', text: 'Or, in an existing Vite project, install the app host and set the runtime environment to `app`:' },
        {
            type: 'code',
            file: 'shell',
            code: `npm install -D crossbind${suffix} @crossbind/plugin-vite${suffix} @crossbind/core-app-host${suffix}`,
        },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'my-app' },
    target: { runtimeEnv: 'app' },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'p',
            text: '`vite.config.js` registers the [Vite plugin](/guide/bundler-plugins/#vite) as for the browser. C++ goes in `src/native`, and the page imports its headers as a web page does:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { initNative, Native } from './native/native.h';

await initNative();
document.querySelector('#result').textContent = await Native.sample();`,
        },
        {
            type: 'p',
            text: 'Every call, `new` and property read returns a promise, as in a web build that runs its module in a [worker](/guide/threading/). An object stays in the app\'s process while the page holds a handle to it, which the garbage collector releases, and an error keeps its own fields, such as `code`.',
        },

        { type: 'h2', id: 'develop', text: 'Develop and build' },
        {
            type: 'table',
            head: ['Command', 'What it does'],
            rows: [
                [
                    '`crossbind app dev`',
                    "Opens this machine's app on Vite's dev server. An edit to the page reloads it; an edit to native code rebuilds the app and opens it again. The page's console shows in the terminal.",
                ],
                ['`crossbind app build`', 'Writes the app and what installs it: `dist/<name>.app` and its `.dmg` on macOS; a folder, its `.tar.gz` and its `.deb` on Linux.'],
                ['`crossbind app build -p linux`', 'The Linux app for x64 and arm64, from a Mac as well.'],
                ['`crossbind app build -p windows`', 'The Windows app for x64 and arm64, each with its `.zip` and `-setup.exe`, from a Mac or a Linux machine as well.'],
                ['`crossbind app dev -p ios`', 'Opens the app in the iOS Simulator on the dev server.'],
                ['`crossbind app dev -p ios --device`', "Opens the app on the iPhone or iPad connected, signed by Xcode for the app's team, a free Personal Team among them. The phone reaches the dev server through its cable."],
                ['`crossbind app build -p ios`', "Writes the app's Xcode project, `dist/<name>-ios/`."],
                ['`crossbind app dev -p android`', 'Installs the app on the attached Android device or emulator and opens it on the dev server.'],
                ['`crossbind app build -p android`', "Writes the app's Gradle project and its release `.apk`, and an `.aab` with an upload key."],
            ],
        },
        {
            type: 'p',
            text: 'The template runs each as an npm script: `npm run dev`, `npm run build:windows`, `npm run dev:android` and so on. macOS apps build with Xcode\'s command line tools, iOS apps with Xcode. Linux, Windows and Android apps build in crossbind\'s Docker images on this machine, with the default runner or `RUNNER=DOCKER_EXEC`; a [remote](/guide/remote-builds/) or local runner stops them.',
        },

        { type: 'h2', id: 'functions', text: 'What the app does for the page' },
        {
            type: 'p',
            text: 'The page imports the app\'s own functions from `crossbind/app`, and the app\'s C++ reaches them by name with `invoke()` from `<crossbind/extension.h>`:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { app, dialog } from 'crossbind/app';

const file = await dialog.save({ defaultName: 'report.csv' });
if (file) await Native.exportReport(file);
const { data, cache, logs } = await app.paths();`,
        },
        {
            type: 'ul',
            items: [
                '**Files:** open and message dialogs everywhere, save dialogs on the desktop, and the app\'s own data, cache and log folders.',
                '**Where it runs:** `device` tells the page its platform, arch, whether the device is a phone, a tablet or a desktop, and the system\'s version, as the page starts.',
                '**The shell:** open a link in the default browser, open a file in its default app where `app.openPath` allows it, show a file in its folder, move one to the trash.',
                '**Menus, a tray icon and notifications** on the desktop. Their clicks reach the page as events, and so do the events the app\'s C++ emits.',
                '**Links and one instance:** `app.urlSchemes` opens the app from its own links, and `app.singleInstance` hands a second launch to the app that runs.',
                '**Devices:** the camera, the microphone and the location reach the page through the web\'s own APIs, once `app.permissions` gives the reason for each.',
            ],
        },
        { type: 'p', text: `The [reference](${REFERENCE}#the-apps-functions) lists which platform has which.` },
        ...extensionBlocks(extensionsCatalog.extensions),

        { type: 'h2', id: 'config', text: 'Configuration' },
        { type: 'p', text: 'The `app` key of `crossbind.config.js` describes the app. Every key is optional:' },
        {
            type: 'code',
            file: 'crossbind.config.js',
            code: `export default {
    general: { name: 'my-app' },
    target: { runtimeEnv: 'app' },
    app: {
        name: 'My App',
        id: 'com.example.myapp',
        icon: 'icon.png',
        window: { width: 1024, height: 768, minWidth: 640, minHeight: 480 },
    },
    paths: { config: import.meta.url },
};`,
        },
        {
            type: 'table',
            head: ['Key', 'What it does'],
            rows: [
                ['`name`', "the name the app shows: its window's title, its menus, the label under its icon; `general.name` without it"],
                ['`id`', 'the bundle id on Apple platforms, the application id on Android; `dev.crossbind.<name>` without it'],
                ['`icon`', "a square PNG, at best 1024 × 1024, made into each platform's icon"],
                ['`window`', "the first desktop window's size and limits, `resizable` and `fullscreen`, and every window's `backgroundColor`"],
                ['`category`, `copyright`', 'the category macOS and Linux menus list the app under, and the line its About panel shows'],
                ['`urlSchemes`', 'the schemes whose links open the app'],
                ['`singleInstance`', 'hands a second launch to the app that runs'],
                ['`permissions`', 'the reason the app gives for the camera, the microphone and the location'],
                ['`openPath`', "where the page's `shell.openPath` may open files: `data`, `cache` and `logs`, the app's folders, and `picked`, what a dialog picked; nowhere without it"],
                ['`updater`', 'where a desktop app finds its updates, and the public key that checks them'],
                ['`team`', 'the Apple team that signs an iOS app'],
            ],
        },

        { type: 'h2', id: 'distribute', text: 'Distribute' },
        {
            type: 'p',
            text: '`crossbind app build` writes what installs a desktop app beside it, and `crossbind app publish <store>` builds the app and sends it to a store: `app-store` to App Store Connect and TestFlight, `google-play` to a Google Play track, and `github` a desktop app\'s installers and update to a GitHub release. `-p ios` and `-p android` name the first two. Each has its page:',
        },
        {
            type: 'ul',
            items: [
                '[Installers and signing](/guide/installers/): the disk image, Debian package and setup program, and the keys that sign a macOS or Windows app.',
                '[Updates](/guide/updates/): a desktop app that updates itself, with updates only your key signs.',
                '[App Store](/guide/app-store/), [Google Play](/guide/google-play/) and [GitHub Releases](/guide/github-releases/): one command each, from your machine or from CI.',
                '[winget and Microsoft Store](/guide/winget-microsoft-store/): both take the Windows setup from a GitHub release.',
            ],
        },
        {
            type: 'p',
            text: 'Each store is a publisher an [extension](/guide/extensions/) adds, and one listed under the name of crossbind\'s takes its place.',
        },

        { type: 'h2', id: 'size', text: 'Size' },
        {
            type: 'p',
            text: 'No browser engine ships inside. The sample app is 6.7 MB on an arm64 Mac, 1.8 MB zipped, 6 MB of it Hermes, the JavaScript engine the bindings run in, and it shows its first native result 0.34 s after launch on an M-series Mac. Its Windows executable is 4.6 MB on x64, its iOS app 4.7 MB, and its Android release APK 14.8 MB with both ABIs, of which Google Play delivers one.',
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                '**Vite** for the page.',
                '**macOS 11, iOS 15.1 and Android 13** or later: iOS on arm64 alone, Android on arm64-v8a and x86_64 with Android System WebView 116 or later.',
                '**Linux** needs a glibc system with WebKitGTK 4.1, release 2.40 or later. **Windows** needs the WebView2 Runtime, which Windows 11 includes.',
                `**Not everything is measured everywhere yet.** Signing with a real Developer ID and notarizing, Windows signing with a cloud key service, building on a Windows machine and several desktop functions on Linux and Windows have not been run; the [reference](${REFERENCE}#limits) lists what has been measured on each platform.`,
            ],
        },
        {
            type: 'p',
            text: `[examples/desktop-app](${REPO_URL}/tree/main/examples/desktop-app) is the template: a page, C++ and a prebuilt library, with a script for every platform. [app.md](${REFERENCE}) is the reference behind this page.`,
        },
    ],
};
