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
| `crossbind app dev` | Builds the host for this machine and opens the app on the dev server. An edit to the page reloads it; an edit to native code, or to what the page imports from it, rebuilds the host and opens the app again. The page's console shows in the terminal, and closing its last window ends the session. |
| `crossbind app build` | Builds the page and the host and writes the app with what installs it (see [Installers](#installers)): `dist/<name>.app`, signed ad hoc or with a Developer ID (see [Signing a macOS app](#signing-a-macos-app)), and `dist/<name>.dmg` on macOS; `dist/<name>-linux-<arch>/`, the same as a `.tar.gz`, and its `.deb` on Linux. |
| `crossbind app build -p linux` | Writes the Linux app for x64 and arm64, on a Mac as well: `dist/<name>-linux-x64/` and `dist/<name>-linux-arm64/`, each with its `.tar.gz` and `.deb`. A Linux app's development session runs on Linux. |
| `crossbind app build -p windows` | Writes the Windows app for x64 and arm64, on a Mac or a Linux machine as well: `dist/<name>-win32-x64/` and `dist/<name>-win32-arm64/`, each with its `.zip` and `-setup.exe`. A Windows app's development session runs on Windows. |
| `crossbind build -p host -e app` | Builds the host alone, with no page in it and nothing that installs it: `<paths.output>/<name>.darwin-<arch>.app` on macOS, `<paths.output>/<name>.linux-<arch>` on Linux. `-p linux` or `-p win32` builds a Linux or a Windows app from a Mac as well. |
| `crossbind app dev -p ios` | Builds the host for the iOS Simulator and opens the app there on the dev server: in the Simulator already booted, else in an iPhone of the newest iOS. Edits reload the page or rebuild the host as on the desktop, and ending the app in the Simulator ends the session. |
| `crossbind app dev -p ios --device` | Builds the host for devices and opens the app on the dev server on the iPhone or iPad connected, or on the one `--device <name>` names by its name or UDID: Xcode signs it for the app's team, and devicectl installs it. The phone reaches the dev server through its cable, or on the local network when it is paired over it. Edits reload the page or rebuild the host as in the Simulator, the page's console shows in the terminal, and ending the app on the phone ends the session (see [iOS](#ios)). |
| `crossbind app build -p ios` | Builds the page and the host for devices and the Simulator and writes the app's Xcode project, `dist/<name>-ios/` (see [iOS](#ios)). |
| `crossbind build -p ios -e app` | Writes the Xcode project with no page in it: `<paths.output>/<name>-ios`, or `<name>-ios.debug` for a debug build. |
| `crossbind app dev -p android` | Builds the host for the attached Android device or emulator, installs the app as a debug APK and opens it on the dev server, which the device reaches through `adb reverse`. Edits reload the page or rebuild the host as on the desktop; the page's console shows in the terminal, and the end of the app's process, as when it is swiped away, ends the session (Back leaves the process running). crossbind starts no emulator: start one, or connect a phone with USB debugging on, and with several attached set `ANDROID_SERIAL`. |
| `crossbind app build -p android` | Builds the page and the host for arm64-v8a and x86_64, writes the app's Gradle project, `dist/<name>-android/`, and packages it: `dist/<name>-android.apk`, and with an upload key `dist/<name>-android.aab` too (see [Android](#android)). |
| `crossbind build -p android -e app` | Writes the Gradle project with no page in it: `<paths.output>/<name>-android`, or `<name>-android.debug` for a debug build. A release build packages it as `crossbind app build -p android` does. |
| `crossbind app updater-key` | Prints a new key pair for a desktop app's updates: the public key for `app.updater.publicKey`, the private one for `CROSSBIND_UPDATER_PRIVATE_KEY` (see [Updates](#updates)). |
| `crossbind app upload-key` | Makes this machine's upload key, which signs an Android app's bundle for Google Play, and keeps its password in the system keychain; `--use <keystore>` takes a key you have instead (see [The upload key](#the-upload-key)). |
| `crossbind app publish google-play` | Builds the Android app with the next versionCode Google Play takes and releases its bundle on a track, internal unless `--track` names another, to a share of its users with `--rollout`, and with the listing `store/google-play` holds; `-p android` names the same store (see [Publishing](#publishing)). |
| `crossbind app publish app-store` | Builds the iOS app, archives it and uploads it to App Store Connect, whose TestFlight hands it to testers, and with `--submit` to App Review too, with the listing `store/app-store` holds; Xcode numbers the build, and `-p ios` names the same store (see [Publishing](#publishing)). |
| `crossbind app publish github` | Builds the desktop app of `-p macos`, `linux` or `windows`, else of this machine, and puts what installs it, and with `app.updater` its update, into the GitHub release of its version, `v<version>` (see [GitHub Releases](#github-releases)). |

`crossbind app` runs the project's Vite with `CROSSBIND_APP_PLATFORM` set to the platform `-p` names, `macos`, `linux`,
`windows`, `ios` or `android`; without `-p` it keeps the variable the environment sets, and without that builds this
machine's desktop app. `--device` sets `CROSSBIND_APP_DEVICE` to the device it names, or to the UDID of the only one
connected. `vite` and `vite build` take the variables as well, and Vite's own options, such as `--port` or `--mode`,
pass through `crossbind app` to Vite. A macOS or iOS build fetches Hermes once; Linux, Windows and Android
apps build in crossbind's linux, windows and android-app images, which carry what they compile and link against (see
[Hermes](#hermes)).
They need `RUNNER=DOCKER_RUN` or `DOCKER_EXEC`, and another runner stops the build before its first step.

## The same page on the web

A project that leaves `target.runtimeEnv` out builds by the command that runs it: `crossbind app dev` and
`crossbind app build` make the app, and `vite` and `vite build` what a browser loads, with the native code as
WebAssembly, as any web project of the Vite plugin. It lists a WebAssembly build of each dependency beside the native
ones:

```js
// crossbind.config.js
export default {
    general: { name: 'my-app' },
    dependencies: [wasm, android, darwin, ios, linux, win32],
    paths: { config: import.meta.url },
};
```

```json
{
    "scripts": {
        "dev": "crossbind app dev",
        "build": "crossbind app build",
        "build:ios": "crossbind app build -p ios",
        "dev:web": "vite",
        "build:web": "vite build"
    }
}
```

`import.meta.env.CROSSBIND_APP_PLATFORM` is undefined in a web build, which tells the page where it runs and leaves the
apps' code out of the build. `crossbind/app` still resolves there, from the app host, so code the two share bundles:
what it calls rejects, and `device` throws, as outside an app. The native code compiles without `CROSSBIND_APP`, and
cannot include `<crossbind/app.h>`.

`target.runtimeEnv: 'app'` says a project is an app alone: `vite build` then makes the app as well.

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

### How the page behaves

The page behaves as an app's own view, not as a web page, through the extension `page-feel`: it does not zoom, a window
that fits stays put at its edges, text is selected only where its user edits it, a long press or a right click opens no
menu on the rest, an image or a link is not dragged out, and a tap leaves no grey flash and no `:hover` behind, whose
styles show as pressed while the finger is down. A Windows app has no status bar, autofill, swipe navigation or browser
keys. A build for development keeps the right-click menu, for Inspect Element, and on Windows the browser's keys.

Its styles lose to any rule of the app's, as `.article { -webkit-user-select: text; user-select: text; }` selects text
in an article again, and an app that names `maximum-scale` or `user-scalable` in its own viewport keeps its zoom.
`app: { without: ['page-feel'] }` leaves all of it out.

## The device

`device` from `crossbind/app` tells the page where the app runs, before the page's own scripts run, so the page reads it
as it starts, without `initNative()`. It stays the same through the app's run, and is frozen.

```js
import { device } from 'crossbind/app';

if (device.formFactor === 'phone') mountPhoneLayout();
```

| Field | What it holds |
|---|---|
| `platform` | The platform the app is built for: `macos`, `windows`, `linux`, `ios` or `android` |
| `arch` | The arch the app's process runs as: `arm64` or `x64` |
| `formFactor` | What the device is to its user as the app starts: `phone`; `tablet`, an iPad or an Android device whose screen's shorter side has 600dp, as Android's own `sw600dp` resources take it; or `desktop`, a computer, a Chromebook, or a Mac that runs an iPhone or iPad app |
| `os` | `{ name, version }` of the system, as its maker numbers it: `iOS` or `iPadOS` and `18.4`, `Android` and `15` with `apiLevel` `35`, `macOS` and `26.1`, `Windows` and `10.0.26100`, or a Linux distribution's from `/etc/os-release`, as `Ubuntu` and `24.04`, else `Linux` and the kernel's release |
| `isVirtual` | Whether the iOS Simulator or an Android emulator runs the app |

A foldable or a Chromebook keeps the `formFactor` it started with when it unfolds or resizes, so a page lays itself out
by its window's size, with CSS, as on the web. Reading `device` outside an app throws, as the rest of `crossbind/app`
does.

The page also has the platform at build time: crossbind's Vite plugin sets `import.meta.env.CROSSBIND_APP_PLATFORM` to
the platform `-p` names, else this machine's desktop, so a build leaves out the code of the other platforms. The page's
types have it with `/// <reference types="@crossbind/core-app-host/app" />`.

```js
if (import.meta.env.CROSSBIND_APP_PLATFORM === 'ios') registerSwipeBack();
```

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

`titleBar: 'hidden'` lays a macOS app's page under its title bar: the title and the bar's background go, and its
buttons stay at the window's top left, over the page, which draws its own toolbar there and leaves them room. The page
moves the window by an element of `data-crossbind-drag`, as a window without a frame does. Windows and Linux keep their
title bar; `'visible'`, the default, keeps it on macOS as well.

`backgroundColor`, as `#rrggbb`, is what the app shows until its page paints, and behind a page without a background of
its own: in the window on the desktop, and from the launch screen on iOS and Android, where the system bars' icons turn
light on a dark color and dark on a light one. Without it, each platform shows its own. A page that follows the
system's light and dark appearance gives two, `{ light: '#f2f2f2', dark: '#1e1e1e' }`: an iOS or Android app shows the
one of the appearance the system has, from its launch screen on and as the system switches, and a desktop the light
one.

On the desktop the page shows an element full screen with `element.requestFullscreen()`, as in a browser: the window
fills the screen until the page leaves it. On Windows and Linux a menu bar the page set stays above the element.

A macOS app opens with the app, Edit, View and Window menus every Mac app has, so ⌘C, ⌘V, ⌘Z, ⌘A, ⌘W and ⌘Q reach
it, and the page may set its own, as [Menus](#menus) tells. The
page's `alert()`, `confirm()` and `prompt()` show as the system's own dialogs, titled with the app's name, and the page
waits for their answer, as in a browser; its `beforeunload` never asks, and the page leaves at once. A file input shows
the system's picker. The host's extensions `page-dialogs` and `page-files` show them, whose roles an extension may take
(see [extensions.md](./extensions.md#the-pages-requests)). A
download the page starts, such as an `<a download>` link, asks where to save: in a save panel on macOS, in the system's
export sheet on iOS and in its save picker on Android; on Linux it goes to the user's Downloads folder, and on Windows
WebView2 shows its own downloads. The host's extension `page-downloads` saves them so, whose role an extension may take
(see [extensions.md](./extensions.md#downloads)). On Android, Back goes back in the page's history first, and
leaves the app when there is none.

An app that cannot start, for want of the WebView2 Runtime or of a file it carries, writes why to its output; a desktop
app its user opened says so in a message box as well.

## Windows

A desktop page opens more windows of the app's own pages with `crossbind/app`'s `windows`, as an iPad page does where
`app.ios.multipleWindows` lets it ([iOS](#ios)):

```js
import { events, windows } from 'crossbind/app';

const { id, ignored } = await windows.open({ path: '/settings.html', name: 'settings', title: 'Settings', width: 480, height: 360 });
events.on('window-closed', (closed) => {
    if (closed.id === id) settingsClosed();
});
```

A window opens in front with the page at its `path`, `/` by default, which may carry a query and a hash, and with these
options beside it, its own, as `app.window`'s are the first window's:

- `title`, `app.name` by default.
- `width` and `height`, 1024 × 768 by default, `minWidth`, `minHeight`, `maxWidth` and `maxHeight`, the page's, in
  whole pixels, with `resizable` and `fullscreen`, as `app.window` takes them; and `backgroundColor`, `app.window`'s by
  default.
- `x` and `y` together, the place of the window's frame from the top left of the main screen, without which it opens in
  the middle of the screen.
- `alwaysOnTop`, which keeps it above the other apps' windows.
- `frame: false`, which takes its title bar and its buttons away.
- `titleBar: 'hidden'`, as `app.window` takes it: a macOS page under the title bar, whose buttons stay. Windows and
  Linux keep their title bar and list it in `ignored`, and a window without a frame, which has none, refuses it.
- `parent`, the id of a window it stays above, and minimizes and closes with; and `modal`, which with a parent makes it
  a sheet of the parent's on macOS, and on Windows and Linux a window its parent takes no input under until it closes.
- `name`, of the app's own: a name already open brings that window to the front, and opens no other.

`open()` resolves with the window's `id` and the options its platform went without, `ignored`, as the window opens
without them all the same: a Wayland compositor places a window and keeps it among the others itself, so `x`, `y` and
`alwaysOnTop` go there; a macOS sheet stays where its parent shows it; and an iPad window takes its path, its title and
its name alone. A path of another origin, an option it does not know, limits `app.window` would refuse and a modal
window without a parent reject.

`windows.set()` changes the page's own window, or the one of an id given first: its `title`, its sizes and limits, `x`
and `y`, or `center`, which moves it to the middle of its screen, `resizable`, `alwaysOnTop` and `fullscreen`, and
resolves with what it went without, as `open()` does, a Wayland window's `center` among them. `close()` closes a window
as its user does, which an extension may keep open; `focus()` brings one to the front, restored if it was minimized,
which a Wayland compositor without the xdg-activation protocol, as Weston, does for no window;
`minimize()` and `toggleMaximize()` do what they say. Each takes the id of a window, or none for the page's own.
`windows.list()` gives the open windows, the oldest first, and `windows.current()` the page's own, each as
`{ id, name, title, x, y, width, height, isMaximized, isMinimized, isFullscreen, isFocused }`. Every page hears of each
window that opens and closes, as the events `window-opened` and `window-closed` of `{ id, name }`. The app's native code
reaches each function by name with an extension's `invoke`, as `invoke("windows.open", ...)`, and names a window by its
id, as a call of its own comes from no page's window.

A window without a frame moves as its page lets it: its user drags it by an element of `data-crossbind-drag`, and a
double click there maximizes or restores it, as on a title bar, but for a press on what takes one, as a button, a link
or a field, or within an element of `data-crossbind-drag="false"`. `windows.startDrag()` moves it from the page's own
mousedown of the primary button, while that is down.

```html
<header data-crossbind-drag>
    <span>Report.txt</span>
    <button id="minimize">–</button>
    <button id="close">×</button>
</header>
```

```js
import { windows } from 'crossbind/app';

document.querySelector('#minimize').addEventListener('click', () => windows.minimize());
document.querySelector('#close').addEventListener('click', () => windows.close());
```

Every window's page reaches the app's one module and its C++ state, but holds its objects alone: another page's handle
reaches none of them, and a page that goes, as its window closes or it reloads, frees what it held. The pages talk to
each other as pages of one origin do, through `BroadcastChannel` and the `storage` event of `localStorage`.
`window.open()` and a link of `target="_blank"` open no window of the app's: one of the app's own pages opens nowhere,
but on Android, whose WebView loads it in the page's place, and one of another origin goes to `page-navigation`, as
[Security](#security) tells.

The app quits as its last window closes, on every desktop. iOS sizes, places and closes an app's windows itself: an
iPhone shows one window of an app, so `windows.open()` rejects there; `set()` takes the title alone; `close()` of the
last window rejects, asking no extension, one of a window in the background brings it to the front as it closes, as iOS
lets a window in front alone go, and the app's window used last takes the front from one that closes, where iOS would
show the Home Screen; and `minimize()`, `toggleMaximize()` and `startDrag()` reject. From iOS 17 the page of a window in
the background runs on while the app does, as a desktop window's hidden page does. An Android app shows its activity's
one, and rejects every function of `windows`.

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

`crossbind app build` writes what installs a desktop app beside it, with each installer of its platform:

- macOS, `dmg`: `dist/<name>.dmg`, a disk image that holds the app beside a link to Applications, onto which its user
  drags it.
- Linux, `deb`: `dist/<name>-linux-<arch>.deb`, a Debian package that puts the app in `/usr/lib/<package>`, its command
  in `/usr/bin` and its entry and icon in the menu. It depends on WebKitGTK 4.1, release 2.40 or later, GTK 3 and what
  its extensions' `linux.depends` name, which `apt install ./<name>-linux-<arch>.deb` installs with it. The package is named after `general.name`, in lower
  case with a hyphen for each underscore, from its first letter or digit; package.json's `author` and `description` are
  its maintainer and description, and the app's name stands for both without them.
- Linux, `tar-gz`: `dist/<name>-linux-<arch>.tar.gz`, the app's folder, which unpacks anywhere its user can write.
- Windows, `nsis`: `dist/<name>-win32-<arch>-setup.exe`, which installs the app for the user who runs it, with no
  administrator's approval, in `%LOCALAPPDATA%\Programs\<app name>`. It adds the app to the Start menu and to the apps
  Settings lists, which name package.json's `author` as its publisher and whose Uninstall removes it again and leaves
  its data, and when the system has no WebView2 Runtime it downloads Microsoft's bootstrapper and, once it carries a
  valid signature of Microsoft's, runs it, which installs the runtime. While the app runs, an update or Uninstall asks
  to close it and changes nothing. `/S` installs without a window. NSIS, in crossbind's windows image, builds it.
- Windows, `zip`: `dist/<name>-win32-<arch>.zip`, the app's folder as signed.

The tar.gz and the zip register neither the app's schemes nor a menu entry. `app.installers` names the installers alone
that run, as `app: { installers: ['dmg', 'deb'] }` ships a disk image and a Debian package alone, and a name that is no
installer stops the build. An extension adds an installer of its own, as an AppImage, and one of a name of crossbind's
takes its place, as [extensions.md](./extensions.md#installers)' Installers says.

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
| `CROSSBIND_APPLE_API_KEY` | The API key's `.p8` file, which App Store Connect gives once, or its text, as a CI secret holds it; with the text, `CROSSBIND_APPLE_API_KEY_ID` names the ID. |
| `CROSSBIND_APPLE_API_KEY_ID` | The key's ID, which the file's name tells where it keeps the one App Store Connect gives it, `AuthKey_<key id>.p8`. |
| `CROSSBIND_APPLE_API_ISSUER` | The issuer ID of the key's team. |

An identity the keychain does not hold or a name two of its identities share, as after a renewal, stops
`crossbind app build` before anything compiles, and so does a key beside the identity that lacks one of its three
variables or comes with an identity other than a Developer ID Application one. Without an identity the key signs
nothing here, as it serves iOS uploads too (see [Publishing](#publishing)), and the app is signed ad hoc. Apple takes a few minutes to check the app, two hours at most
before the build gives up, and a rejection stops the build with Apple's log. A signed app that is not notarized opens
on another Mac only once its user allows it in System Settings, and the build says so.

## Signing a Windows app

`crossbind app build` leaves a Windows app and its setup program unsigned, so SmartScreen warns about them once they
are downloaded, and says so. With a key in the environment, jsign in crossbind's windows image signs the app before
its zip is made, and the setup program and its uninstaller as NSIS writes them, with Authenticode and a timestamp. The
key is jsign's own: a cloud's key service whose credentials jsign takes as its password, such as Azure Artifact Signing,
formerly Trusted Signing, Azure Key Vault, AWS or Google Cloud KMS, or SSL.com eSigner, or a PKCS#12 file. Its files
reach the container read-only, and its passwords by name, never on a command line:

| Variable | Value |
|---|---|
| `CROSSBIND_WINDOWS_SIGNING_STORETYPE` | jsign's store type, as `TRUSTEDSIGNING`, `AZUREKEYVAULT`, `AWS`, `GOOGLECLOUD`, `ESIGNER` or `PKCS12`. |
| `CROSSBIND_WINDOWS_SIGNING_KEYSTORE` | The key store: the service's endpoint or name, or the PKCS#12 file. |
| `CROSSBIND_WINDOWS_SIGNING_ALIAS` | The key's name in it. |
| `CROSSBIND_WINDOWS_SIGNING_STOREPASS` | Its password, or the service's access token. |
| `CROSSBIND_WINDOWS_SIGNING_KEYPASS` | The key's password, where it is not the store's. |
| `CROSSBIND_WINDOWS_SIGNING_CERTFILE` | The certificate chain a cloud key comes without, as a `.p7b` file. |
| `CROSSBIND_WINDOWS_SIGNING_TSAURL` | The timestamp server; `http://timestamp.digicert.com` without it. |

With Azure Artifact Signing, for one:

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
  the app's `.tar.gz`, of its `tar-gz` installer; on Windows its setup program, of its `nsis` installer. A Linux or
  Windows app keeps that installer, as a build whose `app.installers` leaves it out stops, naming it.

Both go where `app.updater.url` points, with `{platform}` as `darwin`, `linux` or `win32` and `{arch}` as `x64` or
`arm64`, and the file beside the manifest, as a GitHub release holds them (see [GitHub Releases](#github-releases)). The
page asks for an update and installs it when it decides to, as once its user agrees; the host asks no one:

```js
import { updater } from 'crossbind/app';

const update = await updater.check();
if (update && confirm(`Install ${update.version}?`)) await updater.install();
```

`updater.check()` gives `{ version }` when the manifest's version is newer than the app's, as semver orders them, and
`null` otherwise. `updater.install()` downloads the file into the app's cache folder and installs it only when the
signature covers the app's id, its platform and architecture, its version and its SHA-512. The app then quits and
opens the new version, so it saves what it needs first; the promise rejects when installing fails. One check or
install runs at a time, and another rejects meanwhile. A manifest past 64 KiB or a file past 2 GiB fails. A
development session checks, but installs nothing in place of the app its dev server opened.

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
C++ of an app calls the same with `<crossbind/extension.h>`'s `invoke("updater.check", …)`. An iOS or Android app updates
through its store, and `updater.check()` rejects there.

An `app.updater.url` that is neither https nor http on localhost or names no manifest, a public key that is none or
one anyone can forge signatures for, a package.json version that is not semver, and a private key that is not the
public key's pair stop `crossbind app build` before anything compiles. The host's updater, which a desktop app with
`app.updater` alone has, checks signatures with Monocypher, which it compiles in.

## The app's functions

The page imports what the app's host and crossbind's own extensions do for it from `crossbind/app`, which an app's bundler
plugin takes from `@crossbind/core-app-host`; a TypeScript page reads its types with
`/// <reference types="@crossbind/core-app-host/app" />`. `app.without` leaves out those of the extensions an app does not
want, as [extensions.md](./extensions.md#the-hosts-own-extensions) says. The app's C++ reaches the app's folders and
quitting through `<crossbind/app.h>`, which an app's own code finds as it builds, with `CROSSBIND_APP` defined, and an
extension's functions by their names, with `<crossbind/extension.h>`'s `invoke()`, where they reach any path:

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
| `dialog.open({ title, defaultPath, filters, directory, multiple })` | The paths of the files or folders its user picks, or `null`; on a phone copies of the files, and on iOS a folder where it is | ✓ | ✓ | ✓ |
| `dialog.save({ title, defaultPath, defaultName, filters })` | The path its user chooses to save to, or `null` | ✓ | | |
| `dialog.message({ message, detail, kind, buttons })` | The index of the button its user clicks | ✓ | ✓ | ✓ |
| `shell.openExternal(url)` | An http, https or mailto address in the default browser or mail app | ✓ | ✓ | |
| `shell.openPath(path)` | A file in the app the system opens its kind with | ✓ | | |
| `shell.revealInFolder(path)` | A file, selected, in the system's file manager, or on Linux without one its folder | ✓ | | |
| `shell.trash(path)` | Moves a file or folder to the system's trash, and nothing where it has none | ✓ | | |
| `app.paths()` | `{ data, cache, logs, resources, group }`, the app's own folders, made if missing, the read-only one of the files `app.files` lists, and an iOS app's App Group's, which the targets of its extensions' share, or `''` | ✓ | ✓ | ✓ |
| `app.quit()` | Ends the app as closing its last window does, without asking the extensions that may keep a window open | ✓ | | |
| `app.requestQuit()` | Asks the extensions, as its user's Quit does, then ends the app as `app.quit()` does, unless one keeps it running | ✓ | | |
| `app.relaunch()` | Ends the app as `app.quit()` does, then opens it anew with no link | ✓ | | |
| `app.launchUrls()` | The links of `app.urlSchemes` that opened the app and have not reached the page yet; the page alone | ✓ | ✓ | ✓ |
| `app.launchFiles()` | The files the system opened the app with that have not reached the page yet, as [Files](#files) tells; the page alone | ✓ | ✓ | ✓ |
| `app.launchArgs()` | `{ args, cwd }`, the launch that started the app, as [One instance](#one-instance) tells, empty on a phone; the page alone | ✓ | ✓ | ✓ |
| `app.setUserActivity({ type, userInfo, webpageUrl })` | Makes a user activity of `app.activityTypes` the app's current one, which its user's other devices continue, as [User activities](#user-activities) tells, or none with `null`; iOS, macOS and the page alone | ✓ | ✓ | |
| `menu.set(menus)` | Sets the menus of the page's window, whose clicks are the event `menu` its page hears; the page alone | ✓ | | |
| `menu.popup(items, { x, y })` | Opens a menu at the page's point, as a right click's: the id of the item clicked, or `null`; the page alone | ✓ | | |
| `menu.setDock(items)` | The menu of a macOS app's Dock icon, whose clicks are the event `menu`; macOS and the page alone | ✓ | | |
| `tray.set({ tooltip, menu })` | The app's icon in the menu bar, notification area or status tray, whose clicks are the events `tray` and `menu`; the page alone | ✓ | | |
| `tray.remove()` | Takes the tray's icon away; the page alone | ✓ | | |
| `notification.show({ title, body })` | A notification of the system's, a click on which is the event `notification`; the page alone | ✓ | | |
| `events.on(name, listener)` | Calls `listener` with each event of this name the app's C++ emits; returns what stops it | ✓ | ✓ | ✓ |
| `events.held(name)` | The values of the events of this name the app's C++ held for the page, which came before it asked since it loaded; the page alone | ✓ | ✓ | ✓ |
| `updater.check()` | `{ version }`, the newer version `app.updater.url` offers, or `null` | ✓ | | |
| `updater.install()` | Installs that version once its signature holds, then quits the app and opens the new one | ✓ | | |

In the page each returns a promise once `initNative()` has run, as what it loads carries the calls to the host, but
`events.on`, which returns at once what stops it and throws where it cannot listen. A function a platform has not got
rejects, saying so, and in a web or Node.js build every one fails. `app.relaunch()` opens the app anew as a fresh launch: on macOS and Linux once it has
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
rejects: Windows would delete it for good, and crossbind stops it. The app's C++ reaches any path, calling these
functions by their names with `invoke()` once the app's extensions have all started.

On the desktop the folders take the name of `app.id`: under `~/Library` on macOS, under `$XDG_DATA_HOME`,
`$XDG_CACHE_HOME` and `$XDG_STATE_HOME` on Linux, and under `%APPDATA%` and `%LOCALAPPDATA%` on Windows. An iOS
app's are its own `Library/Application Support`, `Library/Caches` and `Library/Logs`, and an Android app's its
`files`, `cache` and `files/logs`. `resources` is the folder of the files `app.files` in `crossbind.config.js` lists,
each in the place it had in the project, read-only, among the app's own files: `Contents/Resources/files` of a macOS
bundle, the iOS bundle's, `resources/files` beside a Linux or Windows app's executable, and on Android a copy on disk
the app makes as it first starts after each install. A Windows page's own storage and cache, WebView2's profile, are in
`%LOCALAPPDATA%\<app.id>\WebView2`; those of an app an earlier crossbind built, under `%APPDATA%\<name>.exe`, move
there when it first opens, or stay in use where they are when they cannot move, as from a roaming folder on another
drive.

### Extensions

An app takes more functions from extensions: `extensions` in `crossbind.config.js` lists them, and the app's host
builds their native code in. `crossbind add <package>` installs one and lists it. [`@crossbind/extension-clipboard`](../../extensions/clipboard/README.md), for one, reads
and writes the clipboard's text on every platform. An extension's package calls its functions by name with `invoke`
from `crossbind/app`, as `invoke('clipboard.readText')`, and the page imports the package's own functions.
[extensions.md](./extensions.md) is the contract an extension is written to.

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

An event the app's C++ emits reaches every page's listeners of it, with the value its JSON text holds:

```cpp
crossbind::app::emitEvent("progress", "{\"done\":0.5}");
```

```js
import { events } from 'crossbind/app';

const stop = events.on('progress', ({ done }) => { progress.value = done; });
```

`emitEvent` waits for nothing, so any thread may call it, and events of the module's thread keep their order among the
calls of the page's functions. A page gets the events of a name emitted once its `events.on` of the name has reached the
host: a call of the module it makes after it comes later. Text that is no JSON reaches no page, and the app's output
says why. Both travel with the page's other messages, on every platform an app runs on.

An event a page must not miss, as what came before it listened, the app's C++ holds with `holdEvent`: the host keeps
each until a page asks for the events of its name with `events.held()` since it loaded, then pushes the later ones to
the page in front that asked, of the window its user used last, while it listens. Each reaches one page once, and one a
reload cut off waits for the next ask; the host keeps 1,000 of a name at most. `events.held()` is no queue to poll: once
a page has asked, the later events go to its listeners of the name, so listening first, then asking, misses none. One
held before the module starts, as from an extension's entry, reaches no page.

With several windows, each of the host's events reaches the pages as what it tells says: a click of a window's menus
reaches the page that window shows; a click of the tray or of the Dock's menu, a notification's tap, `second-instance`
and the held `open-url`, `open-files`, `user-activity` and `shortcut-item` reach the page in front that listens, so
that one page acts on each once; `drop` reaches the page the files were dropped on; and the rest reach every page that
listens. `emitEvent` reaches every page that listens, as an extension's `emit()` does, which reaches one page as well,
and `emitEventToFront` the page in front.

```cpp
crossbind::app::holdEvent("tapped", "{\"id\":7}");
```

```js
const stop = events.on('tapped', open);
for (const tap of await events.held('tapped')) open(tap);
```

A desktop page hears of the system going to sleep as the event `suspend`, and of its waking as `resume`, both without a
value, through the host's `power` extension: macOS tells the app through NSWorkspace, Linux through logind on the
system bus, and Windows through its window.
The system sleeps without waiting for the page, which may not run before it does; a Windows machine with Modern
Standby may tell neither, and a Linux system without logind none.

```js
events.on('resume', () => reconnect());
```

The page hears of the app becoming the active one, as its user switches to it or a phone brings it to the foreground, as
the event `active`, and of another app taking its place, or a phone's being interrupted, by a call, a system alert or
another app's picker, or going to the background, as `inactive`, both without a value. A Linux app is active while one
of its windows has the focus, which a dialog of its own takes as well. An extension hears the same through `onActive`,
as [extensions.md](./extensions.md#the-native-side) tells.

A desktop page hears of the files its user drops on it as the event `drop`, of `{ paths, x, y }`: their absolute
paths, which the page may then reach through `shell`'s functions, as what its user picked, and the point they were
dropped at, in CSS pixels from its top left. The page's own `drop` event goes on, with its `File`s. The host's
extension `page-drops` tells it, whose role an extension may take
([extensions.md](./extensions.md#drops)).

```js
events.on('drop', ({ paths }) => open(paths[0]));
```

## Menus

The page sets its window's menus while it runs, and hears of their clicks as the event `menu`:

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
which the click turns over first, and reaches the page of the window whose menus they are; a standard item does what its
role says, and the page hears nothing of it: `close` closes its window as its user does, which an extension may keep
open, and `quit` asks to end the app as
`app.requestQuit()` does, which an extension may refuse. An accelerator is a key with `CmdOrCtrl`, `Ctrl` or `Alt`, and
maybe `Shift`, joined by `+`, as `CmdOrCtrl+Shift+O` is, or one of `F1` to `F12`, alone or with any of them. The key is
a capital letter, a digit, a function key or one of `Enter`, `Escape`, `Tab`, `Space`, `Backspace`, `Delete`, `Up`,
`Down`, `Left`, `Right`, `Home`, `End`, `PageUp`, `PageDown`, `Plus`, `Minus`, `Comma` and `Period`, and `CmdOrCtrl`
is ⌘ on macOS and Ctrl elsewhere. A menu the page
gets wrong fails before the host sees it, naming the item.

Each call replaces the menus the window's page set last, so the page changes an item by setting them all again, and a
reload keeps them. On macOS the menu bar shows the menus of the window in front after the app menu, which the app keeps
with its ⌘H, ⌥⌘H and ⌘Q, in place of the Edit, View and Window menus it opens with, which a window whose page set none
shows: ⌘C, ⌘V, ⌘Z and ⌘A reach the page through `editMenu` or the editing items alone, and ⌘M and ⌘W through
`windowMenu` or `minimize` and `close`. On Windows and Linux they are a bar in their window, above the page, which keeps
its size, as the window grows by the bar's height unless it fills the screen; `editMenu` and `windowMenu` are there the
standard items of that platform's apps, and a window whose page set none has no bar, as `menu.set([])` takes it away.
iOS and Android apps have no menu bar, and `menu.set` rejects there. The event `menu` is the menus' and the
[tray's](#tray-and-notifications) alone: the app's C++ sets neither, and the events it emits, one of which the page may
set them on, go by other names.

A desktop page opens a menu of its own where its user right clicks, of the items a menu takes, and gets the id of the
item clicked, or `null` when the menu closes without one:

```js
addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    const id = await menu.popup([{ label: 'Rename', id: 'rename' }, { type: 'separator' }, { role: 'copy' }], { x: event.clientX, y: event.clientY });
    if (id === 'rename') rename();
});
```

The point is the page's, in CSS pixels from its top left, as a `contextmenu` event's `clientX` and `clientY` are, and
the menu opens there at the page's zoom. A standard item does what its role says, and the event `menu` hears nothing of
a popup's clicks. `preventDefault()` keeps the webview's own menu away. iOS and Android apps open none, and
`menu.popup` rejects there.

A macOS page sets the menu its Dock icon shows above the system's own items, of the tray's items, `{ label, id,
enabled, checked }`, submenus and separators, whose clicks are the event `menu` as well, for the page in front that
listens:

```js
await menu.setDock([{ label: 'New window', id: 'new-window' }]);
```

An empty list takes it away, and another platform's `menu.setDock` rejects.

## Tray and notifications

A desktop page puts the app's icon in the macOS menu bar, the Windows notification area or a Linux desktop's status
tray, with a tooltip and a menu, and shows the system's notifications:

```js
import { app, events, notification, tray } from 'crossbind/app';

await tray.set({
    tooltip: 'Sync',
    menu: [
        { label: 'Sync now', id: 'sync' },
        { label: 'Paused', id: 'pause', checked: false },
        { type: 'separator' },
        { label: 'Quit', id: 'quit' },
    ],
});
events.on('menu', ({ id, checked }) => {
    if (id === 'sync') sync();
    if (id === 'pause') paused = checked;
    if (id === 'quit') app.quit();
});
events.on('tray', () => sync());

await notification.show({ title: 'Synced', body: '12 files are up to date.' });
events.on('notification', () => showReport());
```

The tray's menu takes the items of `menu.set` but for roles and accelerators: `{ label, id, enabled, checked }`, a
submenu `{ label, items }` and `{ type: 'separator' }`. A click of an item with an id is the event `menu`, as one in the
menus is, and turns an item with `checked` over first; it, and the event `tray`, reach the page in front that listens,
of the window its user used last. The icon is the app's, from `app.icon`, or the system's for an app
without one. The menu opens on a click on macOS, on a right click on Windows, and on Linux on the click its desktop
opens menus on; a left or right click that opens none, as a left click does on Windows, is the event `tray`. `tray.set` again changes the tooltip and the menu of the same icon, `tray.remove()` takes the icon away,
and the app takes it along as it quits. A Linux tray is a StatusNotifierItem, which the trays of KDE, Xfce, LXQt and
others show, and GNOME's with its AppIndicator extension, which Ubuntu's comes with; on a desktop without one `tray.set`
rejects, saying so.

`notification.show` answers once the system has taken the notification, and a click on it while the app runs is the
event `notification`, without a value, for the page in front that listens. macOS asks the app's user first, and the call
rejects when they refuse, as it does in an executable run outside its bundle. On Windows it is a balloon of the tray's
icon, which Windows 10 and later show as one of their notifications: without the page's tray, or after `tray.remove()`,
an icon of the app's shows in the notification area until the notification goes, and its clicks tell the page nothing. A
Linux app gives it to the desktop's notification server, with the body escaped for one that reads markup in it. iOS and
Android apps have neither a tray nor these notifications yet, and both calls reject there.

On iOS and macOS the host owns the system's notification center, whose notifications, pushes among them, reach the
app's extensions, as [extensions.md](./extensions.md#notifications-and-push) tells: one that comes while the app is in
front shows as a banner, in the list and with its sound, unless an extension shows it otherwise.

## One instance

`app.singleInstance` keeps a desktop app to one instance for each user:

```js
app: {
    singleInstance: true,
},
```

A later launch, as when its user opens the app again, hands its arguments and the folder it was launched in to the
instance that runs, and leaves with exit status 0 before it opens a window or starts the module; static initializers of
the app's code, and its extensions' entries, run in it all the same. The instance brings its window in front to the
front, restored if it was minimized, as far as the system lets it, and its page in front that listens hears of the
launch as the event `second-instance`:

```js
import { events } from 'crossbind/app';

events.on('second-instance', ({ args, cwd }) => {
    if (args.length > 0) runCommandLine(args, cwd);
});
```

`args` leaves out the program's own path, and the launch's links, which reach the owners of their schemes, those of
`app.urlSchemes` the page as `open-url`, and in an app that opens files the files, as [Files](#files) tells; a relative
one resolves against `cwd`. They are whatever the launch was given,
so the page takes them as it would any command line. The page asks for the first launch's own, which leave out the
same, with `app.launchArgs()`, and for its links of `app.urlSchemes` as [Links](#links) tells. A launch that arrives
before the page listens still brings the window to the front, and its event reaches no page. The event
`second-instance` is the host's alone: the app's C++ emits others.

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

The host's `instance` extension does this, in an app that `app.singleInstance` keeps to one instance alone. With
`app.singleInstance: false`, an extension of the app's own may take the launches instead, as
[extensions.md](./extensions.md#launches-and-links) tells.

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

Each link reaches the page once. The host's `links` extension holds it as the event `open-url`, as
[Events and callbacks](#events-and-callbacks) tells, until the page has asked since it loaded, and `app.launchUrls()`
hands over what it kept, so listening first, then asking, misses none. A link that comes while the page does not
listen, or whose event a reload cut off, waits for the page's next `app.launchUrls()`. The host keeps 1,000 links at
most, and drops a link longer than 64 KiB, saying so in the app's output. A link is whatever the system hands the app, so the
page takes it as it would any address from outside; macOS hands characters beyond ASCII over percent-encoded, Windows
and Linux as the link that opened the app has them. The event `open-url` is the host's alone: the app's C++ emits
others.

An extension declares schemes of its own in its `app.urlSchemes`, whose links reach its native code alone, as
[extensions.md](./extensions.md#launches-and-links) tells: neither `app.launchUrls()` nor `open-url` carries them. One
scheme has one owner, the app or one extension; two stop the build.

The app as built tells each system its schemes, its extensions' as well:

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

A link starts a Windows or Linux app again, with the link as its argument, so a scheme of the app's or of an extension's
keeps a Windows or Linux app to one instance unless `app.singleInstance` is `false`: the launch reaches the app that runs as
[One instance](#one-instance) tells, its link as `open-url` and the event `second-instance` without it. macOS hands a
link to the app that runs, and brings its window to the front.

### The app's sites

On iOS and Android, `app.links` names the https links of the app's sites that open it in place of the browser, as
`https://example.com/invite/42` does: a domain, lowercase, maybe with `*.` for its subdomains, then maybe the path its
links start with.

```js
app: {
    links: ['example.com/invite', 'www.example.com'],
},
```

They reach the page as the links of `app.urlSchemes` do, through `app.launchUrls()` and the event `open-url`, and an
extension's own, in its `app.links`, reach its `onOpenUrl` alone: a link reaches the owner of the entry whose domain is
the link's and whose path the link's decoded path starts with, as Android's `pathPrefix` does: of those, the one of the
longest path, then a domain before a `*.` of it, then the longest domain. One entry has one owner, and two stop the
build. An entry's path holds no `%` escape. Each site
names the app, which the system checks before a link of it opens the app:

- iOS: the app's entitlements claim each domain, as `applinks:example.com`, which its App ID takes once its Associated
  Domains capability is on, as Xcode's automatic signing turns it on; the site serves
  `/.well-known/apple-app-site-association`, which names the app by its team and bundle id and the paths that open it.
- Android: each entry is an intent filter Android verifies, its path the filter's `pathPrefix`; the site serves
  `/.well-known/assetlinks.json`, which names the app by its id and the SHA-256 of the certificate it is signed with.

macOS, Windows and Linux hand no app an https link.

## User activities

On iOS and macOS, `app.activityTypes` names the types of the user activities the app continues, as Handoff does when
its user picks up on one device what they did on another, in an app of the same team: a reverse-DNS name, as
`com.example.notes.edit` is, or an intent's class, a letter or a digit, then letters, digits, `.`, `_` and `-`. A web
page's, `NSUserActivityTypeBrowsingWeb`, is a site's link, which `app.links` takes.

```js
app: {
    activityTypes: ['com.example.notes.edit'],
},
```

The page makes one of them the app's current activity, which its user's other devices offer to continue, with
`app.setUserActivity()`: its `type`, what the page keeps in its `userInfo`, JSON values, and the http or https
`webpageUrl` a device without the app opens instead. `null` makes none current. A type `app.activityTypes` does not
list rejects, as every other platform does.

```js
import { app, events } from 'crossbind/app';

await app.setUserActivity({
    type: 'com.example.notes.edit', userInfo: { note: 7 }, webpageUrl: 'https://example.com/notes/7',
});
```

An activity the system continues the app with, the launch's own among them, reaches the page as the event
`user-activity`, `{ type, userInfo, webpageUrl }`, which the host's `activities` extension holds, as
[Events and callbacks](#events-and-callbacks) tells, until the page asks with `events.held('user-activity')`:

```js
events.on('user-activity', open);
for (const activity of await events.held('user-activity')) open(activity);
```

Its `userInfo` holds what the app that made it kept, a property list's values: a date as its ISO 8601 text, a URL and a
UUID as theirs, and a set as an array. JSON has no bytes, so one that holds bytes reaches no page, and the app's output
says why. An extension declares types of its own in its `app.activityTypes`, whose activities reach its native code
alone, as [extensions.md](./extensions.md#launches-and-links) tells. One type has one owner, the app or one extension;
two stop the build. The app's Info.plist lists them all as `NSUserActivityTypes`, which a macOS development session's
leaves out, as it does the schemes.

## Quick actions

On iOS and Android, `app.shortcutItems` names the quick actions a long press of the app's icon shows: each by its
`type`, a letter or a digit, then letters, digits, `.`, `_` and `-`, with its `title`, and on iOS a `subtitle` and an
`icon`, one of iOS's own by `UIApplicationShortcutIconType`'s name without its prefix, as `compose`, `add` and `search`
are. Android shows the app's icon beside each, with `app.icon`, and most launchers show four at most.

```js
app: {
    shortcutItems: [{ type: 'new-note', title: 'New note', icon: 'compose' }],
},
```

A tap reaches the page as the event `shortcut-item`, `{ type }`, the launch's own among them, which the host's
`shortcuts` extension holds, as [Events and callbacks](#events-and-callbacks) tells, until the page asks with
`events.held('shortcut-item')`:

```js
import { events } from 'crossbind/app';

events.on('shortcut-item', ({ type }) => run(type));
for (const { type } of await events.held('shortcut-item')) run(type);
```

The app as built lists them in an iOS app's Info.plist as `UIApplicationShortcutItems`, and as an Android app's static
shortcuts, whose labels are its resources. Android starts a static shortcut's tap in a task it empties first, which
would end the page; the host's trampoline activity hands the tap to the activity that runs instead, which keeps it. An
extension declares quick actions of its own in its `app.shortcutItems`, whose taps reach its native code alone, as
[extensions.md](./extensions.md#launches-and-links) tells. One type has one owner, the app or one extension; two stop
the build. The list is fixed as the app is built, and a desktop has none.

## Files

`app.fileTypes` names the types of files the app opens, as a double-click on `map.geojson` in Finder or Explorer, a
file manager's Open with and a phone's Files app open it:

```js
app: {
    fileTypes: [{ name: 'GeoJSON', extensions: ['geojson'], mimeTypes: ['application/geo+json'] }],
},
```

A type has the name the system shows its files' kind by, on one line, the extensions of its files, lowercase and
without the dot, and maybe the MIME types Android and Linux match them by, its `role`, `'editor'` by default or
`'viewer'`, and the `contentTypes` Apple's platforms know a type by that they have of their own, as
`public.comma-separated-values-text` is CSV's. The page asks for the files that opened the app, the launch's own among
them, with `app.launchFiles()`, and from then on hears of each opening as the event `open-files`, of `{ paths }`, while
it listens:

```js
import { app, events } from 'crossbind/app';

events.on('open-files', ({ paths }) => paths.forEach(open));
for (const path of await app.launchFiles()) open(path);
```

Each path is absolute. The host's `files` extension holds them for the page as it holds links, so listening first,
then asking, misses none, and hands the page as well the files of a type no extension owns. An extension declares types
of its own in its `app.fileTypes`, whose files reach its native code alone, through `onOpenFiles`, as
[extensions.md](./extensions.md#the-native-side) tells. One extension of a file has one owner, the app or an
extension, and two stop the build.

In an app that opens files, a desktop launch's arguments are its files, as Tauri's example of file associations takes
them: each argument but an empty one, one that starts with `-` and a URL other than a `file:` one, which stands for its
decoded path without its query, is a file, whether it is there or not, absolute against the folder the app was
launched in. A `file:` URL of a host other than `localhost`, as a Windows share's, or whose path holds a NUL stays an
argument. `myapp --verbose map.geojson notes.txt` opens both files and leaves `app.launchArgs()` and `second-instance`
with `--verbose`, so such an app takes its options as `--profile=work`. An app that declares no type keeps every
argument.

The app as built tells each system its types, its extensions' as well:

- macOS: its Info.plist's document types, by their extensions or their content types. Finder, the Dock and `open -a`
  hand the app that runs its files, and a development session's app claims none.
- iOS: its Info.plist's document types, by their content types, else by a type the app declares from the type's
  extensions and MIME types, named after its bundle id. A document opens where it is, which the app may read and write
  as long as it runs.
- Android: its activity's intent filters, by the type's MIME types, else by its extensions, which a provider's path
  shows or not. Other apps hand it a file as a `content:` address alone: the app takes no `file:` one, nor a file of a
  provider of its own that other apps cannot read, which it would read for whichever app opened it. The host copies
  each file into the app's cache, of the name it had, cut to 255 bytes before its extension, in a folder of its own,
  and hands the copy's path, which native code opens: what changes the copy does not reach the file. A file reaches the
  owner of the MIME type it came with, where one owner's types alone list it, before the owner of its name's
  extension. The app's next process empties the folder as it starts.
- Windows: the setup program registers each extension for its user under `HKEY_CURRENT_USER\Software\Classes`, so that
  Open with lists the app, and makes the app the extension's default, as Tauri's and electron-builder's installers do,
  keeping the default before beside it, which the uninstaller restores; a default its user chose in Windows' settings
  stays theirs. An update registers its release's types anew. The zip registers none.
- Linux: the Debian package's desktop entry lists the types' MIME types, and its MIME package,
  `/usr/share/mime/packages/<name>.xml`, their extensions, under one of the app's for a type that gives none. The tar.gz
  registers none.

A file starts a Windows or Linux app again, with its path as its argument, so a type of the app's or of an extension's
keeps a Windows or Linux app to one instance unless `app.singleInstance` is `false`, as a scheme does.

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

The build writes them where each platform reads them: the reasons into the Info.plist of a macOS or iOS app, the devices
into the entitlements a macOS app's signature claims and into an Android app's manifest. The page gets a device it asks
for once the system's user gives it: macOS and iOS ask the first time, with the reason, and so does Android, without it;
on Windows and Linux the page gets it at once. The webview asks nothing of its own, and the page gets nothing else it
asks to use, on any platform, but the autoplay and the sensors Windows' WebView2 gives without asking: no device the
list leaves out, no notifications, no MIDI, no downloads of several files at once on Windows and no iOS device's motion,
nor anything for a frame of another origin on Android, which lets the page hold one. It reads the clipboard on its
user's gesture alone, as in a browser. The host's extension `page-permissions` answers the page, whose role an extension
may take (see [extensions.md](./extensions.md#the-pages-requests)). Without its reason, WebKit gives a macOS
page no camera or microphone at all.

macOS asks for the app that opened on its own, from the Finder, the Dock or `open`. An app a terminal or an editor
starts, as `crossbind app dev` does, is theirs to macOS, which asks for their permission instead. WebKit gives a macOS
page no location of its own, so the host's extension `page-location` answers the top frame's `navigator.geolocation`
from CoreLocation, which asks with the reason; a frame inside the page gets none there.

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
    ├── data/                     the packages' data (CROSSBIND_DATA_PATH)
    ├── files/                    what app.files lists, each in its place in the project
    └── ext/<name>/               what each extension's app.files lists, each in its place in the extension

<name>-linux-<arch>/
├── <name>                        the window, the webview, Hermes and the bindings, in one executable
└── resources/                    host.hbc, page/, data/, files/ and ext/, as on macOS, and icon.png with app.icon

<name>-win32-<arch>/              as on Linux, with <name>.exe, which carries the icon

<name>-ios/                       an Xcode project, written anew on every build
├── <name>.xcodeproj
├── main.m                        calls the app, which comes prebuilt
├── Info.plist
├── Assets.xcassets/              the icon, with app.icon
├── lib/iphoneos/, lib/iphonesimulator/
│                                 the host and the archives it links, for each SDK
├── Frameworks/hermesvm.xcframework
└── app/                          host.hbc, page/, data/, files/ and ext/, copied into the app's bundle

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
        └── assets/app/           host.hbc, page/, data/, files/ and ext/, copied out to its files at first start

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

- The webview loads `crossbind://app` in any frame without asking; during development, the dev server too. Every
  other URL goes to the holder of `page-navigation` ([Navigation](./extensions.md#navigation)): the host's own loads
  the origins `app.navigation.load` lists, opens any other link the user follows in the default browser, and refuses
  any other navigation away. A page of another origin that loads gets no token, so it reaches neither the module's
  channel nor the app's functions, nor any dialog or device of the app's; and `window.open()` opens no window, for any
  page.
- The host gives the top frame of its page a token, and every message to the module and every call that travels as a
  `crossbind://` request carries it. Markup, such as an image, a frame from another origin and a sandboxed frame
  cannot read it, so none of them reaches the module. On macOS, iOS and Windows the channel also checks the sender's
  origin, which WebKitGTK does not tell.
- Responses from `crossbind://` let another origin read them only during development, the dev server's alone, as the
  page comes from it.
- An extension's route serves URLs of its own, under `crossbind://app/ext/<extension>/`, which any of the app's pages
  and markup load without the token, as the page's files: it serves what the page may see, and the host refuses a path
  with a part `..` and any method but GET and HEAD
  ([Routes](./extensions.md#routes)).
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
    encryption: false,       // whether the app uses encryption that export rules do not exempt
    privacy: { fileTimestamp: ['C617.1'] }, // Apple's reasons for the required reason API the app calls
    ios: { multipleWindows: true, appGroup: 'group.com.example.myapp' }, // an iPad's windows, and the App Group
},
```

`app.ios.multipleWindows` lets an iPad's user open more windows of the app, as the system's New Window does, which shows
the app's first page, and its page open more with `windows.open()` ([Windows](#windows)). Each window is a scene of the
app's, which iOS sizes and places itself, and may let go of in the background and restore later with the page it
showed, as a new page of the same path. An iPhone shows one window of an app, whatever the key says.

`app.ios.appGroup` names the App Group the app shares with the app extensions its extensions add, as a widget
([iOS app extensions](./extensions.md#ios-app-extensions)), `group.` and the app's id without it. The app and each
target that asks for it take it in their entitlements, the app's native code finds its folder as
`crossbind::app::paths().group` and the page as `app.paths()`' `group`; an app whose targets ask for none has none.

Open `dist/<name>-ios/<name>.xcodeproj` in Xcode to run the app on a device or to archive it for TestFlight and the App
Store, or let `crossbind app publish -p ios` archive and upload it (see [Publishing](#publishing)); Xcode signs it for
the team. The version is the project's `package.json` version without its prerelease part,
as Apple takes numbers alone, and so is the build number, unless `CROSSBIND_APP_BUILD_NUMBER` gives one, a whole
number, as CI does. A build for the Simulator
needs no team: `xcodebuild -project dist/<name>-ios/<name>.xcodeproj -sdk iphonesimulator build`. The host and the
project's own code keep their debug information, from which an archive's dSYM gives crash reports their files and
lines; the app ships without it.

`crossbind app dev -p ios --device` opens the app on an iPhone or iPad as it develops, on iOS 17 or later. The first
time on a device:

- Connect it with a cable and unlock it. crossbind pairs it with this Mac, which takes a tap on Trust on the phone and
  its passcode.
- Turn on its Developer Mode, in Settings › Privacy & Security › Developer Mode, which restarts it. The setting
  appears once the phone has paired with a Mac.
- Sign in to Xcode, under Settings › Accounts, with an account of the app's team. A free Apple Account will do: its
  Personal Team signs for its own devices, 3 of them, with profiles that last 7 days, which each build renews. The phone
  opens such a team's first app once Settings › General › VPN & Device Management trusts its developer. Without
  `app.team` or `XCODE_DEVELOPMENT_TEAM`, the error names the teams Xcode is signed in to.
- Xcode registers the device and the app's id with the team as it builds. An id belongs to the team that registered it
  first, which for `dev.crossbind.<name>` may be another developer's: `app.id` then gives the app an id of its own.

The phone reaches the dev server at this Mac's address on the network the cable makes between them, with no Wi-Fi; a
phone paired over the network reaches it on the local network both are on. The dev server listens on that one address,
and Vite's own `--host <address>` picks another. A `.local` name reaches nothing from the app.

`app.encryption` tells App Store Connect whether the app uses encryption that export rules do not exempt, as the
Info.plist's `ITSAppUsesNonExemptEncryption`; without it, App Store Connect asks for every build before TestFlight
takes it. Set it to `false` when the app uses no encryption, or only what is exempt, as the system's HTTPS, and to
`true` when it uses its own. It is a legal statement, so crossbind sets none by itself.

App Store Connect refuses an app that calls Apple's required reason API without its reasons (ITMS-91053). The host and
Hermes call none, but six of crossbind's ports do, through `stat` and its kin: curl, GDAL, OpenSSL, PROJ, SQLite and
libtiff. `app.privacy` gives the reasons, each category with Apple's codes from
[Describing use of required reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api),
and the build writes them as the app's privacy manifest, `PrivacyInfo.xcprivacy`. The categories are `fileTimestamp`,
`systemBootTime`, `diskSpace`, `activeKeyboards` and `userDefaults`. A release build reads what the archives the app
links reference, and names each library that references a category `app.privacy` gives no reason for. The linker may
leave some of it out of the app: the conformance app's Rust references `stat`, `lstat`, `fstat` and `fstatat`, and the
app calls `fstat` alone. `crossbind app publish -p ios` reads what the archived app calls instead, and stops on a
category without its reason. The scan finds C functions, as `stat` and `mach_absolute_time`, but not Objective-C
selectors, as `systemUptime`.

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
build says so. The Gradle project stays in `dist/<name>-android/`, which Android Studio opens too. The version name is
the project's `package.json` version; the version code is made from its numbers, major × 1,000,000 + minor × 1,000 +
patch, so the prereleases of one version share it, unless `CROSSBIND_APP_BUILD_NUMBER` gives one, a whole number up
to 2,100,000,000, as CI does.

A release ships its libraries stripped, the packages' shared libraries too, so no debug information reaches a phone. It
keeps them as linked in `dist/<name>-android/symbols/<abi>/`, and zipped as `dist/<name>-android-symbols.zip`, the native
debug symbols Google Play takes. `crossbind app publish` uploads the zip with the bundle, so a crash in Play Console
shows function names. Hermes and fbjni come stripped from their releases, so their frames stay addresses.

### The upload key

`crossbind app upload-key` makes one, so neither a JDK nor any knowledge of keystores is needed. It runs `keytool` in
the android-app image, with no network, and writes `~/.crossbind/keys/android-upload.p12`, an RSA 2048 key valid for
10,000 days, which `~/.crossbind.json` then names as `ANDROID_KEYSTORE` and `ANDROID_KEY_ALIAS`. Its password is one
crossbind makes, 24 random characters shown once, or one you type. A typed one needs 15 characters or more, as NIST SP
800-63B-4 asks of a password that alone guards what it locks, and must be no one part repeated, no run as 1234 or
qwerty, and no well-known password; no mix of kinds of characters is asked for.

The system keychain keeps the password, so builds sign without asking: macOS's Keychain, Windows' DPAPI, or Linux's
Secret Service through `secret-tool`. With `--no-keychain`, or where there is no keychain, a build asks for it on the
terminal, so the command then takes a typed password alone. `--show-password` prints the password the keychain keeps,
for another machine or CI.

The command never makes a key over one the machine has. Keep a copy of the keystore and of its password somewhere safe,
as a password manager: Google Play keeps only the upload key's certificate, and a lost key takes an upload key reset in
Play Console, which takes effect 72 hours later. The app's own signing key stays with Google, so its users see no
change.

A key you have, from Android Studio or `keytool`, signs as well. `crossbind app upload-key --use <keystore> [--alias
<alias>]` checks that it opens with its password and keeps it the same way. Or the environment names it for each build,
as CI does, and comes before the machine's:

| Variable | Value |
|---|---|
| `CROSSBIND_ANDROID_KEYSTORE` | The keystore that holds the upload key, or its base64 text, as a CI secret holds it. |
| `CROSSBIND_ANDROID_KEY_ALIAS` | The key's alias in it. |
| `CROSSBIND_ANDROID_KEYSTORE_PASSWORD` | The keystore's password. |
| `CROSSBIND_ANDROID_KEY_PASSWORD` | The key's password, when it is not the keystore's. |

The keystore reaches the container read-only and the passwords by name, never on a command line. A keystore without
its alias and password stops the build, and so does an alias or a password without a keystore.

The image carries a JDK, the Android SDK platform and build tools, Gradle and every Maven artifact the build takes,
Hermes' `hermes-android` and androidx.webkit among them, each checked against its sha256, so a build needs no JDK or
Android SDK on the machine and fetches nothing. An app whose extensions name `maven` libraries fetches those, beside the
image's, and Gradle checks every file it resolves against the image's checksums and its extensions'. Gradle's caches and the debug key stay in `~/.crossbind/android/`: the
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

## Publishing

`crossbind app publish <store>` builds the app and sends it to the store it names first, before any option of Vite's:
`google-play` takes its bundle on a Google Play track, `app-store` the app to App Store Connect, whose TestFlight hands
it to testers, and `github` a desktop app's installers and update to a GitHub release. `-p android` and `-p ios` name
the first two stores, as `CROSSBIND_APP_PLATFORM` does without either; for `github`, `-p` names the desktop platform.

Each store is a publisher, as an extension adds one: [extensions.md](./extensions.md#publishers)' Publishers says how
to write one, and an extension listed under the name of one of these three replaces it. A store's options go after its
name, and one of another store's is refused.

### Google Play

`crossbind app publish google-play` builds the Android app and releases its bundle on a Google Play track. Before the
build, which takes minutes, it checks all it needs:
- `app.id`, set in `crossbind.config.js`, as Play keeps an app's package name for good;
- an upload key;
- credentials Play takes uploads with;
- and the highest versionCode Play has seen.

The build's versionCode is then one above that, or the version's own when that is higher, and
`CROSSBIND_APP_BUILD_NUMBER` overrides both, so one `package.json` version uploads as often as needed. The release goes
on the internal track unless `--track` names another (`alpha`, `beta`, `production` or one of your own), and out to its
testers at once, unless `--draft` leaves it for Play Console to roll out.

`--rollout 10`, or `10%`, makes the release a staged rollout: Play gives it to that percent of the track's users at
first, and Play Console raises the share later, under Test and release. Play stages updates alone, so an app's first
release reaches all of them. `--rollout 100` releases to every user, as no `--rollout` does, and a draft takes none.

Google Play takes uploads from your Google account or from a service account.

With neither set, a publish on a terminal signs you in to Google: your browser opens Google's page, where you pick the
account and allow its Google Play access, and the system keychain keeps the sign-in for later publishes, with a terminal
or without; a machine with no keychain signs in at each publish. The account's own rights in Play Console apply, so it
needs "Release apps to testing tracks" for the app, as its owner has, and the rights step 3 below names for production
and the listing. The browser has to run on the same machine, as Google's page sends it back to a port of crossbind's
there. To sign out, remove crossbind in your Google account, under Security › Your connections to third-party apps &
services; the next publish signs in again.

A service account is for CI, where no one signs in, and wins over the sign-in where one is set, from the environment or
from `~/.crossbind.json` under the same name without `CROSSBIND_` (`crossbind config set GOOGLE_PLAY_SERVICE_ACCOUNT …`):

| Variable | Value |
|---|---|
| `CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT` | The service account's e-mail. Your own gcloud login buys an hour's token of it at each publish, so no key of it exists anywhere. |
| `CROSSBIND_GOOGLE_PLAY_KEY` | The service account's JSON key, where gcloud is not, as in CI: its file, or, from the environment alone, its text. |
| `CROSSBIND_GOOGLE_PLAY_TOKEN` | An access token of the service account with the androidpublisher scope, from the environment alone, as CI makes one with no key (see [From CI](#from-ci)). It lasts an hour. |

Setting two of them stops the publish. Once, for each app or account:

1. In Play Console, create the app, with `app.id` as its package name; Play's API makes none.
2. For a service account, enable the Google Play Android Developer API in a Google Cloud project and make one there.
   - For `CROSSBIND_GOOGLE_PLAY_SERVICE_ACCOUNT`, enable the IAM Service Account Credentials API too, and give your
     gcloud account the Service Account Token Creator role on the service account:
     `gcloud iam service-accounts add-iam-policy-binding <e-mail> --member="user:$(gcloud config get-value account)" --role=roles/iam.serviceAccountTokenCreator`.
   - For `CROSSBIND_GOOGLE_PLAY_KEY`, make a JSON key of it. An organization may refuse keys
     (`iam.disableServiceAccountKeyCreation`): use the first way, or a project with no organization.
3. For a service account, invite its e-mail in Play Console, under Users and permissions, with "Release apps to testing
   tracks" for the app; for the production track also "Release to production, exclude devices, and use Play App
   Signing", and for the listing "Manage store presence".
4. Play takes draft releases alone until an app's first release is out. So the first publish leaves its release a draft;
   roll it out once in Play Console, under Test and release, and later publishes go out by themselves.

On a terminal, the publish asks for what is missing and sets it up before the build:
- the package name, one both stores take, which it writes into `crossbind.config.js` once you say yes;
- the upload key, which it makes as `crossbind app upload-key` does;
- the Google sign-in, after a yes, and another account's when the one signed in has no release rights for the app;
- what only Play Console does, creating the app and inviting a service account: the publish names it, opens Play
  Console, and checks again when you press Enter.

Without a terminal, as in CI, nothing is asked, and the publish names every missing piece at once.

### Google Play's listing

A project's `store/google-play` folder holds its Google Play listing: a folder per language, named as Play names it
(`en-US`, `tr-TR`), with the files fastlane's supply reads:

```text
store/google-play/en-US/
├── title.txt                 at most 30 characters
├── short_description.txt     at most 80
├── full_description.txt      at most 4000
├── video.txt                 a YouTube URL
├── changelogs/default.txt    the release's notes, at most 500; <versionCode>.txt for that release alone
└── images/
    ├── icon.png              .png, .jpg or .jpeg, as every image
    ├── featureGraphic.png
    ├── tvBanner.png
    └── phoneScreenshots/     in the order of their names, as 01.png, 02.png; sevenInchScreenshots/,
                              tenInchScreenshots/, tvScreenshots/ and wearScreenshots/ the same
```

Each publish puts into its edit what the folder has and Play's listing lacks: a language's texts where one differs, its
images of a type where Play shows others or in another order, and the notes in the release. What the folder leaves out
stays as Play has it, so it may hold the notes alone, or the screenshots. A language Play has no listing in yet takes
`title.txt`, `short_description.txt` and `full_description.txt`, which Play makes a listing of. Before the build, the
publish stops at an empty text but a video's, which takes the video away, at a text longer than Play takes, at two files
of one image, and at a file or folder Play takes none of, naming it.

### App Store Connect

`crossbind app publish app-store` builds the iOS app, archives it with `xcodebuild` and uploads it to App Store Connect,
whose TestFlight hands it to testers once Apple has processed it, usually within 5 to 30 minutes. It runs on macOS,
with Xcode. Before the build it checks all it needs:
- `app.id`, set in `crossbind.config.js`, as App Store Connect keeps an app's bundle id for good;
- the Apple Developer Program team, `app.team` or `XCODE_DEVELOPMENT_TEAM`;
- and `app.icon`, as App Store Connect takes no app without an icon.

crossbind archives the app unsigned and signs it ad hoc, so archiving takes no development certificate, profile,
registered device or Apple account. The account Xcode is signed in to then uploads it: it signs the app for
distribution, in the cloud, and numbers the build: the version's own number at first, the next free one for each later
upload of that version, unless `CROSSBIND_APP_BUILD_NUMBER` gives one. With
`CROSSBIND_APPLE_API_KEY`, `CROSSBIND_APPLE_API_KEY_ID` and `CROSSBIND_APPLE_API_ISSUER` set, as for notarizing a macOS
app, an App Store Connect API key does it in place of the account, as in CI. Apple signs in the cloud for an Admin key
alone; a key of another role needs an Apple Distribution certificate in the keychain, which Xcode makes once under
Settings › Accounts › Manage Certificates. `--track`, `--draft` and `--rollout` are other stores', and stop an
iOS publish.

Once, for each app, create it in App Store Connect, under Apps, as a new iOS app with `app.id` as its bundle ID; Apple's
API makes none, and the upload fails until the app is there. A publish that finds no app registers the bundle id with
Apple first, through an export that uploads nothing, so App Store Connect's form lists it.

The archived app shows what of Apple's required reason API it calls, and a category its privacy manifest gives no reason
for stops the publish before the upload, which App Store Connect would refuse (see [iOS](#ios)). The upload carries the
app's dSYM, with the files and lines of the host and the project's own code, and Hermes' dSYM, which crossbind
downloads before the first build from Maven Central and checks against the sha256 it pins, keeping the device's 80 MB
of the release's 360 MB. Crash reports in App Store Connect and Xcode's Organizer then show functions and lines. What
App Store Connect warns of without refusing the upload, the publish repeats. The archive, the upload's options and
both logs stay in `.crossbind/build/app-store/`.

On a terminal, the publish asks for what is missing and sets it up:
- the bundle id, the icon, `app.encryption` and the reasons of `app.privacy`, which it writes into
  `crossbind.config.js` once you say yes; new reasons build the app again. One bundle id both stores take, letters and
  digits in dot-separated parts, serves both. The encryption answer is a legal statement, so it takes y or n alone, and
  a config that sets `app.privacy` already gets the whole of it named to set by hand.
- the team: one of those the accounts Xcode is signed in to have, or one you type, which `~/.crossbind.json` keeps as
  `XCODE_DEVELOPMENT_TEAM`.
- what only Xcode or Apple's sites do: signing in to Xcode again, accepting a new Program License Agreement or creating
  the app. A failed upload names it, opens the page where crossbind knows it, and tries again when you press Enter,
  without building again. Any other failure stops the publish.

Without a terminal, as in CI, nothing is asked: the publish names every missing piece at once, warns without
`app.encryption`, and stops at the first failure.

`--submit` hands the version to App Review too, through App Store Connect's API, which takes the API key: one of the App
Manager or Admin role, set as above. Before the build, the publish also checks that App Store Connect has the app, that
the version takes another build, which none out or in review does, and that App Review has no other submission of the
app, and it stops without `app.encryption`, whose answer App Review takes with every build. After the upload it takes
the version of `package.json`'s number, the one App Store Connect prepares under another number, renamed, or a new one,
and puts the listing `store/app-store` holds into it. It then waits for App Store Connect to process the build, an hour
at most, picks it for the version and submits the version for review. `--phased` releases the version App Review
approves in phases over 7 days, as App Store Connect's phased release does; without it the version goes out as App Store
Connect's release option for it says.

What only App Store Connect does stays there: the first version's age rating, the screenshots of devices other than
iPhones and iPads, app previews, App Privacy answers, price, category and copyright, App Review's contact, the export
compliance documents an app that uses encryption takes, a reply to App Review, and a submission it answered with issues,
which a publish without `--submit` gives a new build to pick. A submission App Store Connect prepares with items in it,
as a publish stopped midway leaves, stops the next one before its build: submit or remove them there. A call that finds
App Store Connect busy or out of reach for a moment tries again.

### The App Store listing

A project's `store/app-store` folder holds its App Store listing, which goes with `--submit`: a folder per locale, named
as App Store Connect names it (`en-US`, `tr`, `zh-Hans`), with the texts' files fastlane's deliver reads and a folder of
screenshots per display type:

```text
store/app-store/en-US/
├── name.txt                  at most 30 characters
├── subtitle.txt              at most 30
├── privacy_url.txt           the privacy policy's URL
├── description.txt           at most 4000
├── keywords.txt              at most 100, separated by commas
├── release_notes.txt         what's new in the version, at most 4000
├── promotional_text.txt      at most 170
├── support_url.txt
├── marketing_url.txt
└── screenshots/
    ├── APP_IPHONE_67/          the 6.9-inch and 6.7-inch iPhone's: 01.png, 02.png, at most 10
    └── APP_IPAD_PRO_3GEN_129/  the 13-inch iPad's
```

The version takes what the folder has where App Store Connect's own differs, in a new localization for a locale it has
none of; the name, subtitle and privacy policy URL go into the app's information that changes with the version, which
App Store Connect makes for a new locale of its name alone. What the folder leaves out stays as App Store Connect has
it, so it may hold the release notes alone. An empty `subtitle.txt`, `promotional_text.txt` or `marketing_url.txt`
clears its text. Before the build, the publish stops at another empty text, at a text longer than App Store Connect
takes, and at a file or folder it takes none of, naming it.

A folder of `screenshots/` per display type, named as App Store Connect's API names it, holds the type's .png, .jpg or
.jpeg files, 10 at most, in the order of their names as text, so 01.png, 02.png and on to 10.png: `APP_IPHONE_67` for
the 6.9-inch and 6.7-inch iPhones, `APP_IPHONE_65`, `APP_IPHONE_61`, `APP_IPHONE_58`, `APP_IPHONE_55`, `APP_IPHONE_47`,
`APP_IPHONE_40` and `APP_IPHONE_35`, `APP_IPAD_PRO_3GEN_129` for the 13-inch iPads, `APP_IPAD_PRO_3GEN_11`,
`APP_IPAD_PRO_129`, `APP_IPAD_105` and `APP_IPAD_97`. Before the build, the publish stops at a file that holds no PNG or
JPEG image, as an empty one or a Git LFS pointer does. A type's screenshots go up anew where App Store Connect shows
others, in another order or unprocessed, and the publish waits for it to process them before the build's turn; a type
the folder has none of stays as it is.

### GitHub Releases

`crossbind app publish github` builds the desktop app of the platform `-p` names, `macos`, `linux` or `windows`, else
`CROSSBIND_APP_PLATFORM`, else this machine's, and puts what installs it into the GitHub release of its version, tagged
`v` and package.json's version: the files of each installer, a macOS one under the app's name with its platform and
arch, as `<name>-darwin-<arch>.dmg`, as one release holds both arches', and the others under their own names, as the
Debian package, the tar.gz, the Windows setup and the zip. Two files of one name stop the publish before any goes up.
With `app.updater` the release takes the update too, its
manifest and the file it names, which `CROSSBIND_UPDATER_PRIVATE_KEY` signs, so an app whose updater points at the
release updates from the newest one GitHub has out:

```js
app: {
    updater: {
        url: 'https://github.com/<owner>/<repo>/releases/latest/download/<name>-{platform}-{arch}.update.json',
        publicKey: '<what crossbind app updater-key prints>',
    },
},
```

A repository without a release of the tag gets one, a draft until its files are up, tagged at the commit `GITHUB_SHA`
names where `GITHUB_REPOSITORY` is the repository, else at the project's own where its git origin is, else at the
repository's default branch, with the notes GitHub writes of the changes since the last release, and a prerelease for a
version such as 1.2.3-beta.1. A publish takes a release another one made during its build, as the jobs of a matrix do,
and publishes that make theirs at once agree on the oldest. A file of a name the release has already takes the old one's
place, so a publish runs again as it did, unless the repository makes its releases immutable.

A release put out holds the files its publishes have put up so far, and the newest one out is the one apps update from:
put each platform's app up with `--draft` first, and then the release out with a publish without it. GitHub then makes
the release the latest unless it has a newer version out, so a fix of an older line leaves the newest one latest.
`gh release edit v<version> --draft=false` makes it the latest whatever its version, and so may GitHub's page, as its
"Set as the latest release" box says; `gh api --method PATCH repos/<owner>/<repo>/releases/<id> -f draft=false -f
make_latest=legacy` puts it out as a publish does, with the id `gh release view v<version> --json databaseId -q
.databaseId` prints. GitHub makes no prerelease the latest, so apps update to none, and an app fetches no release of a
private repository, which takes a token; the publish warns of both, and where `app.updater.url` is not the newest
release's address.

GitHub takes the release from a token with write access to the repository's contents: `GH_TOKEN` or `GITHUB_TOKEN`,
which a workflow's step takes as `GITHUB_TOKEN: ${{ github.token }}` with the job's `permissions: contents: write`, else
the sign-in of the GitHub CLI, `gh`. The build gets neither, as it writes nothing to GitHub. The repository is
`CROSSBIND_GITHUB_REPOSITORY`, else `GITHUB_REPOSITORY`, which GitHub Actions sets, else package.json's `repository`.
Before the build, the publish names every one of them that is missing, and the updater's key `app.updater` takes.

### winget

The Windows Package Manager installs an app from its community repository, `microsoft/winget-pkgs`, which takes each
version as a pull request its moderators check. [WinGet Releaser](https://github.com/vedantmgoyal9/winget-releaser),
which [Komac](https://github.com/russellbanks/Komac) drives, makes that pull request for each GitHub release `crossbind
app publish github` puts out, from the Windows setups the release holds:

```yaml
name: Publish to winget
on:
  release:
    types: [released]
jobs:
  winget:
    runs-on: ubuntu-latest
    steps:
      - uses: vedantmgoyal9/winget-releaser@v2
        with:
          identifier: <Publisher>.<App>
          installers-regex: '-win32-(x64|arm64)-setup\.exe$'
          token: ${{ secrets.WINGET_TOKEN }}
```

Once, for the app: submit its first version to `microsoft/winget-pkgs` yourself, as Komac's `komac new` does, since the
action makes each new version from the last one there; fork `microsoft/winget-pkgs` under the account of the app's
repository, or name another account with the action's `fork-user`; and keep a classic token with the `public_repo` and
`workflow` scopes in the `WINGET_TOKEN` secret, as a workflow's own token opens no pull request in another repository.
The setup installs the app for its user alone, as winget's `--scope user` does, and `/S` installs it without a window.

`types: [released]` waits for a release out, as GitHub gives its files to no one before: a draft or a prerelease sends
nothing. A release a workflow puts out with its own `GITHUB_TOKEN` starts no other workflow, as GitHub keeps such events
from starting one, so there run the action as a job after the one that puts the release out, with `release-tag:
v<version>`; a release put out by hand, or with another token, starts the workflow above.

### Microsoft Store

The Store refuses this setup program today. Its policy 10.2.9 takes no installer that downloads what the app needs as
it runs, and the setup downloads Microsoft's WebView2 bootstrapper on a system without the runtime (see
[Installers](#installers)). So the workflow below does not pass certification yet, as
[known-issues.md](../known-issues.md#the-microsoft-store-refuses-the-windows-setup-program) records.

The Microsoft Store takes a Windows app as the setup program `crossbind app build` makes, which it downloads from the
address its submission gives as the app installs: a GitHub release's, which keeps a version's file. Microsoft's [Store
Developer CLI](https://github.com/microsoft/msstore-cli), `msstore`, points the app's submission at each GitHub release
`crossbind app publish github` puts out, and sends it for certification:

```yaml
name: Publish to the Microsoft Store
on:
  release:
    types: [released]
jobs:
  store:
    runs-on: windows-latest
    steps:
      - uses: microsoft/microsoft-store-apppublisher@v1.4
      - run: msstore reconfigure --tenantId ${{ secrets.PARTNER_CENTER_TENANT_ID }} --sellerId ${{ secrets.PARTNER_CENTER_SELLER_ID }} --clientId ${{ secrets.PARTNER_CENTER_CLIENT_ID }} --clientSecret ${{ secrets.PARTNER_CENTER_CLIENT_SECRET }}
      - shell: bash
        env:
          RELEASE: https://github.com/${{ github.repository }}/releases/download/${{ github.event.release.tag_name }}
        run: |
          packages=$(jq -nc --arg release "$RELEASE" '{packages: [["x64", "X64"], ["arm64", "Arm64"]] | map({
            packageUrl: "\($release)/<name>-win32-\(.[0])-setup.exe", architectures: [.[1]],
            languages: ["en-us"], isSilentInstall: false, installerParameters: "/S", packageType: "exe"})}')
          msstore submission update ${{ vars.PARTNER_CENTER_PRODUCT_ID }} "$packages"
      - run: msstore submission publish ${{ vars.PARTNER_CENTER_PRODUCT_ID }}
```

Once, for the app: create it in Partner Center as an EXE or MSI app, with its name reserved, and complete its first
submission there, with its listing, age rating and price, which later ones take as they are. Associate a Microsoft Entra
application with the Partner Center account, under Account settings › User management, and keep its tenant, client ID
and a client secret, with the account's seller ID, as the workflow's secrets, and the app's product ID, which Partner
Center shows under Product identity, as a variable. `isSilentInstall` is false, as the setup installs without a window
with `/S` alone.

The Store installs only a setup signed with a certificate of an authority Microsoft's Trusted Root Program takes, as the
next publish's certification checks (see [Signing a Windows app](#signing-a-windows-app)). It fetches the setup from the
release each time it installs the app, so leave a release the Store has as it is; it updates no app it installed this
way, which the app's own updater does (see [Updates](#updates)). A release a workflow puts out with its own token starts
the workflow above as little as winget's.

### From CI

A CI job publishes as a publish without a terminal does: it asks nothing. So publish once on your own machine first,
where the publish asks for the app's settings and writes them into `crossbind.config.js`, and commit them. CI has no
Xcode account and no one to sign in to Google, so it needs these besides, as the repository's secrets and variables:

| Store | CI needs |
|---|---|
| Google Play | The upload key as a base64 secret, which `base64 < <keystore>` prints, with its alias and its password, which `crossbind app upload-key --show-password` prints. A service account invited in Play Console (see [Google Play](#google-play)), through Workload Identity Federation with no key, or its JSON key. |
| App Store Connect | `app.team` in `crossbind.config.js`, as this machine's `XCODE_DEVELOPMENT_TEAM` stays behind. An App Store Connect API key, its `.p8` as a secret: an Admin key, whose uploads Apple signs in the cloud and whose secret can do all an Admin can, or a key of another role with an Apple Distribution certificate imported into the runner's keychain before the publish. The archive is unsigned, so the runner needs no development certificate or device. |
| GitHub Releases | The workflow's own token, given as `GITHUB_TOKEN: ${{ github.token }}` with `permissions: contents: write`, and with `app.updater` its private key as a secret in `CROSSBIND_UPDATER_PRIVATE_KEY`. |

Each key goes in as its secret's text, the upload key's as base64, so no step writes it to a file: where a tool takes a
file, crossbind writes one only the job's user reads, and removes it when the publish ends.

For GitHub Actions, with npm, publishing to Google Play:

```yaml
name: Publish to Google Play
on: workflow_dispatch
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - id: google
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ vars.GOOGLE_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ vars.GOOGLE_PLAY_SERVICE_ACCOUNT }}
          token_format: access_token
          access_token_scopes: https://www.googleapis.com/auth/androidpublisher
          create_credentials_file: false
      - run: npx crossbind app publish -p android
        env:
          CROSSBIND_GOOGLE_PLAY_TOKEN: ${{ steps.google.outputs.access_token }}
          CROSSBIND_ANDROID_KEYSTORE: ${{ secrets.ANDROID_UPLOAD_KEY }}
          CROSSBIND_ANDROID_KEY_ALIAS: upload
          CROSSBIND_ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_UPLOAD_KEY_PASSWORD }}
```

Workload Identity Federation lets the repository's jobs act as the service account, with no key anywhere;
[google-github-actions/auth](https://github.com/google-github-actions/auth) says how to set it up, with
`roles/iam.workloadIdentityUser` on the service account for the pool. The pool's provider trusts the tokens GitHub gives
every repository's jobs, so give it an attribute condition that admits only yours, as
`assertion.repository_id == '<id>'` with the id `gh api repos/<owner>/<repo> --jq .id` prints. The token lasts an hour,
so the publish's own job makes it, and it asks for the androidpublisher scope, as the action's default, cloud-platform,
does not cover Google Play. With a JSON key instead, give its text, from a secret, in `CROSSBIND_GOOGLE_PLAY_KEY`.

Publishing to TestFlight takes one job on a hosted macOS runner. The runner has no Docker and needs none: on a Mac,
crossbind makes a macOS or iOS build's bridges with `@crossbind/bridge-tools`, which npm installs with crossbind there.

```yaml
name: Publish to TestFlight
on: workflow_dispatch
jobs:
  publish:
    runs-on: macos-latest
    env:
      CROSSBIND_RUNNER: LOCAL
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - uses: actions/cache@v6
        with:
          path: ~/.crossbind/hermes
          key: hermes-${{ hashFiles('package-lock.json') }}
      - run: npx crossbind app publish -p ios
        env:
          CROSSBIND_APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          CROSSBIND_APPLE_API_KEY_ID: ${{ vars.APPLE_API_KEY_ID }}
          CROSSBIND_APPLE_API_ISSUER: ${{ vars.APPLE_API_ISSUER }}
```

`CROSSBIND_RUNNER: LOCAL` keeps the build's other steps, such as a Rust crate's, on the runner and its Xcode. The cache
keeps Hermes and its dSYM, which every upload carries, from downloading again at each run.

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
- Several windows have been measured on macOS, on Linux under Xvfb without a window manager, and on an iPad Simulator
  of iPadOS 27: a second window of another page of the app's, which reaches the module with objects of its own, talks
  to the first through `BroadcastChannel` and the `storage` event, and hears the events for every page, for the page in
  front and for one page as each says; and the app going on as each closes. On the desktop as well: the size a window
  opened at and the one `set()` gave it, a modal window and one without a frame opening with their pages, and a
  `startDrag()` with no press down moving nothing; on the iPad, a window closed in the background and one closed in
  front, after which the first has the front. Windows builds them, and its conformance runs check them in CI. By hand,
  on macOS, on Linux under Xvfb with openbox and on Wayland under Weston 14, and on Windows Server 2025: a frameless
  window's move and its buttons, a modal window, a sheet on macOS and above its parent elsewhere, the menus of several
  windows, each its own, and a window above the others and the place `x` and `y` give, which a Wayland compositor
  takes for itself, as `open()`'s `ignored` says. An iPad itself has not been measured.
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
- Message dialogs have been measured from the page: on macOS, and on Linux under Xvfb with openbox, with
  their buttons, Return and Escape; in the iOS Simulator with their buttons; on an Android emulator with their buttons,
  Back and a tap outside. On Windows the conformance runs in CI check that the host refuses one no platform shows; the
  dialog itself is built there, not measured yet.
- A phone's `dialog.open` has been measured from the page: in the iOS Simulator two files at once, whose copies match
  the files byte for byte, a filter, a folder and a cancel; on an Android emulator two files at once, a cancel and a
  folder refused.
- The two colors of `backgroundColor` have been measured in the iOS Simulator and on an Android emulator: the launch
  screen of each appearance, and the page's background and the system bars' icons as the system switches while the app
  runs.
- `device` has been measured on macOS, in the iOS Simulator as an iPhone and as an iPad, and on an Android emulator as
  a phone and, with its screen made larger, as a tablet. The Linux and Windows hosts build with it; neither has run it
  yet.
- `titleBar: 'hidden'` has been measured on macOS 27 with `app.window`: the window's buttons over the page's toolbar,
  centred in a toolbar 38 pixels high, and a button of the page under them taking its click. The Linux and Windows
  hosts build with it; neither has run it yet.
- The tray and notifications: the conformance runs on Windows click the icon, an item of its menu and the notification
  with the messages Windows sends the app, and those on Linux run against a tray and a notification server of the run's
  own, which read the icon and its menu as KDE's tray does, and click them. On macOS the runs set the icon and take it
  away, unclicked. Nobody has looked at the icon in a real KDE, GNOME or Windows tray yet, nor at a notification shown,
  nor at macOS's question for notifications.
- The icon has been seen in macOS's Finder, in the icon files of an iOS Simulator build and on Android's launcher;
  Windows and Linux apps carry it, but nobody has looked at it there yet.
- A download the page starts saves where its user picks on macOS, iOS and Android when it is a `Blob` or a `data:` URL
  the page holds. On macOS and iOS an `<a download>` link to one of the app's own files saves nothing yet, so the page
  fetches the file and saves it as a `Blob`; Android saves it. Of several downloads a page starts at once WebKit keeps
  the last, as each replaces the one before; started one after another, each saves in turn.
- Android's WebView hands the app neither a download link's name nor its bytes. So the host keeps, in the page's top
  frame, the `Blob` behind each `blob:` URL and each download link's name as it is followed, which a page's CSP does
  not hinder, and holds the download in memory while its user picks where it goes. A download that is no link of the
  page's takes its name from its address. The save picker gets the type of the name's extension, or none Android
  knows, as it gives a name the extension of its type where the two differ: the `text/plain` WebView guesses from a
  CSV's bytes would make `report.csv` into `report.csv.txt`. A name without an extension takes WebView's type.
- Downloads have been measured in the iOS Simulator and on an Android emulator, under a CSP of `default-src 'self'`:
  a `Blob`, every byte value, a `data:` URL, a non-ASCII name, a `blob:` URL the page revoked at once, a link tapped,
  one clicked outside the document, three in a row and a picker cancelled. On macOS a `Blob` has been. WebView2 and
  WebKitGTK handle downloads themselves on Windows and Linux, which has not been measured yet.
- iOS 15.1 or later, arm64 alone: devices, and the Simulator of an Apple silicon Mac. It builds on macOS with Xcode.
- During development an iOS app runs in the Simulator, or with `--device` on an iPhone or iPad on iOS 17 or later. A
  session on a device has been measured on an iPhone on iOS 27 on its cable with a paid team; a free Personal Team and
  the local network were measured by hand.
- Android 13 (API 33) or later, the level crossbind's Android libraries build against, with Android System WebView
  116 or later, the first that passes byte arrays as ArrayBuffer messages; an older WebView gets a message that names
  the version it needs. arm64-v8a and x86_64.
- An Android app builds on macOS and Linux. Its one activity shows the page under the system bars' insets.
- Vite only.
