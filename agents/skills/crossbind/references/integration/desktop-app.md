<!-- GENERATED from docs/playbooks/integration/desktop-app.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Playbook — A desktop or mobile app on crossbind's own host

> The page runs in the system webview, the bindings natively in the app's process. Reference: [`docs/api/app.md`](../../api/app.md).

Use it when a project wants a desktop, iOS or Android app without Electron or React Native: the same page and the same
`initNative()` calls as its web build, with the C++ or Rust running natively. macOS, Linux, Windows, iOS and Android for
now.

## Steps

1. The page must be a Vite app. Install the host and the plugin next to crossbind:

   ```bash
   pnpm add -D crossbind@beta @crossbind/plugin-vite@beta @crossbind/core-app-host@beta vite
   ```

2. Mark the project as an app in `crossbind.config.js` and keep the rest of the config as for the web:

   ```js
   target: { runtimeEnv: 'app' },
   ```

3. Add `viteCrossbindPlugin()` to `vite.config.js` if it is not there yet.
4. Write the page as for a worker-backed web build: `await initNative()`, then await every call. A function passed to
   the module runs in the page later, without an answer for native code. What the app's host does, the file and
   message dialogs, opening a link in the browser, the app's folders, quitting, the menus, the tray's icon, the
   system's notifications, the later launches of an app that `app.singleInstance` keeps to one instance, the links of
   `app.urlSchemes` and the events of the app's C++, the page imports from `crossbind/app` after `initNative()`; the C++
   includes the same from `<crossbind/app.h>`, but for the menus, the tray, the notifications, the launches and the
   links, and emits the events.
5. Run `pnpm crossbind app dev` to develop, `pnpm crossbind app build` to get `dist/<name>.app` and its disk image. Its
   icon comes from the square PNG `app.icon` names in `crossbind.config.js`, at best 1024 × 1024. To ship it to other
   Macs, set `CROSSBIND_APPLE_SIGNING_IDENTITY` to a Developer ID and `CROSSBIND_APPLE_API_KEY`,
   `CROSSBIND_APPLE_API_KEY_ID` and `CROSSBIND_APPLE_API_ISSUER` to an App Store Connect API key: the build then signs
   the app and Apple notarizes it. A Windows app is signed with `CROSSBIND_WINDOWS_SIGNING_STORETYPE` and the key it
   names, as `docs/api/app.md` tells.
6. For a desktop app that updates itself, run `pnpm crossbind app updater-key`: its public key goes in
   `crossbind.config.js` with the address of the updates (`app: { updater: { url, publicKey } }`), its private key in
   `CROSSBIND_UPDATER_PRIVATE_KEY` where the app is built. The build then writes each app's signed update beside it, to
   upload where `url` points, and the page calls `updater.check()` and `updater.install()` from `crossbind/app`.
7. For iOS, add `-p ios`: `crossbind app dev -p ios` opens the app in the Simulator, `crossbind app dev -p ios
   --device` on the iPhone or iPad connected, and `crossbind app build -p ios` writes the Xcode project
   `dist/<name>-ios/`. A device takes the app's Apple team in `crossbind.config.js` (`app: { team }`), a free Personal
   Team among them, and a bundle id of its own (`app: { id }`), as `docs/api/app.md` tells.
8. For Android, add `-p android`, with `adb` installed and an emulator running or a phone attached:
   `crossbind app dev -p android` opens the app on it and `crossbind app build -p android` writes
   `dist/<name>-android.apk`. For Google Play, give the app its id in `crossbind.config.js` (`app: { id }`, without
   hyphens) and set `CROSSBIND_ANDROID_KEYSTORE`, `CROSSBIND_ANDROID_KEY_ALIAS` and
   `CROSSBIND_ANDROID_KEYSTORE_PASSWORD` to its upload key: the build then also writes the bundle,
   `dist/<name>-android.aab`.

## Validation

- `pnpm crossbind app build` ends with `dist/<name>.app` and `dist/<name>.dmg`, and `open dist/<name>.app` shows the
  page. On Linux it ends with `dist/<name>-linux-<arch>/`, its `.tar.gz` and its `.deb`, and
  `dist/<name>-linux-<arch>/<name>` shows the page.
- `crossbind app build -p windows` ends with `dist/<name>-win32-<arch>/`, its `.zip` and its `-setup.exe`, whose
  `<name>.exe` shows the page on Windows.
- `crossbind app build -p ios` ends with `dist/<name>-ios/<name>.xcodeproj`, which
  `xcodebuild -project dist/<name>-ios/<name>.xcodeproj -sdk iphonesimulator build` builds with no team.
- `crossbind app build -p android` ends with `dist/<name>-android.apk`, which `adb install` puts on the emulator;
  `crossbind app dev -p android` shows the page's console in the terminal.
- With `CROSSBIND_APP_CONSOLE=1`, running `dist/<name>.app/Contents/MacOS/<name>` prints what the page logs.
- With `CROSSBIND_UPDATER_PRIVATE_KEY` set, the build also writes `dist/<name>-<platform>-<arch>.update.json` beside
  the update's file, and an app of an older version finds it with `updater.check()` once both are where its
  `app.updater.url` points.
- `crossbind licenses -e app --notices` writes the notices to ship with the app; `--platform linux`, `win32`, `ios` or
  `android` adds what that platform's app carries.

## Pitfalls

- A web build of the same project makes wasm, an app build the host: switch with `target.runtimeEnv`, or keep two
  configs.
- Navigation to another origin is refused; links the user follows open in the default browser. Embed no third-party
  page in an iframe.
- The page's `shell.openPath` opens nothing until `app.openPath` lists where it may, and its `shell.revealInFolder`
  and `shell.trash` refuse a path outside the app's folders that no dialog picked during this run, `shell.trash` one of
  the folders as well; the C++ reaches any path through `<crossbind/app.h>`.
- `crossbind app dev` and `crossbind app build` make the app of the machine they run on, macOS, Linux or Windows,
  unless `-p` names another; `crossbind app build -p linux` builds the Linux app on a Mac too, but its development
  session runs on Linux alone. A Linux app needs Docker to build and WebKitGTK 4.1 (2.40 or later) to run.
- `crossbind app build -p windows` builds the Windows app on a Mac or a Linux machine, in Docker. It runs where the
  WebView2 Runtime is, as on Windows 11; unless step 5's key signs it, SmartScreen warns about it once downloaded.
- Whoever holds `CROSSBIND_UPDATER_PRIVATE_KEY` signs updates every installed app accepts: keep it in the build's
  secrets, never in the repository. An app updates in a folder its user can change, so one in a read-only place, a
  Debian package's among them, does not update itself.
- crossbind writes the iOS Xcode project and the Android Gradle project anew on every build, so an edit made in Xcode
  or Android Studio is gone after the next one: the app's identity goes in `crossbind.config.js`.
- An Android app needs Docker alone to build: the android-app image carries the JDK, the SDK and Gradle. To run it,
  it needs `adb` and an attached device or a running emulator, and crossbind installs and starts neither. It runs on
  Android 13 or later with Android System WebView 116 or later. On an Apple silicon Mac the amd64 image runs under
  emulation, so the app reopens about 25 s after an edit to native code.

## Reference

- `examples/desktop-app/` — the template (`npm create crossbind@beta -- <dir> Desktop App`).
- `e2e/desktop-app/` — the conformance suite inside an app.
