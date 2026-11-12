# @crossbind/example-desktop-app
**crossbind desktop app sample**

A macOS, Linux, Windows, iOS and Android app whose page runs in the system webview and whose C++ runs natively in the
app: crossbind builds `src/native` and the matrix library into the app's own host, and the page calls it with the same
`initNative()` and awaited calls as a web build that runs its module in a worker. There is no Node.js and no browser
engine in the app; the page uses the system's own, WKWebView on macOS and iOS, WebKitGTK on Linux, WebView2 on
Windows and Android System WebView on Android.

# Getting Started

>**Note**: Make sure you have completed the [crossbind - Prerequisites](https://crossbind.dev/docs/guide/getting-started/prerequisites) instructions.
Apps build on macOS with Xcode's command line tools, iOS apps with Xcode and its iOS platform, and Linux, Windows and
Android apps in crossbind's linux, windows and android-app images, which carry everything they build with. The
bindings are generated in Docker, but on a Mac `@crossbind/bridge-tools` generates every app's but Android's. A macOS or
iOS build fetches React Native's Hermes once into `~/.crossbind/hermes`.

## Setup

Install the dependencies:

```bash
pnpm install
```

Inside the crossbind repository, build the library's archives first:
`pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:desktop`, `run build:ios` for the iOS app and
`run build:android` for the Android app.

## Get Started

```bash
pnpm dev
```

opens the app on Vite's dev server: edits to the page reload it, edits to the C++ rebuild the app and open it again,
and the page's console shows in the terminal. Closing the window ends the session.

## Build

```bash
pnpm build
```

writes the app to `dist/crossbind-example-desktop-app.app`, signed ad hoc, so it opens on the Mac that built it, and
its disk image beside it; a Developer ID and an App Store Connect API key in the environment sign it for every Mac
(see `docs/api/app.md`). On Linux it writes `dist/crossbind-example-desktop-app-linux-<arch>/`, the same as a
`.tar.gz`, which runs where WebKitGTK 4.1 is installed (`libwebkit2gtk-4.1-0` on Debian and Ubuntu), and a `.deb`
that installs it with WebKitGTK.

```bash
pnpm build:linux
```

writes the Linux app for x64 and arm64, on a Mac as well.

```bash
pnpm build:windows
```

writes the Windows app for x64 and arm64, on a Mac or Linux as well: `dist/crossbind-example-desktop-app-win32-<arch>/`,
the same as a `.zip`, which runs where the WebView2 Runtime is installed, as on Windows 11, and a `-setup.exe` that
installs it, with the runtime where Windows has none; a signing key in the environment signs both (see
`docs/api/app.md`).

## iOS

```bash
pnpm dev:ios
```

opens the app in the iOS Simulator on Vite's dev server, as `pnpm dev` does on the desktop; ending the app in the
Simulator ends the session.

```bash
pnpm build:ios
```

writes the app's Xcode project to `dist/crossbind-example-desktop-app-ios/`. Open it in Xcode to run the app on an
iPhone, once `crossbind.config.js` names the app's bundle id and Apple team (`app: { id, team }`).

## Android

```bash
pnpm dev:android
```

opens the app on the attached Android device or the running emulator on Vite's dev server, as `pnpm dev` does on the
desktop; ending the app ends the session. Start an emulator first, in Android Studio's Device Manager, or connect a
phone with USB debugging on. crossbind reaches it with the machine's `adb` (`brew install --cask
android-platform-tools` on macOS, `sudo apt install adb` on Debian and Ubuntu, or Android Studio's).

```bash
pnpm build:android
```

writes `dist/crossbind-example-desktop-app-android.apk`, signed with this machine's debug key, which `adb install`
puts on a device. With `CROSSBIND_ANDROID_KEYSTORE`, `CROSSBIND_ANDROID_KEY_ALIAS` and
`CROSSBIND_ANDROID_KEYSTORE_PASSWORD` set to Google Play's upload key, the APK is signed with it and
`dist/crossbind-example-desktop-app-android.aab` is the bundle Google Play takes. Gradle runs in Docker, so no JDK or
Android SDK is needed; the Gradle project it builds stays in `dist/crossbind-example-desktop-app-android/`.

## Web

```bash
pnpm dev:web
pnpm build:web
```

serve the same page in a browser, with the C++ as WebAssembly, and write it to `dist/`. `crossbind.config.js` names no
runtime environment, so the command decides: `crossbind app` builds the app and plain Vite the web page.

## Test

`pnpm run e2e:prod` opens the built app and waits for the page to log the result; with `CROSSBIND_APP_PLATFORM=ios` it
builds the Xcode project for the Simulator and opens the app there, and with `android` it builds the Gradle project as
a debug APK and opens the app on the attached device.
