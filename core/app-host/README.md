# @crossbind/core-app-host
**crossbind app host**  
Runs the crossbind embind runtime in Hermes inside a desktop app whose page is the system webview, so the bindings
that serve WebAssembly on the web run natively in an app, behind the same page code.

<a href="https://www.npmjs.com/package/@crossbind/core-app-host">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/core-app-host/beta?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>

## Use

Add it next to `crossbind` and the Vite plugin, and mark the project as an app in `crossbind.config.js`
(`target: { runtimeEnv: 'app' }`):

```bash
pnpm add -D crossbind@beta @crossbind/plugin-vite@beta @crossbind/core-app-host@beta
pnpm crossbind app dev                   # the app on the dev server
pnpm crossbind app build                 # dist/<name>.app on macOS, dist/<name>-linux-<arch>/ on Linux
pnpm crossbind app build -p linux        # dist/<name>-linux-x64/ and -arm64/, on a Mac as well
pnpm crossbind app build -p windows      # dist/<name>-win32-x64/ and -arm64/, on a Mac or Linux as well
pnpm crossbind app build -p ios          # dist/<name>-ios/, an Xcode project
pnpm crossbind app build -p android      # dist/<name>-android.apk, and its Gradle project
```

crossbind resolves this package from your project; you never import it yourself. See the
[app reference](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md) for the page's contract, security
defaults and current limits (macOS, Linux, Windows, iOS and Android for now).

## Contents

- `cpp/` — the host's CMake project: Hermes on a thread of its own, the page's messages and `crossbind://` requests
  (`src/host_core.cpp`), what every app does around its webview (`src/app.cpp`), and the window, channels and
  navigation rule of macOS (`src/darwin/`), iOS (`src/ios/` with the WKWebView channels of `src/darwin/`, built as a
  static library for the app's Xcode project), Linux (`src/linux/`, WebKitGTK) and Windows (`src/windows/`, WebView2).
  An Android host (`src/android/jni.cpp`) is a shared library behind JNI.
- `android/` — the Gradle project an Android app is written into: its one activity (`CrossbindActivity.java`, the
  WebView, its message port and navigation rule), the manifest, and Gradle 9.8.1's wrapper (Apache-2.0), as
  `gradle wrapper` writes it; `gradle-wrapper.jar` matches the sha256 Gradle publishes for the release.
- `js/host.js` — what runs in Hermes: the embind runtime and the side of the protocol that answers the page.
- `js/page.js` — what the page loads as `crossbind.js`: `initNative()` over the webview's messages, or on Android its
  message port, the calls of `crossbind/app`, and a request left waiting for what the host pushes: the events of the
  app's C++ and the calls of the functions the page passed.
- `cpp/include/crossbind/app.h` — the host's functions for an app's own code: dialogs, opening outside the app, the
  trash, the app's folders, quitting and opening anew, events for the page and a desktop app's updates.
  `src/app_api.cpp` answers them and the page's `crossbind/app`, and each platform's `app_api` does the work, and its
  `menu` the page's menus and tray; a Linux app's tray and notifications are `src/linux/tray.cpp` and
  `notifications.cpp`, over D-Bus, and a Windows app's notifications balloons of its tray's icon;
  `src/updater.cpp` checks and installs updates, which each platform's `update` downloads, and
  `src/reopen.cpp` opens the app anew after it and `app.relaunch()`; `src/instance.cpp` (macOS and Linux) and
  `src/windows/instance.cpp` hand a later launch of an app with `app.singleInstance` to the instance that runs.
- `third_party/webview/` — webview/webview (MIT), vendored at a pinned commit; provenance and the local patch are in
  its README.
- `third_party/jsi/` — JSI's `jsi.cpp` (MIT) from the Hermes release the host links, and on Android its headers.
- `third_party/nsis/` — the license of NSIS 3.11 (zlib, and MIT for its System plugin), whose installer stub and
  plugins a Windows app's setup program carries; provenance in its README.
- `third_party/webview2/` — the license of the WebView2 SDK (BSD-3-Clause), whose headers crossbind's windows image
  carries for a Windows host.
- `third_party/monocypher/` — Monocypher 4.0.3 (BSD-2-Clause or CC0-1.0), whose Ed25519 and SHA-512 check a desktop
  app's updates; provenance in its README.

Hermes itself (MIT) is React Native's published build: on macOS and iOS downloaded once into `~/.crossbind/hermes/`
and checked against the sha256 crossbind pins, and on Android carried by crossbind's android-app image. Linux and
Windows have no published build, so crossbind's linux and windows images carry the same release built from its pinned
source.

## License

MIT
