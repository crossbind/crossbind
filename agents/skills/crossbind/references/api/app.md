<!-- GENERATED from docs/api/app.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Apps — `target.runtimeEnv: 'app'`

> An app whose page runs in the system webview and whose bindings run natively in the app's own process, with no
> Node.js and no browser engine of its own. macOS, Linux, Windows, iOS and Android for now.

The page calls the module exactly as a web build that runs its module in a worker does: `initNative()` resolves to the
module, and every call is awaited. The C++ and Rust behind it run in Hermes, inside the app, with the speed and the
system access of native code.

## Set up

```bash
pnpm add -D crossbind@beta @crossbind/plugin-vite@beta @crossbind/core-app-host@beta vite
```

```js
// crossbind.config.js
export default {
    general: { name: 'my-app' },
    target: { runtimeEnv: 'app' },
    paths: { config: import.meta.url },
};
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import viteCrossbindPlugin from '@crossbind/plugin-vite';

export default defineConfig({ plugins: [viteCrossbindPlugin()] });
```

`npm create crossbind@beta -- <dir> Desktop App` scaffolds such a project from `examples/desktop-app`.

## Develop and build

| Command | What it does |
|---|---|
| `crossbind app dev` | Builds the host for this machine and opens the app on the dev server. An edit to the page reloads it; an edit to native code, or to what the page imports from it, rebuilds the host and opens the app again. The page's console shows in the terminal, and closing the window ends the session. |
| `crossbind app build` | Builds the page and the host and writes the app with what installs it (see [Installers](#installers)): `dist/<name>.app`, signed ad hoc or with a Developer ID (see [Signing a macOS app](#signing-a-macos-app)), and `dist/<name>.dmg` on macOS; `dist/<name>-linux-<arch>/`, the same as a `.tar.gz`, and its `.deb` on Linux. |
| `crossbind app build -p linux` | Writes the Linux app for x64 and arm64, on a Mac as well: `dist/<name>-linux-x64/` and `dist/<name>-linux-arm64/`, each with its `.tar.gz` and `.deb`. A Linux app's development session runs on Linux. |
| `crossbind app build -p windows` | Writes the Windows app for x64 and arm64, on a Mac or a Linux machine as well: `dist/<name>-win32-x64/` and `dist/<name>-win32-arm64/`, each with its `.zip` and `-setup.exe`. A Windows app's development session runs on Windows. |
| `crossbind build -p host -e app` | Builds the host alone, with no page in it: `<paths.output>/<name>.darwin-<arch>.app` on macOS, `<paths.output>/<name>.linux-<arch>` and its `.tar.gz` on Linux. `-p linux` or `-p win32` builds a Linux app, or a Windows app with its `.zip`, from a Mac as well. |
| `crossbind app dev -p ios` | Builds the host for the iOS Simulator and opens the app there on the dev server: in the Simulator already booted, else in an iPhone of the newest iOS. Edits reload the page or rebuild the host as on the desktop, and ending the app in the Simulator ends the session. |
| `crossbind app build -p ios` | Builds the page and the host for devices and the Simulator and writes the app's Xcode project, `dist/<name>-ios/` (see [iOS](#ios)). |
| `crossbind build -p ios -e app` | Writes the Xcode project with no page in it: `<paths.output>/<name>-ios`, or `<name>-ios.debug` for a debug build. |
| `crossbind app dev -p android` | Builds the host for the attached Android device or emulator, installs the app as a debug APK and opens it on the dev server, which the device reaches through `adb reverse`. Edits reload the page or rebuild the host as on the desktop; the page's console shows in the terminal, and the end of the app's process, as when it is swiped away, ends the session (Back leaves the process running). crossbind starts no emulator: start one, or connect a phone with USB debugging on, and with several attached set `ANDROID_SERIAL`. |
| `crossbind app build -p android` | Builds the page and the host for arm64-v8a and x86_64, writes the app's Gradle project, `dist/<name>-android/`, and packages it: `dist/<name>-android.apk`, and with an upload key `dist/<name>-android.aab` too (see [Android](#android)). |
| `crossbind build -p android -e app` | Writes the Gradle project with no page in it: `<paths.output>/<name>-android`, or `<name>-android.debug` for a debug build. A release build packages it as `crossbind app build -p android` does. |
| `crossbind app updater-key` | Prints a new key pair for a desktop app's updates: the public key for `app.updater.publicKey`, the private one for `CROSSBIND_UPDATER_PRIVATE_KEY` (see [Updates](#updates)). |

`crossbind app` runs the project's Vite with `CROSSBIND_APP_PLATFORM` set to the platform `-p` names, `macos`, `linux`,
`windows`, `ios` or `android`; without `-p` it keeps the variable the environment sets, and without that builds this
machine's desktop app. `vite` and `vite build` take the variable as well, and Vite's own options, such as `--port` or
`--mode`, pass through `crossbind app` to Vite. A macOS or iOS build fetches Hermes once; Linux, Windows and Android
apps build in crossbind's linux, windows and android-app images, which carry what they compile and link against (see
[Hermes](#hermes)).
They need `RUNNER=DOCKER_RUN` or `DOCKER_EXEC`, and another runner stops the build before its first step.

## The page

`initNative()` and the imports from headers and crates work as in a web build with `useWorker`
([`threading.md`](./threading.md)):

- Every call, `new` and property read returns a promise.
- An object stays in the app's process; the page holds a handle, which the garbage collector releases. A page that
  replaces the page, a reload among them, frees what the previous one held.
- Vectors arrive as arrays, and a plain array passed for a vector parameter becomes one.
- Enum values keep their identity.
- An error keeps its own fields, such as `code`.
- A JavaScript function passed to the module runs in the page when native code calls it, later and without an answer
  ([Events and callbacks](#events-and-callbacks)).

`initNative({ env })` sets environment variables in the app's process. The build's env is the app's own, and a variable
the process already has keeps its value.

## The window

`app.name` in `crossbind.config.js` is the name the app shows: its window's title, its macOS menus, its Windows file
description and the label under its icon on iOS and Android; without it, the app shows `general.name`. A Windows app's
executable also carries `package.json`'s version, which Windows takes as up to four numbers from 0 to 65535 and a
prerelease part, as 1.2.3-beta.1. `app.copyright` is the line a macOS app's About panel and a Windows executable's
details show. `app.category`, one of Apple's app categories (`developer-tools`, `games`, `puzzle-games` and the rest of
`public.app-category.*`), is the one macOS shows the app under, and a Linux menu shows it under the freedesktop main
category closest to it: Development for `developer-tools`, Game for any of the games, Utility for those with none of
their own. `app.window` sizes the desktop window, and colors what the app shows behind its page:

```js
app: {
    name: 'My App',
    window: { width: 1024, height: 768, minWidth: 640, minHeight: 480, maxWidth: 1920, maxHeight: 1080, backgroundColor: '#1e1e1e' },
},
```

The sizes are the page's, in whole pixels up to 16384, whatever frame the window adds around it; a display too small for
the window holds it to its own size. The window opens at 1024 × 768 in the middle of the screen and resizes without
app.window, unless `resizable` is false, and shrinks and grows to any size without `minWidth`, `minHeight`, `maxWidth`
and `maxHeight`, which need a window that resizes. `fullscreen: true` opens it full screen, which macOS's View menu
leaves; on Windows and Linux the app gives no way out of it. An option the build cannot honour stops it, naming the
option.

`backgroundColor`, as `#rrggbb`, is what the app shows until its page paints, and behind a page without a background of
its own: in the window on the desktop, and from the launch screen on iOS and Android, where the system bars' icons turn
light on a dark color and dark on a light one. Without it, each platform shows its own.

On the desktop the page shows an element full screen with `element.requestFullscreen()`, as in a browser: the window
fills the screen until the page leaves it. On Windows and Linux a menu bar the page set stays above the element.

A macOS app opens with the app, Edit, View and Window menus every Mac app has, so ⌘C, ⌘V, ⌘Z, ⌘A, ⌘W and ⌘Q reach
it, and the page may set its own, as [Menus](#menus) tells. The
page's `alert()`, `confirm()` and `prompt()` show as they do in a browser, and so does the picker of a file input. A
download the page starts, such as an `<a download>` link, asks where to save: in a save panel on macOS, in the system's
export sheet on iOS and in its save picker on Android. On Android, Back goes back in the page's history first, and
leaves the app when there is none.

An app that cannot start, for want of the WebView2 Runtime or of a file it carries, writes why to its output; a desktop
app its user opened says so in a message box as well.

## The icon

`app.icon` names a square PNG, at best 1024 × 1024, and the build makes each platform's icon from it:

```js
app: {
    icon: 'icon.png',
},
```

- macOS: `icon.icns` in the bundle, 16 to 1024 pixels, which the Dock and Finder show as the PNG is: a Mac icon keeps
  a transparent margin of its own.
- Windows: the executable's icon, 16 to 256 pixels, which Explorer, the taskbar and the window show.
- Linux: the window's icon, 512 pixels, and the menu's, which the Debian package installs. GNOME on Wayland shows the
  menu's for the window too.
- iOS: one 1024 × 1024 image, its transparent parts white, from which Xcode makes every size and whose corners iOS
  rounds: the App Store takes no transparent icon.
- Android: an adaptive icon, the whole PNG, its margin too, in the middle two thirds of a white square, which the
  launcher shapes.

Without `app.icon` an app has the system's default icon. A path that names no square PNG stops the build. Each size is
resampled from the PNG, so a small one blurs when enlarged.

## Installers

`crossbind app build` writes what installs a desktop app beside it:

- macOS: `dist/<name>.dmg`, a disk image that holds the app beside a link to Applications, onto which its user drags
  it.
- Linux: `dist/<name>-linux-<arch>.deb`, a Debian package that puts the app in `/usr/lib/<package>`, its command in
  `/usr/bin` and its entry and icon in the menu. It depends on WebKitGTK 4.1, release 2.40 or later, and GTK 3, which
  `apt install ./<name>-linux-<arch>.deb` installs with it. The package is named after `general.name`, in lower case
  with a hyphen for each underscore, from its first letter or digit; package.json's `author` and `description` are its
  maintainer and description, and the app's name stands for both without them.
- Windows: `dist/<name>-win32-<arch>-setup.exe`, which installs the app for the user who runs it, with no
  administrator's approval, in `%LOCALAPPDATA%\Programs\<app name>`. It adds the app to the Start menu and to the apps
  Settings lists, whose Uninstall removes it again and leaves its data, and when the system has no WebView2 Runtime it
  downloads Microsoft's bootstrapper and, once it carries a valid signature of Microsoft's, runs it, which installs the
  runtime. While the app runs, an update or Uninstall asks to close it and changes nothing. `/S` installs without a
  window. NSIS, in crossbind's windows image, builds it.

The Debian package and the shortcut and folder take their names from the app's, so a `general.name` that makes no
Debian name, or an app name with any of `< > : / | ? *` or a space or dot at its end, stops `crossbind app build` before
anything compiles.

A macOS or Windows app is signed with a key in the environment, as the next sections tell. The Debian package is not
signed: apt checks the signature of a repository, not of a package.

## Signing a macOS app

`crossbind app build` signs a macOS app ad hoc, which opens it on the Mac that built it alone, and says so. With a
Developer ID it signs the app and its framework with that identity instead, in the hardened runtime, and with an App
Store Connect API key Apple also notarizes the app, whose ticket the build staples to it before it makes the disk
image: the app then opens on any Mac, offline too. The disk image stays unsigned, so that Gatekeeper judges the app in
it, which Apple has notarized. Both come from the environment alone:

| Variable | Value |
|---|---|
| `CROSSBIND_APPLE_SIGNING_IDENTITY` | A code signing identity in the keychain, by name or hash, as `Developer ID Application: <name> (<team>)`. |
| `CROSSBIND_APPLE_API_KEY` | The API key's `.p8` file, which App Store Connect gives once. |
| `CROSSBIND_APPLE_API_KEY_ID` | The key's ID. |
| `CROSSBIND_APPLE_API_ISSUER` | The issuer ID of the key's team. |

An identity the keychain does not hold, a name two of its identities share, as after a renewal, a key without an
identity or a key without all three stops `crossbind app build` before anything compiles, and so does a key beside an
identity other than a Developer ID Application one. Apple takes a few minutes to check the app, two hours at most
before the build gives up, and a rejection stops the build with Apple's log. A signed app that is not notarized opens
on another Mac only once its user allows it in System Settings, and the build says so.

## Signing a Windows app

`crossbind app build` leaves a Windows app and its setup program unsigned, so SmartScreen warns about them once they
are downloaded, and says so. With a key in the environment, jsign in crossbind's windows image signs the app before
its zip is made, and the setup program and its uninstaller as NSIS writes them, with Authenticode and a timestamp. The
key is jsign's own: a cloud's key service whose credentials jsign takes as its password, such as Azure Trusted Signing,
Azure Key Vault, AWS or Google Cloud KMS, or SSL.com eSigner, or a PKCS#12 file. Its files reach the container
read-only, and its passwords by name, never on a command line:

| Variable | Value |
|---|---|
| `CROSSBIND_WINDOWS_SIGNING_STORETYPE` | jsign's store type, as `TRUSTEDSIGNING`, `AZUREKEYVAULT`, `AWS`, `GOOGLECLOUD`, `ESIGNER` or `PKCS12`. |
| `CROSSBIND_WINDOWS_SIGNING_KEYSTORE` | The key store: the service's endpoint or name, or the PKCS#12 file. |
| `CROSSBIND_WINDOWS_SIGNING_ALIAS` | The key's name in it. |
| `CROSSBIND_WINDOWS_SIGNING_STOREPASS` | Its password, or the service's access token. |
| `CROSSBIND_WINDOWS_SIGNING_KEYPASS` | The key's password, where it is not the store's. |
| `CROSSBIND_WINDOWS_SIGNING_CERTFILE` | The certificate chain a cloud key comes without, as a `.p7b` file. |
| `CROSSBIND_WINDOWS_SIGNING_TSAURL` | The timestamp server; `http://timestamp.digicert.com` without it. |

With Azure Trusted Signing, for one:

```bash
export CROSSBIND_WINDOWS_SIGNING_STORETYPE=TRUSTEDSIGNING
export CROSSBIND_WINDOWS_SIGNING_KEYSTORE=weu.codesigning.azure.net
export CROSSBIND_WINDOWS_SIGNING_ALIAS=<account>/<profile>
export CROSSBIND_WINDOWS_SIGNING_STOREPASS="$(az account get-access-token --resource https://codesigning.azure.net --query accessToken -o tsv)"
```

A variable without the store type, a store type jsign does not take, a key file that is not there, or a hardware
token, which the container does not reach, stops `crossbind app build` before anything compiles. SmartScreen trusts a signed app as its certificate's
downloads build a reputation, so the first downloads of a new certificate may still warn.

## Updates

A desktop app updates itself from where `app.updater` says, with updates the key it names has signed:

```js
app: {
    updater: {
        url: 'https://example.com/updates/<name>-{platform}-{arch}.update.json',
        publicKey: '<what crossbind app updater-key prints>',
    },
},
```

`crossbind app updater-key` makes the key pair. The public key goes in `app.updater.publicKey`; the private one goes in
`CROSSBIND_UPDATER_PRIVATE_KEY` where the app is built, and nowhere else, as whoever has it can sign an update the app
installs. With it, `crossbind app build` writes each desktop app's update beside the app, signed with Ed25519:

- `dist/<name>-<platform>-<arch>.update.json`, the manifest: package.json's version, the update's file and its
  signature.
- The file: on macOS `dist/<name>-darwin-<arch>.app.zip`, the app as signed and notarized, zipped with ditto; on Linux
  the app's `.tar.gz`; on Windows its setup program.

Both go where `app.updater.url` points, with `{platform}` as `darwin`, `linux` or `win32` and `{arch}` as `x64` or
`arm64`, and the file beside the manifest. The page asks for an update and installs it when it decides to, as once its
user agrees; the host asks no one:

```js
import { updater } from 'crossbind/app';

const update = await updater.check();
if (update && confirm(`Install ${update.version}?`)) await updater.install();
```

`updater.check()` gives `{ version }` when the manifest's version is newer than the app's, as semver orders them, and
`null` otherwise. `updater.install()` downloads the file into the app's cache folder and installs it only when the
signature covers the app's id, its platform and architecture, its version and its SHA-512. The app then quits and
opens the new version, so it saves what it needs first; the promise rejects when installing fails. One check or
install runs at a time, and another rejects meanwhile. A manifest past 64 KiB or a file past 2 GiB fails.

- macOS: the bundle in the zip takes the app's place, and opens.
- Linux: the folder in the archive takes the app's place, and its executable opens.
- Windows: the setup program waits up to 30 seconds for the app to quit, installs the update in the app's folder and
  opens it, or opens the app as it was once it has waited in vain.

An app signed for its platform holds an update to its own signer as well, so that the updater's key alone installs
nothing else. On macOS, as Sparkle does, the bundle in the zip meets the requirement the app's own signature states,
which for a Developer ID names its identifier and team. On Windows the setup program carries an Authenticode signature
Windows trusts, whose certificate has the common name of the app's own: a name, which any authority Windows trusts may
certify for whoever it finds holds it. A renewed certificate keeps the team and the common name, so its updates
install. Windows checks no revocation for them. An app signed ad hoc or not at all, and a Linux app, which no signature
names, take any update the key signed; a Windows app signed with a certificate Windows does not trust, as a
self-signed one, installs none and says why.

On macOS and Linux the app's folder swaps the app for its update in one step, which local file systems such as APFS
and ext4 do; where it cannot, as on a network share, the update fails and leaves the app as it is. An app updates where
its user can change it, too: a macOS app opened from its disk image, or from where it was downloaded to, updates once
it is moved to Applications, and a Linux app installed from its Debian package updates with the package manager. The
C++ of an app calls the same as `crossbind::app::checkForUpdate()` and `crossbind::app::installUpdate()`, which wait
for the download. An iOS or Android app updates through its store, and `updater.check()` rejects there.

An `app.updater.url` that is neither https nor http on localhost or names no manifest, a public key that is none or
one anyone can forge signatures for, a package.json version that is not semver, and a private key that is not the
public key's pair stop `crossbind app build` before anything compiles. The host checks signatures with Monocypher,
which it compiles in.

## The app's functions

The page imports what the app's host does for it from `crossbind/app`. The app's C++ calls the same, but for
`menu.set`, `app.launchUrls` and `events.on`, through `<crossbind/app.h>`, which an app's own code finds as it builds,
with `CROSSBIND_APP` defined:

```js
import { app, dialog, shell } from 'crossbind/app';

const file = await dialog.save({ defaultName: 'report.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
if (file) await Native.exportReport(file);
const { data, cache, logs } = await app.paths();
```

```cpp
#ifdef CROSSBIND_APP
#include <crossbind/app.h>

std::string databasePath() { return crossbind::app::paths().data + "/notes.sqlite"; }
#endif
```

| Function | What it does | macOS, Linux, Windows | iOS | Android |
|---|---|---|---|---|
| `dialog.open({ title, defaultPath, filters, directory, multiple })` | The paths of the files or folders its user picks, or `null` | ✓ | | |
| `dialog.save({ title, defaultPath, defaultName, filters })` | The path its user chooses to save to, or `null` | ✓ | | |
| `dialog.message({ message, detail, kind, buttons })` | The index of the button its user clicks | ✓ | ✓ | ✓ |
| `shell.openExternal(url)` | An http, https or mailto address in the default browser or mail app | ✓ | ✓ | |
| `shell.openPath(path)` | A file in the app the system opens its kind with | ✓ | | |
| `shell.revealInFolder(path)` | A file, selected, in the system's file manager, or on Linux without one its folder | ✓ | | |
| `shell.trash(path)` | Moves a file or folder to the system's trash, and nothing where it has none | ✓ | | |
| `app.paths()` | `{ data, cache, logs }`, the app's own folders, made if missing | ✓ | ✓ | ✓ |
| `app.quit()` | Ends the app as closing its window does | ✓ | | |
| `app.relaunch()` | Ends the app as `app.quit()` does, then opens it anew with no link | ✓ | | |
| `app.launchUrls()` | The links of `app.urlSchemes` that opened the app and have not reached the page yet; the page alone | ✓ | ✓ | ✓ |
| `menu.set(menus)` | Sets the app's menus, whose clicks are the event `menu`; the page alone | ✓ | | |
| `events.on(name, listener)` | Calls `listener` with each event of this name the app's C++ emits; returns what stops it | ✓ | ✓ | ✓ |
| `updater.check()` | `{ version }`, the newer version `app.updater.url` offers, or `null` | ✓ | | |
| `updater.install()` | Installs that version once its signature holds, then quits the app and opens the new one | ✓ | | |

In the page each returns a promise once `initNative()` has run, as what it loads carries the calls to the host, but
`events.on`, which returns at once what stops it and throws where it cannot listen; in C++ each waits for its answer,
a dialog for its user's, but `emitEvent`. A function a platform has not got rejects, or throws, saying so, and in a web
or Node.js build every one fails. `app.relaunch()` opens the app anew as a fresh launch: on macOS and Linux once it has
ended, on Windows as it ends, where an app `app.singleInstance` keeps to one instance hands the new one its place once
it has. A Linux app opens with the command that started it. A development session refuses it, as its dev server opened
the app. A filter's extensions go with or without their dot, `"*"` for any
file, paths are absolute, and an option the page misspells fails before the host sees it. The dialogs are modal: to the
app on macOS, to its window elsewhere; one shows at a time, and another rejects while it does.

A message dialog shows `message`, `detail` in smaller text under it, and one to three `buttons`, or OK without them,
and answers the index of the button its user clicks:

```js
const choice = await dialog.message({
    message: 'Save changes to report.csv?',
    detail: "Your changes are lost if you don't save them.",
    kind: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
});
if (choice === 0) await Native.saveReport();
```

Return clicks the first button, the default. Escape, closing the dialog, Android's Back and a tap outside it give the
last, which iOS and Android place where their apps put Cancel: the choice that changes nothing goes last. macOS takes
Escape for two buttons or more. Windows shows the buttons in their order, the other platforms as their own dialogs
place them, and Android shows the message and the detail as one text. `kind` is `info`, the default, `warning` or
`error`: Windows shows its icon for each, and macOS a caution sign for `error`; Linux, iOS and Android show none.

The page's `shell.openPath` opens files where `app.openPath` in `crossbind.config.js` lets it alone, and nowhere
without it: in `data`, `cache` or `logs`, the app's folders, and in `picked`, what a dialog picked during this run, a
picked folder with what is in it. Opening a program runs it, and a script that found its way into the page could
name any path: list no folder the module writes a file to that the page names or fills. Its `shell.revealInFolder`
shows the app's folders and what a dialog picked during this run, and its `shell.trash` moves what is in the app's
folders, but none of the folders, and what a dialog picked during this run, both where the path is written and where
the links of the folders above it lead. A path the page names holds no `.` or `..`, as the system follows a link before
one elsewhere than the path reads. Where the system has no trash, as on a network share, the file stays and the call
rejects: Windows would delete it for good, and crossbind stops it. The app's C++ reaches any path. It calls these
functions once the module has started and never on the app's main thread, which the dialogs and the functions that
open something wait for: called before that, as from a static initializer, or once the app quits, they throw.

On the desktop the folders take the name of `app.id`: under `~/Library` on macOS, under `$XDG_DATA_HOME`,
`$XDG_CACHE_HOME` and `$XDG_STATE_HOME` on Linux, and under `%APPDATA%` and `%LOCALAPPDATA%` on Windows. An iOS
app's are its own `Library/Application Support`, `Library/Caches` and `Library/Logs`, and an Android app's its
`files`, `cache` and `files/logs`. A Windows page's own storage and cache, WebView2's profile, are in
`%LOCALAPPDATA%\<app.id>\WebView2`; those of an app an earlier crossbind built, under `%APPDATA%\<name>.exe`, move
there when it first opens, or stay in use where they are when they cannot move, as from a roaming folder on another
drive.

## Events and callbacks

Native code reaches the page in two ways, each one way.

A function the page passes to the module, such as a progress callback, runs in the page when native code calls it:

```js
await Native.exportReport(file, (done) => { progress.value = done; });
```

The call reaches the page later. Native code goes on at once and gets `undefined` for an answer, so pass a function
where native code calls one whose answer it does not use, such as an `emscripten::val`, a Rust `JsFunction` or a
`void` callback. Native code calls it on the module's thread, as any JavaScript value; another thread emits an event
instead. The calls run in the order native code made them, perhaps after the call that passed the function returns,
and an error one throws reaches the page as an uncaught one. Their arguments arrive as results do, numbers, strings and
arrays as copies; a pointer, such as the one a C callback gets for its buffer, may point at nothing by the time the
page reads it. Native code may keep the function and call it again, and the page lets go of it once native code has.

An event the app's C++ emits reaches the page's listeners of it, with the value its JSON text holds:

```cpp
crossbind::app::emitEvent("progress", "{\"done\":0.5}");
```

```js
import { events } from 'crossbind/app';

const stop = events.on('progress', ({ done }) => { progress.value = done; });
```

`emitEvent` waits for nothing, so any thread may call it, and events of the module's thread keep their order among the
calls of the page's functions. A page gets the events emitted once its first `events.on`, or the first function it
passes, has reached the host: a call of the module it makes after either comes later. Text that is no JSON reaches no
page, and the app's output says why. Both travel with the page's other messages, on every platform an app runs on.

A desktop page hears of the system going to sleep as the event `suspend`, and of its waking as `resume`, both without a
value: macOS tells the app through NSWorkspace, Linux through logind on the system bus, and Windows through its window.
The system sleeps without waiting for the page, which may not run before it does; a Windows machine with Modern
Standby may tell neither, and a Linux system without logind none.

```js
events.on('resume', () => reconnect());
```

## Menus

The page sets the app's menus while it runs, and hears of their clicks as the event `menu`:

```js
import { events, menu } from 'crossbind/app';

await menu.set([
    { label: 'File', items: [
        { label: 'Open…', id: 'open', accelerator: 'CmdOrCtrl+O' },
        { type: 'separator' },
        { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', items: [{ label: 'Sidebar', id: 'sidebar', checked: true, accelerator: 'F9' }] },
    { role: 'windowMenu' },
]);
events.on('menu', ({ id, checked }) => {
    if (id === 'open') openFile();
    if (id === 'sidebar') sidebar.hidden = !checked;
});
```

A menu is `{ label, items }`, or a standard one by its role, `editMenu` or `windowMenu`, which a label may rename. An
item is `{ label, id, accelerator, enabled, checked }`, a submenu `{ label, items }`, `{ type: 'separator' }`, a
standard menu, or a standard item by its role, which a label may rename: `undo`, `redo`, `cut`, `copy`, `paste` and
`selectAll`, which keep the platform's keys, and `minimize`, `close` and `quit`, whose accelerator the page may change.
A click of an item with an id is the event `menu` of `{ id }`, or of `{ id, checked }` for an item with `checked`,
which the click turns over first; a standard item does what its role says, and the page hears nothing of it. An
accelerator is a key with `CmdOrCtrl`, `Ctrl` or `Alt`, and maybe `Shift`, joined by `+`, as `CmdOrCtrl+Shift+O` is,
or one of `F1` to `F12`, alone or with any of them. The key is a capital letter, a digit, a function key or one of
`Enter`, `Escape`, `Tab`, `Space`, `Backspace`, `Delete`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `PageUp`,
`PageDown`, `Plus`, `Minus`, `Comma` and `Period`, and `CmdOrCtrl` is ⌘ on macOS and Ctrl elsewhere. A menu the page
gets wrong fails before the host sees it, naming the item.

Each call replaces the menus the last one set, so the page changes an item by setting them all again. On macOS they
follow the app menu, which the app keeps with its ⌘H, ⌥⌘H and ⌘Q, in place of the Edit, View and Window menus it
opens with: ⌘C, ⌘V, ⌘Z and ⌘A reach the page through `editMenu` or the editing items alone, and ⌘M and ⌘W through
`windowMenu` or `minimize` and `close`. On Windows and Linux they are a bar in the window, above the page, which keeps
its size, as the window grows by the bar's height unless it fills the screen; `editMenu` and `windowMenu` are there the
standard items of that platform's apps, and `menu.set([])` takes the bar away. iOS and Android apps have no menu bar,
and `menu.set` rejects there. The event `menu` is the menus' alone: the app's C++ sets no menus, and the events it
emits, one of which the page may set them on, go by other names.

## One instance

`app.singleInstance` keeps a desktop app to one instance for each user:

```js
app: {
    singleInstance: true,
},
```

A later launch, as when its user opens the app again, hands its arguments and the folder it was launched in to the
instance that runs, and leaves with exit status 0 before it opens a window or starts the module; static initializers of
the app's code run in it all the same. The instance brings its window to the front, restored if it was minimized, as
far as the system lets it, and its page hears of the launch as the event `second-instance`:

```js
import { events } from 'crossbind/app';

events.on('second-instance', ({ args, cwd }) => {
    if (args.length > 0) openFiles(args, cwd);
});
```

`args` leaves out the program's own path, and a relative one resolves against `cwd`. They are whatever the launch was
given, so the page takes them as it would any command line. The first launch's own arguments do not reach the page,
but for its links of `app.urlSchemes`, as [Links](#links) tells. A
launch that arrives before the page listens still brings the window to the front, and its event reaches no page. The
event `second-instance` is the host's alone: the app's C++ emits others.

On macOS and Linux only a launch by the same user reaches the instance, and on Windows any launch in the same signed-in
session. A launch that comes while the instance quits waits for it to end, ten seconds at most, and becomes the next
instance. One the instance does not take in that time, as when it has stopped answering, leaves with exit status 1 and
says why, in a message box as well when its user opened it; where the app cannot make its lock, it runs as one more
instance and says so. On Linux, Wayland and
some window managers bring the window forward only for a launch that carries an activation token or a startup id, as a
desktop's launcher gives it; a terminal's launch carries none. On macOS, Finder, the Dock and `open` bring the app that
runs to the front themselves, so only a launch that starts the program anew, as a terminal or `open -n` does, reaches
it. A development session keeps one instance of its own, apart from the built app. iOS and Android keep every app to
one instance themselves.

## Links

`app.urlSchemes` names the schemes whose links open the app, as `myapp://open?id=7` does. A scheme is a lowercase
letter, then lowercase letters, digits, `+`, `-` and `.`, and none the web or the system owns, such as `http` or `file`:

```js
app: {
    urlSchemes: ['myapp'],
},
```

The page asks for the links that opened the app, the one it was launched with among them, with `app.launchUrls()`, and
from then on hears of each as the event `open-url` while it listens:

```js
import { app, events } from 'crossbind/app';

events.on('open-url', ({ url }) => show(new URL(url)));
for (const url of await app.launchUrls()) show(new URL(url));
```

Each link reaches the page once. The host keeps it until the page has asked since it loaded, and `app.launchUrls()`
hands over what it kept, so listening first, then asking, misses none. A link that comes while the page does not
listen, or whose event a reload cut off, waits for the page's next `app.launchUrls()`. The host keeps 1,000 links at
most, and drops a link longer than 64 KiB, saying so in the app's output. A link is whatever the system hands the app, so the
page takes it as it would any address from outside; macOS hands characters beyond ASCII over percent-encoded, Windows
and Linux as the link that opened the app has them. The event `open-url` is the host's alone: the app's C++ emits
others.

The app as built tells each system its schemes:

- macOS: its Info.plist. A development session's app claims none, so the built app, of the same id, keeps them.
- iOS: its Info.plist. iOS can ask its user before a link from outside opens the app, as it does for
  `xcrun simctl openurl`.
- Android: its activity's intent filter. The activity is its task's one, so a link that comes while the app runs reaches
  its page.
- Windows: the setup program registers each scheme for its user, under `HKEY_CURRENT_USER\Software\Classes\<scheme>`.
  An update removes a scheme of the app that the new release no longer lists, and the uninstaller every one the app
  still owns. A name Windows gives a file type or another class that is no scheme keeps what it opens, as the setup
  program says. The zip registers none.
- Linux: the Debian package's desktop entry, with `x-scheme-handler/<scheme>` among its MIME types, which the system's
  MIME tools take in as the package installs. The tar.gz registers none.

A link starts a Windows or Linux app again, with the link as its argument, so `app.urlSchemes` keeps a Windows or Linux
app to one instance unless `app.singleInstance` is `false`: the launch reaches the app that runs as
[One instance](#one-instance) tells, as the event `second-instance` too. macOS hands a link to the app that runs, and
brings its window to the front.

## Devices

The page reaches the camera, the microphone and the location through the web's own APIs, `getUserMedia()` and
`navigator.geolocation`, for those `app.permissions` lists, each with the reason for it:

```js
app: {
    permissions: {
        camera: 'To scan barcodes',
        microphone: 'To record voice notes',
        location: 'To find the nearest store',
    },
},
```

The build writes them where each platform reads them: the reasons into the Info.plist of a macOS or iOS app, the
devices into the entitlements a macOS app's signature claims and into an Android app's manifest. The page gets a device
it asks for once the system's user gives it: macOS and iOS ask the first time, with the reason, and so does Android,
without it; on Windows and Linux the page gets it at once. The webview asks nothing of its own, and the page gets no
device the list leaves out, nor does a frame of another origin on Android, which lets the page hold one. Without its
reason, WebKit gives a macOS page no camera or microphone at all.

macOS asks for the app that opened on its own, from the Finder, the Dock or `open`. An app a terminal or an editor
starts, as `crossbind app dev` does, is theirs to macOS, which asks for their permission instead. WebKit gives a macOS
page no location of its own, so the host answers the top frame's `navigator.geolocation` from CoreLocation, which
asks with the reason; a frame inside the page gets none there.

## What the app holds

```
<name>.app/Contents/
├── Info.plist                    CFBundleIdentifier dev.crossbind.<name>
├── MacOS/<name>                  the window, the webview, Hermes and the bindings
├── Frameworks/hermesvm.framework
└── Resources/
    ├── icon.icns                 the icon, with app.icon
    ├── host.hbc                  the embind runtime and the protocol, as Hermes bytecode
    ├── page/                     what Vite built, served at crossbind://app/
    └── data/                     the packages' data (CROSSBIND_DATA_PATH)

<name>-linux-<arch>/
├── <name>                        the window, the webview, Hermes and the bindings, in one executable
└── resources/                    host.hbc, page/ and data/, as on macOS, and icon.png with app.icon

<name>-win32-<arch>/              as on Linux, with <name>.exe, which carries the icon

<name>-ios/                       an Xcode project, written anew on every build
├── <name>.xcodeproj
├── main.m                        calls the app, which comes prebuilt
├── Info.plist
├── Assets.xcassets/              the icon, with app.icon
├── lib/iphoneos/, lib/iphonesimulator/
│                                 the host and the archives it links, for each SDK
├── Frameworks/hermesvm.xcframework
└── app/                          host.hbc, page/ and data/, copied into the app's bundle

<name>-android/                   a Gradle project, written anew on every build
├── settings.gradle, build.gradle, gradlew and gradle/
│                                 the Android Gradle plugin and Gradle 9.8.1's wrapper
└── app/
    ├── build.gradle              the app's id, version and ABIs, and Hermes and androidx.webkit from Maven
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/dev/crossbind/app/CrossbindActivity.java
        │                         the WebView, its message port and navigation rule
        ├── jniLibs/<abi>/        the host, JSI, the NDK's libc++ and the packages' shared libraries
        ├── res/mipmap-*/         the icon, with app.icon
        └── assets/app/           host.hbc, page/ and data/, copied out to the app's files when it first starts

<name>-android.apk                the release APK Gradle makes of it, and <name>-android.aab with an upload key
```

The sample app is 6.7 MB on disk and 1.8 MB zipped (arm64): a 0.8 MB host and a 6 MB Hermes. It shows its first
native result 0.34 s after launch on an M-series Mac. A Linux app links Hermes into its executable and runs on the
system's WebKitGTK. A Windows app links it in too and runs on the system's WebView2: the sample's executable is 4.6 MB
on x64, 1.8 MB zipped, and 4.1 MB on arm64, 1.6 MB zipped. Built for iOS devices, the sample is 4.7 MB, 1.3 MB
zipped: a 1.3 MB executable and a 3.3 MB Hermes.
The sample's Android release APK is 14.8 MB with both ABIs: each ABI's libraries take 5.5 MB of it (Hermes 2.4 MB, the
NDK's libc++ 1.4 MB, the host 1 MB), and the Java side 2.9 MB, which R8, off by default, would shrink. Google Play
delivers one ABI.

## Security

- The webview loads `crossbind://app` alone, in any frame; during development, the dev server too. A frame from
  another origin would reach the module's channel and its `crossbind://` requests, so none is loaded. A link the user
  follows to another page opens in the default browser, and any other navigation away is refused.
- The host gives the top frame of its page a token, and every message to the module and every call that travels as a
  `crossbind://` request carries it. Markup, such as an image, a frame from another origin and a sandboxed frame
  cannot read it, so none of them reaches the module. On macOS, iOS and Windows the channel also checks the sender's
  origin, which WebKitGTK does not tell.
- Responses from `crossbind://` let another origin read them only during development, when the page comes from the
  dev server.
- The app's functions (`crossbind/app`) travel with the same token, so the top frame of the page reaches them, and so
  does a frame of the page's own origin, which can read the top frame's globals: the page and such frames are the
  app's own code. `shell.openExternal` opens http, https and mailto addresses alone, the page's `shell.openPath` opens
  files where `app.openPath` lets it alone, nowhere by default, and its `shell.revealInFolder` shows the app's folders
  and what its dialogs picked alone. Its `shell.trash` moves what is in those, none of the app's folders itself, and
  checks where the links of the folders above a path lead as well, as the system's trash follows them; nothing goes
  where no trash keeps it. Each takes a path without `.` or `..`.
- Only the debug host the dev server opens reads `CROSSBIND_APP_URL`; a release build always loads its own page.
- An update installs only when the key of `app.updater.publicKey` signed it, over the app's id, its platform and
  architecture, its version and its file. A server can offer any version to `updater.check()`, and can serve an older
  signed update that is still newer than the installed app, but it installs nothing unsigned, nothing built for another
  platform, and no other app the same key signs. Whoever holds `CROSSBIND_UPDATER_PRIVATE_KEY` can sign any update, so
  it stays where the app is built; a macOS or Windows app signed for its platform also takes an update only from its
  own signer, as [Updates](#updates) tells.
- A desktop page reads the clipboard on its user's gesture alone, as a click: on Windows with no question of
  WebView2's, on macOS once its user picks WebKit's Paste, and on Linux as WebKitGTK asks the app host, which lets it.
  A read without a gesture gets nothing. On Linux a page's script writes to the clipboard on its user's gesture alone.
- A Windows app loads the system DLLs it imports from System32 alone, from Windows 10 1607 on, so a file of their name
  in its folder, as in one it was downloaded to, does not run in it. Its setup program runs the WebView2 bootstrapper
  it downloads only with a valid signature of Microsoft's, which PowerShell checks.
- On Android the page comes from `https://appassets.androidplatform.net`, which the app serves from its files, and
  the top frame loads that origin alone. Android does not let an app refuse a frame's page, but no frame reaches the
  module: calls and their bytes travel over a message port the app hands the top frame alone, with the token, and
  the app's origin answers no request for them. Any app can start an activity with extras, so a debug Android app
  opens a dev server on the device alone, and only a debuggable one writes its console to logcat.

## iOS

An iOS app is an Xcode project crossbind writes anew on every build, with the app prebuilt in it, so there is nothing
in it to edit: what would change it comes from `crossbind.config.js`.

```js
app: {
    id: 'com.example.myapp', // the bundle id; dev.crossbind.<name> without it
    team: 'ABCDE12345',      // the Apple team that signs the app; XCODE_DEVELOPMENT_TEAM of ~/.crossbind.json without it
},
```

Open `dist/<name>-ios/<name>.xcodeproj` in Xcode to run the app on a device or to archive it for TestFlight and the App
Store; Xcode signs it for the team. The version is the project's `package.json` version without its prerelease part,
as Apple takes numbers alone. A build for the Simulator
needs no team: `xcodebuild -project dist/<name>-ios/<name>.xcodeproj -sdk iphonesimulator build`.

## Android

An Android app is a Gradle project crossbind writes anew on every build, with the host prebuilt in it for arm64-v8a
and x86_64, so there is nothing in it to edit either.

```js
app: {
    id: 'com.example.myapp', // the application id; dev.crossbind.<name> without it, with _ for each -
},
```

`crossbind app build -p android` packages it in crossbind's android-app image, with no network: the release APK,
`dist/<name>-android.apk`, and with an upload key also the bundle Google Play takes, `dist/<name>-android.aab`.
Without one, the APK is signed with this machine's debug key, which installs it for testing (`adb install`), and the
build says so. The upload key comes from the environment alone, so no secret reaches a file:

| Variable | Value |
|---|---|
| `CROSSBIND_ANDROID_KEYSTORE` | The keystore that holds the upload key. |
| `CROSSBIND_ANDROID_KEY_ALIAS` | The key's alias in it. |
| `CROSSBIND_ANDROID_KEYSTORE_PASSWORD` | The keystore's password. |
| `CROSSBIND_ANDROID_KEY_PASSWORD` | The key's password, when it is not the keystore's. |

The keystore reaches the container read-only and the passwords by name, never on a command line. A keystore without
its alias and password stops the build, and so does an alias or a password without a keystore. Android Studio makes
an upload key, and so does the `keytool` of any JDK. The Gradle project stays in `dist/<name>-android/`, which
Android Studio opens too. The version name is the project's `package.json` version; the version code is made from its
numbers, major × 1,000,000 + minor × 1,000 + patch, so the prereleases of one version share it.

The image carries a JDK, the Android SDK platform and build tools, Gradle and every Maven artifact the build takes,
Hermes' `hermes-android` and androidx.webkit among them, each checked against its sha256, so a build needs no JDK or
Android SDK on the machine and fetches nothing. Gradle's caches and the debug key stay in `~/.crossbind/android/`: the
next build reuses them, and an app signed with the same debug key installs over the last. The host builds in the same
image, as a package's Android libraries do in the android image it adds to, so it needs Docker (`RUNNER=DOCKER_RUN`
or `DOCKER_EXEC`).

`crossbind app dev -p android` keeps one container of the image for the session, whose Gradle daemon packages each
build, and removes it when the session ends. The image is amd64 only, as the android image is, so it runs under
emulation on an Apple silicon Mac: there the conformance app reopened about 25 s after an edit to its native code, and
its page reloaded within 2 s of an edit. The app reaches the device through this machine's `adb`, from `PATH` or the
Android SDK, which crossbind does not install: `brew install --cask android-platform-tools` on macOS,
`sudo apt install adb` on Debian and Ubuntu, or Android Studio's. An app the device already has under another key,
such as the one Google Play installed, cannot be updated; crossbind names the `adb uninstall` that removes it, with
its data, and leaves running it to you.

## Hermes

The host runs React Native's Hermes, release `250829098.0.17`, on every platform. For macOS and iOS the first build
downloads the release for Apple platforms from Maven Central into `~/.crossbind/hermes/` and checks it against the
sha256 crossbind pins. Android, Linux and Windows apps take it from the image they build in. The android-app image
carries the same release's `hermes-android` AAR, whose headers the host compiles against and whose `libhermesvm.so`
Gradle packages, and the release's `hermesc`, which compiles the host bundle.

Linux has no published Hermes, so the linux image carries the same release built from its source, pinned by sha256,
for x64 and arm64. A Linux host builds in that image with its static libc++, against the WebKitGTK 4.1 headers and
libraries of Ubuntu 22.04's packages, which the image carries too, each checked against the sha256 crossbind pins
(`tooling/docker/webkitgtk-sysroot.txt`); the app itself runs on the system's WebKitGTK.

Windows has none for llvm-mingw either, so the windows image carries the same release built from its source with
llvm-mingw, for x64 and arm64, and the headers of Microsoft's WebView2 SDK, release `1.0.4258.31`, both pinned by
sha256. A Windows host builds in that image into one executable, with llvm-mingw's libc++ and the mingw-w64 runtime
linked in and no DLL beside it: webview/webview loads the system's WebView2 Runtime itself.

`crossbind licenses -e app` lists what the app carries beside its packages: crossbind's runtime, Hermes, JSI's
`jsi.cpp` from the same release and webview/webview, each with its version, its sha256 and its license text; with
`--platform linux`, the Hermes source and the libc++ a Linux app links; with `--platform win32`, the Hermes source, the
WebView2 SDK and the llvm-mingw and mingw-w64 runtimes a Windows app links, whose notices its build copies out of the
image, and the NSIS its setup program carries; with `--platform ios`, no webview/webview, which an iOS app does not use; with `--platform android`, Hermes'
AAR, the fbjni and androidx.webkit Gradle adds and the NDK's libc++ the app carries. `--notices` writes them to a file
to ship with the app.

## Environment variables of the app

| Variable | Effect |
|---|---|
| `CROSSBIND_APP_URL` | Opens this page instead of `crossbind://app/`, in a debug build only; the Vite plugin sets it to the dev server. |
| `CROSSBIND_APP_CONSOLE` | Writes the page's console and uncaught errors to the app's output; on during development. A Windows app has no console of its own, so it writes only to an output that is redirected, as a development session's is. With it, an app that cannot start says why in its output alone, without a message box. |

An Android app takes them as its activity's string extras (`adb shell am start --es CROSSBIND_APP_CONSOLE 1 …`) and
writes to logcat, under the tag `Crossbind`: the URL only on `localhost`, and the console only in a debuggable app.

## Limits

- macOS 11 or later, built on macOS.
- Linux: a glibc system with WebKitGTK 4.1, release 2.40 or later (`libwebkit2gtk-4.1-0` on Debian and Ubuntu),
  measured on Ubuntu 22.04. A Linux app builds in crossbind's linux image, so it needs Docker (`RUNNER=DOCKER_RUN` or
  `DOCKER_EXEC`), on a Mac as well.
- Signing with a Developer ID and notarizing have not been run with a real Developer ID yet. The app runs in the
  hardened runtime, measured with an ad hoc signature without library validation, which a Developer ID passes when the
  app and its framework carry the same team.
- Windows, x64 and arm64, with the WebView2 Runtime, which Windows 11 includes; measured on GitHub's Windows Server
  2025 runner with WebView2 154 and its Windows 11 arm64 runner with 155. A Windows app builds in crossbind's windows
  image, so it needs Docker (`RUNNER=DOCKER_RUN` or `DOCKER_EXEC`), on a Mac or a Linux machine as well. Building
  one or developing it on a Windows machine has not been measured yet.
- Signing a Windows app has been measured with a throwaway PKCS#12 key, whose signatures and timestamp on the app, its
  zip's copy and the setup program jsign reads back; not yet with a cloud's key service. Windows itself checks them,
  and the uninstaller's, in CI alone.
- The Windows setup program runs in CI on x64 and arm64: it installs the app with `/S`, the app it installed passes the
  conformance runs, `/UPDATE` waits for the app to quit and opens it again, and the uninstaller takes the app, its
  shortcut, its entry in Settings and its scheme. Its install of the WebView2 Runtime, for a system that has none,
  cannot be measured on the Windows machines crossbind is tested on, which have the runtime. The check of the
  bootstrapper's signature it runs first runs in CI on its own, as the setup program's script states it, on
  Microsoft's bootstrapper and on files it refuses.
- A desktop page's read of the clipboard without a gesture gets nothing in the conformance runs on Windows, macOS and
  Linux. On macOS 27 it got nothing with WebKit's DOM paste setting on as well, so that run does not show what the
  setting let through. One on a click reads it in CI on Windows alone, through WebView2's DevTools; on macOS and
  Linux, where it waits on WebKit's Paste menu or WebKitGTK's request, it has not been measured, nor has an answer an
  earlier crossbind left in a Windows profile, which the app forgets.
- The updater's hold on an update to the app's signer has been measured on macOS with two self-signed identities: an
  app signed with one took a bundle it signed and refused one the other signed and one signed ad hoc, and an app signed
  ad hoc took all three. On Windows the conformance runs in CI trust the build's throwaway key and check that an update
  without its signature is refused for want of it; a setup program by the same signer passing has not been run.
- On the desktop, one window.
- `app.window`'s place, limits and full screen have been measured on macOS, and on Linux under Xvfb with openbox, for a
  window that resizes and one that does not: an element's full screen, which Escape leaves, and `fullscreen: true`. A
  Wayland compositor places a window itself, and with WebKitGTK before 2.44 a window that opened full screen leaves it
  when an element does. The background has been measured on macOS, Linux, iOS and Android. On Windows the conformance
  runs check that the page may show an element full screen, and that a window filling its screen covers it again after
  the message of a new scale, which the runs send it as Windows would; the rest is built there, not measured yet.
- Devices have been measured on Linux, with WebKitGTK's mock devices; on an Android emulator, with its questions
  answered both ways, with a page that asks for a device the app does not list, and with a frame of another origin; in
  the iOS Simulator, which asks for the location with the reason and gives the camera and the microphone at once; and
  on macOS, whose questions named the app and its reasons when `open` started it, and the terminal when the terminal
  did, and were answered both ways. The conformance runs check on every platform that the page has `getUserMedia()`;
  Windows has not been measured yet. Before iOS 27, WebKit asks for the location through a selector Apple does not
  publish, which only an app that lists the location answers; App Store review of one has not been tried. Linux takes
  the location from GeoClue, which the system has to run. On macOS the system's question for the location, with the
  app's name and reason, has been measured; a position reaching the page has not, as the Mac it ran on found none, nor
  did its Maps.
- One instance has been measured on macOS and Linux: the hand-over, and the window coming back to the front from
  minimized. On Windows the conformance runs in CI check the hand-over alone.
- Links have been measured on macOS, from the command line and as the Apple Events `open -a` sends, to a launch and to
  the app that runs; on Linux from the command line, and the Debian package's scheme as `xdg-mime` reports it; on an
  Android emulator, to the app that runs. On Windows the conformance runs in CI check links from the command line and
  the command the setup program registers for the scheme, not a link the system opens. On iOS the app is built with its
  scheme, and no run answers the question iOS asks before a link opens it.
- The functions the page passes have been measured on macOS and Linux, and the events of C++ on macOS alone; on
  Windows, iOS and Android the conformance runs in CI check the functions.
- On macOS the file dialogs, `shell.revealInFolder`, `app.paths` and `app.quit` have been measured, and so has
  `shell.openExternal` refusing other addresses; `shell.openExternal` opening one and `shell.openPath` opening a file
  have not. On Linux and Windows the file dialogs, `shell.openExternal` opening an address, `shell.openPath`,
  `shell.revealInFolder` and `app.quit` are built, not measured yet.
- The conformance runs of the desktop apps, in CI and installed, move a file of the data folder to the trash and find it
  gone, see the page refused a path outside the app's folders, a folder of them and one with `..`, and relaunch the app,
  which must leave with 0 and open anew. A file on a drive or mount without a trash has not been tried. On Windows the
  runs tell the window the system sleeps and wakes, as Windows does, and the page hears both; the sleep of a macOS or
  Linux system has not been measured.
- Message dialogs have been measured from the page and from C++: on macOS, and on Linux under Xvfb with openbox, with
  their buttons, Return and Escape; in the iOS Simulator with their buttons; on an Android emulator with their buttons,
  Back and a tap outside. On Windows the conformance runs in CI check that the host refuses one no platform shows; the
  dialog itself is built there, not measured yet.
- The icon has been seen in macOS's Finder, in the icon files of an iOS Simulator build and on Android's launcher;
  Windows and Linux apps carry it, but nobody has looked at it there yet.
- A download the page starts saves where its user picks on macOS, iOS and Android when it is a `Blob` or a `data:` URL
  the page holds. On macOS and iOS an `<a download>` link to one of the app's own files saves nothing yet, so the page
  fetches the file and saves it as a `Blob`; Android saves it. Of several downloads a page starts at once WebKit keeps
  the last, as each replaces the one before; started one after another, each saves in turn.
- Android's WebView hands the app neither a download link's name nor its bytes. So the host keeps, in the page's top
  frame, the `Blob` behind each `blob:` URL and each download link's name as it is followed, which a page's CSP does
  not hinder, and holds the download in memory while its user picks where it goes. A download that is no link of the
  page's takes its name from its address.
- Downloads have been measured in the iOS Simulator and on an Android emulator, under a CSP of `default-src 'self'`:
  a `Blob`, every byte value, a `data:` URL, a non-ASCII name, a `blob:` URL the page revoked at once, a link tapped,
  one clicked outside the document, three in a row and a picker cancelled. On macOS a `Blob` has been. WebView2 and
  WebKitGTK handle downloads themselves on Windows and Linux, which has not been measured yet.
- iOS 15.1 or later, arm64 alone: devices, and the Simulator of an Apple silicon Mac. It builds on macOS with Xcode.
- During development an iOS app runs in the Simulator; a device runs the Xcode project's build.
- Android 13 (API 33) or later, the level crossbind's Android libraries build against, with Android System WebView
  116 or later, the first that passes byte arrays as ArrayBuffer messages; an older WebView gets a message that names
  the version it needs. arm64-v8a and x86_64.
- An Android app builds on macOS and Linux. Its one activity shows the page under the system bars' insets.
- Vite only.
