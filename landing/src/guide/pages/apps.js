import { CREATE_COMMAND, REPO_URL } from '../../data.js';
import { RELEASE } from '../../release.js';

const suffix = RELEASE.distTagSuffix;
const REFERENCE = `${REPO_URL}/blob/main/docs/api/app.md`;

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
            text: '`vite.config.js` registers the plugin as for the [browser](/guide/browser/). C++ goes in `src/native`, and the page imports its headers as a web page does:',
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
            text: 'The page imports the app\'s own functions from `crossbind/app`, and the app\'s C++ reaches most of them through `<crossbind/app.h>`:',
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
                '**Files:** open and save dialogs on the desktop, message dialogs everywhere, and the app\'s own data, cache and log folders.',
                '**The shell:** open a link in the default browser, open a file in its default app where `app.openPath` allows it, show a file in its folder, move one to the trash.',
                '**Menus, a tray icon and notifications** on the desktop. Their clicks reach the page as events, and so do the events the app\'s C++ emits.',
                '**Links and one instance:** `app.urlSchemes` opens the app from its own links, and `app.singleInstance` hands a second launch to the app that runs.',
                '**Devices:** the camera, the microphone and the location reach the page through the web\'s own APIs, once `app.permissions` gives the reason for each.',
            ],
        },
        { type: 'p', text: `The [reference](${REFERENCE}#the-apps-functions) lists which platform has which.` },

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
                ['`window`', "the desktop window's size and limits, `resizable`, `fullscreen` and `backgroundColor`"],
                ['`category`, `copyright`', 'the category macOS and Linux menus list the app under, and the line its About panel shows'],
                ['`urlSchemes`', 'the schemes whose links open the app'],
                ['`singleInstance`', 'hands a second launch to the app that runs'],
                ['`permissions`', 'the reason the app gives for the camera, the microphone and the location'],
                ['`openPath`', "where the page's `shell.openPath` may open files: `data`, `cache` and `logs`, the app's folders, and `picked`, what a dialog picked; nowhere without it"],
                ['`updater`', 'where a desktop app finds its updates, and the public key that checks them'],
                ['`team`', 'the Apple team that signs an iOS app'],
            ],
        },

        { type: 'h2', id: 'ship', text: 'Installers, signing and updates' },
        {
            type: 'p',
            text: '`crossbind app build` writes what installs a desktop app beside it: a disk image on macOS, a Debian package on Linux, and on Windows a setup program that installs the app for its user, with no administrator\'s approval.',
        },
        {
            type: 'p',
            text: `Signing keys come from the environment alone. A macOS app is signed ad hoc, which opens it on the Mac that built it alone, unless \`CROSSBIND_APPLE_SIGNING_IDENTITY\` names a Developer ID; with an App Store Connect API key beside it, the build has Apple notarize the app as well. A Windows app and its setup program are signed with a key file, such as PKCS#12, or a cloud key service, such as Azure Trusted Signing; a hardware token is out of the build's reach. The reference names the variables for [macOS](${REFERENCE}#signing-a-macos-app) and [Windows](${REFERENCE}#signing-a-windows-app).`,
        },
        {
            type: 'p',
            text: 'A desktop app updates itself; a Linux app installed from its Debian package updates with the package manager instead. `crossbind app updater-key` prints a key pair: the public key goes in `app.updater.publicKey`, the private one in `CROSSBIND_UPDATER_PRIVATE_KEY` where the app is built, and the build signs each update with it. The page decides when to install:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: `import { updater } from 'crossbind/app';

const update = await updater.check();
if (update && confirm(\`Install \${update.version}?\`)) await updater.install();`,
        },
        { type: 'p', text: 'iOS and Android apps update through their stores.' },

        { type: 'h2', id: 'size', text: 'Size' },
        {
            type: 'p',
            text: 'No browser engine ships inside. The sample app is 6.7 MB on an arm64 Mac, 1.8 MB zipped, 6 MB of it Hermes, the JavaScript engine the bindings run in, and it shows its first native result 0.34 s after launch on an M-series Mac. Its Windows executable is 4.6 MB on x64, its iOS app 4.7 MB, and its Android release APK 14.8 MB with both ABIs, of which Google Play delivers one.',
        },

        { type: 'h2', id: 'limits', text: 'Limits' },
        {
            type: 'ul',
            items: [
                '**One window** on the desktop, and **Vite** for the page.',
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
