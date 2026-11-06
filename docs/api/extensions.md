# App extensions

An app extension adds native code to an app (`target.runtimeEnv: 'app'`), which the app's host builds in: functions
the page calls by name, the URLs its route serves the page, the files it carries, and what it does as the app launches,
comes before its user and quits, as the system opens it with a link, a file, a user activity or a quick action, hands it
a notification or a push, and as the page navigates, downloads, drops files or asks for what it uses. A package of its
own carries it, as
[`@crossbind/extension-clipboard`](../../extensions/clipboard/README.md) carries the system clipboard's text on macOS,
iOS, Android, Windows and Linux, which an app lists. An extension may add a store the app is published to as well, as
[Publishers](#publishers) says, what installs a desktop app, as [Installers](#installers) says, and commands of
`crossbind app`, as [Commands](#commands) says.

crossbind's own are packages of the same kind, in its repository's `extensions/`: the host's, `activities`, `dialog`,
`files`, `instance`, `links`, `menu`, `page-dialogs`, `page-files`, `page-downloads`, `page-drops`, `page-location`,
`page-navigation`, `page-permissions`, `power`, `shell`, `shortcuts` and `updater`; the stores, `google-play`, `app-store`
and `github`; and the installers, `dmg`, `deb`, `tar-gz`, `nsis` and `zip`. An app has them without installing or listing
them, as `@crossbind/core-app-host` has them as its dependencies, and an app's extension takes the place of one, or of
one of its roles, as [The host's own extensions](#the-hosts-own-extensions) says.

An extension names the version of this contract it is written for, as [Versions](#versions) says.

## Using an extension

Install the package and list it in `crossbind.config.js`, which `crossbind add @crossbind/extension-clipboard` does with
the project's package manager, then import its functions in the page:

```js
// crossbind.config.js
import clipboard from '@crossbind/extension-clipboard/crossbind.extension.js';

export default {
    target: { runtimeEnv: 'app' },
    extensions: [clipboard()],
};
```

```js
// the page
import { readText, writeText } from '@crossbind/extension-clipboard';

await writeText('Copied from the app');
```

Only the extensions `extensions` lists are built in, with the host's own, and nothing loads at run time. A build checks
each one as the config loads, before anything compiles, and what the extensions give together, as their Info.plist
keys and Android manifests, as it writes each platform's project (see [crossbind-config.md](./crossbind-config.md)), and sees the project's
`paths.base` alone: a package linked in from beside the project, as a workspace's, takes `paths.base` set above both.
[`new-extension.md`](../playbooks/new-extension.md) is the order of the work of writing one.

## Versions

An extension names the versions of the contract it is written for: `contract: 1`, this one, or a list, as `[1, 2]` for
one written for both. Each crossbind takes a range of them, from the oldest it still builds to the newest, `1` to `1`
in this one: a build stops on an extension that names none of them, saying what to update, crossbind where the
extension names newer ones alone, else the extension's package, or `@crossbind/core-app-host` where the host's own
extensions are of another crossbind. Native code tells the versions apart with `CROSSBIND_EXTENSION_CONTRACT`, the
newest its host is built for, as `#if CROSSBIND_EXTENSION_CONTRACT >= 2` does, and an Android extension's Java with
`Extension.CONTRACT`.

A change that every extension written for the contract goes on working with raises the newest version alone: a
function, a hook, a member of a struct or of a request, a key of the descriptor or a member of the api that is new, and
a role a new extension of the host's holds. One that breaks an extension raises the oldest as well, so that an
extension names the new version once it is written for it: a name, a signature or a meaning that changes or goes, a
hook that runs on another thread or in another order, and a rule of a build's or of the app's that refuses more. Until
crossbind 2.0.0 such a change may come in any release, which marks it as breaking and says in its notes what an
extension's author changes; from 2.0.0 it waits for a major version. An extension's package names the crossbind
versions it works with as a peer dependency as well.

The contract is what this page gives, with `<crossbind/extension.h>` and `<crossbind/app.h>`, and Android's
`dev.crossbind.app.Extension` and `ExtensionHost`: no other file of crossbind's, as one a package imports from
`crossbind/src/`, is in it.

## What an extension is

A package with:

- `crossbind.extension.js`, whose default export is a function that gives the extension, as `crossbind.config.js`
  lists it; its arguments are the extension's options, which the app sets;
- the page's module, whose functions call the extension's by name, and its types;
- the native sources, for every platform or for each;
- a README of what it does on each platform.

The extension the function gives:

| Key | Value |
|---|---|
| `name` | Lowercase letters and digits, from a letter, which dashes may join. Each of the extension's function names starts with it and a dot, as `clipboard.readText`, or with a role's it takes, as `tray.set` does for one that takes `tray`, or the app stops as it starts, saying so; and it names its C++ entry, `crossbind_extension_<name>`, with underscores for dashes, and its events, as [The native side](#the-native-side) says. An app has one extension of a name, so a distinctive one, as its package's, keeps an extension from another's: two of one name stop the build. So does one named as a role another of the host's extensions holds, as `tray`, or `app`, `events`, `windows` or `crossbind`, or a name that starts with `page-`, all of which crossbind keeps: an extension takes the place of one of the host's with `replaces`. One named as an extension of the host's takes that one's place with its roles, as the build says, as a later crossbind may add one of a name an app has already. |
| `contract` | The version of the contract it is written for, `1`, or a list of the versions, as [Versions](#versions) says. |
| `replaces` | The roles of the host's own extensions it takes, one or a list, as `'tray'` or `['page-navigation', 'page-downloads']`, as [The host's own extensions](#the-hosts-own-extensions) says. |
| `fromApp` | A function of the [`api`](#the-api) that gives the options its native code reads, from the app's config, or `null`, which leaves the extension out of this platform's app. It runs as a build starts, and takes the place of `options`. |
| `root` | The absolute path of the extension's folder, `import.meta.dirname` in `crossbind.extension.js`. It is under the project's `paths.base`, as all a build sees is. |
| `app.sources` | The C and C++ sources every platform compiles, relative to `root`. |
| `app.includes` | The extension's folders its sources' includes are found in, beside the host's `<crossbind/extension.h>` and `<crossbind/app.h>` and the platform's headers, which are all they see of the host. |
| `app.defines` | The macros its sources compile with, `NAME` or `NAME=value`, a value of letters, digits and `_.+-`. A debug build defines `CROSSBIND_APP_DEV` as well. |
| `app.files` | The files and folders the app carries for the extension on every platform, relative to `root`, as models, data and fonts are: each keeps its place in the folder `registry.files()` names, `ext/<name>/` among the app's resources, which a macOS bundle's `Contents/Resources` and an iOS one hold, a Linux or Windows app's `resources/`, and on Android a copy on disk the app makes as it first starts after each install, from its APK's assets. None holds a link, which could reach any file of the machine the app is built on, and a program among them runs on no platform: an extension links what it runs. The page reaches none of them but through the extension's own route. |
| `app.urlSchemes` | The schemes whose links the extension's native code gets through `onOpenUrl`, as [`app.urlSchemes`](./app.md#links)' rules take them, on every platform: an extension that declares them has native code on each platform the app builds for. The build tells each system of them beside the app's own, and two owners of one scheme stop the build, naming both. |
| `app.fileTypes` | The types whose files the extension's native code gets through `onOpenFiles`, as [`app.fileTypes`](./app.md#files)' rules take them, on every platform: an extension that declares them has native code on each platform the app builds for. The build tells each system of them beside the app's own, and two owners of one extension's files stop the build, naming both. |
| `app.links` | The https links of its sites that the extension's native code gets through `onOpenUrl` on iOS and Android, as [`app.links`](./app.md#the-apps-sites)' rules take them: an extension that declares them has native code there, and on the desktop calls `onOpenUrl` or not. Two owners of one entry stop the build, naming both. |
| `app.shortcutItems` | The quick actions of the app's icon whose taps the extension's native code gets through `onShortcutItem` on iOS and Android, as [`app.shortcutItems`](./app.md#quick-actions)' rules take them: an extension that declares them has native code there, and on the desktop calls `onShortcutItem` or not. The app lists them beside its own, and two owners of one type stop the build, naming both. |
| `app.activityTypes` | The types of the user activities the extension's native code gets through `onUserActivity` on iOS and macOS, as [`app.activityTypes`](./app.md#user-activities)' rules take them: an extension that declares them has native code there, and elsewhere calls `onUserActivity` or not. The app's Info.plist lists them beside the app's own, and two owners of one type stop the build, naming both. |
| `app.licenses` | The code of others the extension carries, which the app's license report lists beside the extension's package: `[{ name, version, license, file, source, sha256, notes }]`, its `license` an SPDX expression, which `crossbind licenses --check` checks, and `file` its license's text in the extension's folder; `source`, where the code comes from, and `sha256`, that source's, where it has them. |
| `app.<platform>` | What one platform adds, by the names crossbind's app commands give them: `macos`, `ios`, `linux`, `windows` or `android`. |
| `options` | What the extension's native code reads as `registry.options()`, as `crossbind.extension.js` takes it from the app: a JSON value alone, of plain objects, arrays, strings, finite numbers, booleans and null. Its native code leaves out the keys it knows nothing of, as a later version of its package's may give. |
| `publisher` | The store it sends the app to, as [Publishers](#publishers) says. |
| `installer` | What it makes to install a desktop app, as [Installers](#installers) says. |
| `commands` | The commands it adds under `crossbind app`, as [Commands](#commands) says. |

What a platform adds:

| Key | Platforms | Value |
|---|---|---|
| `sources` | all | Its own sources: C `.c` and C++ `.cpp`, `.cc` or `.cxx`, and on `macos` and `ios` Objective-C `.m` and Objective-C++ `.mm` too, which compile with ARC, and Swift `.swift`, which swiftc compiles first into the extension's module, its name with underscores for dashes, for the app's deployment targets. Its entry stays C++: Objective-C and Objective-C++ import `<module>-Swift.h`, which declares the module's `@objc` classes and `@_cdecl` functions, and C++ declares such a function itself, as `extern "C" int32_t probe_swift_sum(int32_t, int32_t) noexcept;`. |
| `includes`, `defines` | all | Its folders of includes and its macros on that platform, beside `app.includes`' and `app.defines`'. |
| `files` | all | The files and folders the app carries for it on that platform, beside `app.files`'. |
| `frameworks` | `macos`, `ios` | The Apple frameworks the app links, as `UniformTypeIdentifiers`. |
| `libraries` | `linux`, `windows`, `android` | The libraries the app links: Windows' own, as `comctl32`, and on Linux those of crossbind's sysroot and of its `packages`. |
| `packages` | `linux` | Ubuntu 22.04 packages beyond crossbind's sysroot, each as `"<arch> <file> <sha256>"`, of `amd64` or `arm64`, the SHA-256 the archive's Packages index gives, as `'amd64 libzstd-dev_1.4.8+dfsg-3build1_amd64.deb 9712…'`: crossbind downloads each once from Launchpad, checks it, and unpacks a target's into a sysroot of the extension's own, whose `usr/include` and each folder in it its sources include, and whose libraries the app links against, so a `-dev` package comes with its library's. A target whose architecture it lists none of stops the build. |
| `depends` | `linux` | What the app's Debian package depends on beside WebKitGTK and GTK, as its `Depends` takes a relation, as `'libzstd1'` or `'libsecret-1-0 (>= 0.20.5)'`: its users' systems load the libraries its `packages` gave at run time. |
| `maven`, `verification` | `android` | Maven libraries its Java and Kotlin use, each of one version, as `'org.jsoup:jsoup:1.18.1'`, and a file of the checksums of each file Gradle resolves for them, as Gradle's `--write-verification-metadata sha256` writes them into a project of the same dependencies: the app's Gradle project then resolves online, beside the android-app image's cache, and checks every file it resolves against the image's checksums and those of its extensions. A file two give other checksums of, and one that trusts files unchecked, stop the build. Both or neither. |
| `entitlements` | `macos`, `ios` | The entitlements the app takes: on macOS merged with `app.permissions`', on iOS written into the app's entitlements file. Two owners that give one key lists join them, and other values that differ stop the build. |
| `plist` | `macos`, `ios` | Info.plist keys, each with text, a number, a boolean, or a list or an object of them, as `{ NSContactsUsageDescription: reason }` with a reason the extension's options take from the app. A key crossbind writes from the app's config, as `CFBundleIdentifier` or a reason of `app.permissions`, the extension gives with the same value alone; two extensions that give one key lists join them, and other values that differ stop the build. |
| `privacy` | `ios` | Apple's reasons for the required reason API its code calls, as `app.privacy` gives them, as `{ userDefaults: ['CA92.1'] }`: the app's privacy manifest gives them beside `app.privacy`'s. |
| `targets` | `ios` | Apple's app extensions it adds to the app, as a widget, each a target of the app's Xcode project of its own, as [iOS app extensions](#ios-app-extensions) says. |
| `permissions` | `android` | The Android permissions the app asks for, by their full names, as `android.permission.READ_CONTACTS`, beside `app.permissions`', each once. Its Java asks its user for one that asks with the host's `afterAsking()`. |
| `manifest` | `android` | A manifest of its own, as an `AndroidManifest.xml` is, whose elements the app's takes: those of the manifest, as `<queries>` and `<uses-feature>`, beside the app's, and those of its `<application>`, which has no attributes, as the app's are its own, inside the app's application. Its `<manifest>` has no attributes but the `android` and `tools` prefixes, and it asks for no permission with `<uses-permission>`, which `permissions` lists. It takes `${applicationId}` as Gradle gives it, as for a `<provider>`'s authorities. |
| `resources` | `android` | A folder of Android resources, as `res/` holds them, which join the app's: one at a path the app has stops the build, naming the extension. Its Java reads them through the app's `dev.crossbind.app.R`. |
| `java`, `class` | `android` | The folder of the extension's Java, relative to `root`, whose `.java` and Kotlin `.kt` files alone join the app's sources, which the Android Gradle plugin compiles together, so that it may hold the manifest and resources as well, and the class in it the app calls, in Java or Kotlin, which implements `dev.crossbind.app.Extension` and has a public constructor without arguments: the app makes one of it, as it starts. Both or neither. An Android extension's Java takes the page's dialogs, permissions and file inputs, as Android's WebView asks for them in Java, and its C++ the rest, as [Android](#android) says. |

## The native side

One of the sources defines the entry, which adds what the extension does and starts nothing: it runs on the main thread
as the app starts, before the app's module, in every launch, one that another instance then takes as well. What the
extension starts as the app runs, it starts in `onStart`, once the launch is the app's. The registry lives as long as
the entry runs, so a function keeps a copy of what it needs of it, as of `registry.options()`. An entry that throws
stops the app, saying why and naming the extension:

```cpp
#include "crossbind/extension.h"

#include <stdexcept>

void crossbind_extension_clipboard(crossbind::Registry &registry) {
    registry.function("clipboard.writeText", [](crossbind::Call call) {
        const crossbind::Value &text = call.options()["text"];
        if (!text.isString()) throw std::invalid_argument("crossbind: clipboard.writeText takes a string");
#if defined(__ANDROID__)
        // Android's clipboard is its Java's.
        crossbind::android::callJava("clipboard", "writeText", call);
#else
        crossbind::onMainThread([call, text = text.asString()] {
            // The platform's clipboard takes the text here.
            call.resolve();
        });
#endif
    });
}
```

`<crossbind/extension.h>` gives the native code all it uses of the host:

| Name | What it is |
|---|---|
| `Value` | A JSON value, or bytes, which never changes, so any thread may hold a copy: `isString()`, `asString()`, `asString(fallback)` and the rest; `value["key"]`, null for a member it lacks; `json()`. Its bytes, a `Value::Bytes`, a `std::vector<std::uint8_t>`, are what a typed array, a `DataView` or an `ArrayBuffer` of the page's holds, and reach the page as a `Uint8Array`: `isBytes()`, `asBytes()`, and `json()` throws on them. |
| `Call` | A call of the page's: its `name()`, `options()` and `page()`. Its function answers it once, from any thread, with `resolve(value)` or `reject(message)`; a call that every copy lets go of unanswered fails, saying it gave no answer. `isFromPage()` is false for the calls of the app's native code, through `invoke()`, which reaches more than the page may. Before its answer, `send(value)` from any thread sends the page a message, which the `onMessage` the page passed gets, in the order they were sent, all of them before `invoke()` resolves; one after the answer goes nowhere, as does each of a call whose page passed no `onMessage`, or of one the app's native code made. `onCancel(fn)` runs `fn` once, on the module's thread, as the page cancels the call through its signal, or another page replaces it, as a reload does: the call answers nothing from then on. Each `fn` given runs, in the order given, and an answered call lets go of them. |
| `Page`, `Window` | A page of the app's, from its start, as `onPage` tells, until the next replaces it: its `id()` within the run, never 0, and the `windowId()` of the window it is in; a call of the app's own code is of none, 0 for both, and an Android page of no window an extension reaches, 0. A window of the app's, for the main thread while it is open: its `id()` within the run, from 1, the platform's `native()` window, as `appWindow()` gives the oldest one's, its `webView()`, as `appWebView()` does, and from any thread the `page()` it shows now, which a reload replaces, of id 0 once it closed. |
| `Registry::function(name, fn)` | Adds a function the page calls by that name, which starts with the extension's own and a dot, or with a role's it takes, as `tray.` for one that takes `tray`. The page's calls run it on the module's thread, which it must not hold up: it answers there, or hands the call on. A call of the app's native code runs it on the caller's thread, so it may run on several at once. What it throws fails the call. |
| `Registry::route(fn)` | Answers the page's requests for the extension's URLs, as [Routes](#routes) tells. |
| `Registry::options()` | The extension's `options`, a `Value`: null without any. |
| `Registry::events()` | What the extension sends the pages as its events, from any thread, each named after the extension, as an event `changed` of `clipboard`'s reaches the pages' listeners of `clipboard.changed`: `emit(name, value)` reaches every page that listens to the name, and `emit(name, value, page)` that page alone; `emitToFront(name, value)` reaches the page in front that listens, of the window its user used last, for what one page is to act on once, as a click; and `hold(name, value)` keeps each until a page asks with `events.held()`, as what came before it listened, then hands it to the page in front that asked. A value with bytes throws. |
| `Registry::onLaunch(fn)` | Takes a desktop app's launches, as one extension alone does: `fn` gets the `Launch` of this process, its `args`, `cwd` and the `token` that lets a Linux window take the front, on the main thread before the module starts, and hands the app later ones with `launchedAgain()`. `false` ends the launch with exit status 0; what `fn` throws ends it with status 1 and says why, in a message box as well when the app's user opened it. iOS and Android keep an app to one instance themselves and never call it. |
| `Registry::onStart(fn)` | Runs `fn` once on the main thread as the app starts, once every extension's entry ran and the launch is the app's, before its module starts and its first window opens: where the extension starts what it does as the app runs, and holds what the page is to hear of first, which the page gets once it asks. A launch that `onLaunch` ends never calls it, and Android's UI thread runs it as the activity first starts. What `fn` throws stops the app, as an entry's does, once every extension's `onQuit` ran. |
| `Registry::onWindow(fn)`, `onWindowClosed(fn)` | Run `fn` on the main thread with the `Window` as each window of the app's opens, before its page loads, as the host's `power` starts hearing of the system's sleep from the first, and as it closes, while it is there. A desktop app opens its first window as it starts and another for each `windows.open()` of a page's, which close as their user closes them, and all as the app quits, before `onQuit`; an iOS app opens one for each scene that connects, which closes as its scene disconnects; an Android app has none an extension reaches and calls neither. An app that fails runs `onQuit` alone. |
| `Registry::files()` | The folder of the files the extension carries, as `app.files` and its platform's `files` list them, each in the place it had in the extension's folder: read-only, within the app, a copy on disk on Android. |
| `Registry::onPage(fn)` | Runs `fn` on the module's thread with the `Page` as each page of the app's starts, the first one and each that replaces the page before it, as a reload does: once the calls of the page before have reached their functions, before the new page's do. It is where the extension lets go of what it kept for the page before, whose calls get no answer from then on. A load may start more than one page, each of an id of its own. |
| `Registry::onClose(fn)` | Asks `fn` on the main thread with the `Window` as a window of the app's closes on the desktop, as its user closes it, the page's `windows.close()` does, or on Windows and Linux another program, as `taskkill` without `/F` does: `false` keeps the window open, as an app that stays in its tray, which hides the window itself, and asks no other extension. The app quits as its last window closes. A window that closes with its parent goes without asking, as do all as `app.quit()` closes them; the menu's `quit` item and the system's own quit, as from the macOS Dock, ask `onQuitRequest` instead. A phone's app has no window its user closes, and iOS closes an iPad's without asking `fn`. |
| `Registry::onActive(fn)` | Runs `fn` on the main thread with whether the app is before its user, once its first window has opened, and again as that changes: `true` as it becomes the active app on the desktop or comes to a phone's foreground, `false` as another app takes its place, or a phone's is interrupted, by a call, a system alert or another app's picker, or goes to the background. A Linux app is active while one of its windows has the focus, which a dialog of its own takes as well. The pages hear each change as the events `active` and `inactive`. `fn` returns at once: a modal loop in it lets the next change through first. |
| `Registry::onQuitRequest(fn)` | Asks `fn` on the main thread as the app's user or its system asks the app to quit, other than by closing its window: macOS's Quit, as ⌘Q, the Dock's and logging out do, the end of a Windows session, but for the Restart Manager's, which closes the app to service the system, and the menu's `quit` item and `app.requestQuit()`, which `<crossbind/app.h>`'s `requestQuit()` asks from native code. `false` keeps the app running, and asks no other extension. `fn` answers at once: one that asks its user returns `false`, asks, and on their answer quits with `quit()`, as `requestQuit()` would ask it again. `app.quit()`, a relaunch and an update quit without asking, and Linux's and a phone's system ask nothing. |
| `Registry::onReopen(fn)` | Runs `fn` on the main thread as the app's user opens the app that runs again, on macOS: a click of its Dock icon, or `open` with no file or link. The host shows the app's windows first, as those an app in its tray hid, the one in front last. |
| `Registry::onQuit(fn)` | Runs `fn` once as the app quits or fails, before its module stops: on the main thread as it quits, on the thread that fails it as it fails; never in a launch that `onLaunch` ends, nor in one whose extensions' entries fail. A phone's system may end an app without either. |
| `Registry::onOpenUrl(fn)` | Gets each link of the extension's `app.urlSchemes`, and on iOS and Android of its `app.links`, as an `OpenUrl` of its `url`, wherever the system hands it over: in a launch's arguments, as macOS's Apple Event, to the iOS scene or in the Android intent. The page hears of none of these links. A link is whatever the system hands the app, so `fn` takes it as it would any address from outside. An extension that declares schemes or links calls it, and one that calls it declares them, but for the holder of `links`, which gets the app's own. |
| `Registry::onOpenFiles(fn)` | Gets the files of the extension's `app.fileTypes` the system opens the app with at once, as an `OpenFiles` of their absolute `paths` and the `mimeTypes` they came with, an Android file's and `""` elsewhere, wherever it hands them over: in a desktop launch's arguments, as [Files](./app.md#files) tells, as macOS's Apple Event, to the iOS scene, a document where it is, which the app may read and write as long as it runs, or in the Android intent, one file an opening, a copy in the app's cache of a `content:` address, which goes to the owner of the MIME type it came with before the owner of its name's extension. The page hears of none of these files. An extension that declares file types calls it, and one that calls it declares them, but for the holder of `files`, which gets the app's own and those no extension's type takes. |
| `Registry::onUserActivity(fn)` | Gets each user activity of the extension's `app.activityTypes` the system continues an iOS or macOS app with, as Handoff from another of its user's devices hands it over, the launch's own among them: a `UserActivity` of its `type`, its `userInfo`, a property list's values as JSON values and bytes, a date as its ISO 8601 text, a URL and a UUID as theirs and a set as an array, and its `webpageUrl`, empty without one. `fn` returns whether it took it, as macOS tells its user of one it could not continue. A web page's, a site's link, goes to `onOpenUrl`. The page hears of none of these activities. An extension that declares types calls it on Apple's platforms, and one that calls it declares them, but for the holder of `activities`; another platform continues none. |
| `Registry::onShortcutItem(fn)` | Gets each tap of a quick action of the extension's `app.shortcutItems` on an iOS or Android app's icon, the launch's own among them, as a `ShortcutItem` of its `type`: `fn` returns whether it took it, which iOS hears. The page hears of none of these taps. An extension that declares quick actions calls it on the phones, and one that calls it declares them, but for the holder of `shortcuts`; a desktop has none. |
| `Registry::onNotification(fn)` | Gets each notification of an iOS or macOS app's, its own and pushes alike, as the system shows one while the app is in front and as its user answers one, the tap that launched the app among them: every extension's `fn` hears of each, in the extensions' order, as [Notifications and push](#notifications-and-push) tells. Another platform calls it with none. |
| `Registry::onPushToken(fn)`, `onPushTokenFailure(fn)`, `onPushMessage(fn)` | Get the app's push token on iOS and macOS, a `PushToken`, once `registerForPush()` asked for it, or a `PushTokenFailure` of why the system gave none, and each silent push the app gets: every extension's `fn` hears of each, as [Notifications and push](#notifications-and-push) tells. Another platform calls none of them. |
| `Registry::onPageDialog(fn)`, `onPagePermission(fn)`, `onFileInput(fn)` | Take the page's dialogs, what it asks to use and its file inputs, as the holder of `page-dialogs`, `page-permissions` or `page-files` alone does: see [The page's requests](#the-pages-requests). Not on Android, where its Java takes them. |
| `Registry::onNavigation(fn)`, `onHttpAuthentication(fn)`, `onCertificateError(fn)` | Take the page's navigations beyond the app's origins, as the holder of `page-navigation` alone does, and the HTTP authentications and certificate errors of its requests, as the holder of `page-authentication` alone does, on every platform: see [Navigation](#navigation). |
| `Registry::onDownload(fn)` | Takes the page's downloads, as the holder of `page-downloads` alone does, on every platform: see [Downloads](#downloads). |
| `Registry::onDrop(fn)` | Takes the files the app's user drops on the page, on the desktop, as the holder of `page-drops` alone does: see [Drops](#drops). |
| `launchedAgain(launch)` | On the desktop, hands the app a later launch that the extension's `onLaunch` took from another process, from any thread: on the main thread, in the order of the launches, the window in front comes to the front, the page in front that listens hears of the launch as the event `second-instance`, its links reach the owners of their schemes, and in an app that opens files its files the owners of their types. |
| `launchArgs()` | The `Launch` the app started with, from any thread: its `args` without the links of the app's schemes and, in an app that opens files, its files, which reach their owners, as the page's `app.launchArgs()` gives them. A phone's app starts with none. |
| `inBackground(call, work)` | Runs `work` on a thread of its own, which answers the call with what `work` returns, or with what it throws. |
| `invoke(name, options, done)` | Calls one of the app's functions by its name, as the page does, from any thread once the app's extensions have all started: the function runs on the caller's thread, and its call is no page's. `done` gets why the call failed, or its result, once, on the thread that answers: the caller's, before `invoke` returns, for a call that fails at once or that its function answers there. A call of `windows` names its window by `id`, as no page's window is its own. |
| `onMainThread(fn)` | Runs `fn` on the app's main thread, where the platform's UI is called, after what waits there already, also when the caller is on it. A modal loop `fn` runs, as a dialog's, holds the next until `fn` returns, but on Linux, where that loop runs them. What `fn` throws goes to the app's output, and a call `fn` held fails as it lets go of it. One given as the app quits, as in `onQuit`, may never run. Not on Android. |
| `appWindow()` | The oldest of the app's open windows, on the main thread: an `NSWindow` on macOS, a `UIWindow` on iOS, a `GtkWindow` on Linux and an `HWND` on Windows; null while it has none. Not on Android. |
| `appWebView()` | That window's webview, on the main thread: a `WKWebView` on macOS and iOS, an `ICoreWebView2Controller` on Windows, and on Linux a `WebKitWebView` in a vertical `GtkBox`, which puts the widgets an extension adds to it with `gtk_container_add` above the page at their own height: the window holds the page to its limits, with their height added. Null while the app has none. Not on Android. |
| `windowOf(id)`, `openWindows()` | The open `Window` of an id, as a `Page`'s `windowId()` names it, or none for one that closed, and every open window, the oldest first, on the main thread: what a page's request is shown over, as the host's `page-dialogs` shows a dialog over the page's own window. Not on Android. |
| `askPagePermission(kinds, origin, done)` | Asks the holder of `page-permissions`, as the webview does, whether the page of `origin` may use these kinds, of the table in [the page's requests](#the-pages-requests): for an extension that gives the page what its webview lacks, as the host's `page-location` gives a macOS page its location. From any thread; `done` gets the answer once, on the main thread, false without a holder and for its `useDefault()`. Not on Android. |
| `appName()`, `appId()` | The app's name, as its window and dialogs show it, and its id, as `app.id` gives it: its bundle identifier on Apple's platforms, its application id on Android. |
| `registerForPush()` | On iOS and macOS, asks the system for the app's push token, from any thread: each extension's `onPushToken` gets it, or its `onPushTokenFailure` why the system gave none, as to an app without the `aps-environment` entitlement. |
| `addNotificationCategories(categories)` | On iOS and macOS, adds an `NSSet` of `UNNotificationCategory` to the categories the app's notifications take, from any thread: the system's own call would replace every other extension's with them, while here one of an identifier another gave takes that one's place alone. |
| `allowPath(path)` | Lets the page reach a file or folder through `crossbind/app`'s shell functions from now on, as what its user picked: a picker's answer, for one. |
| `allowedPaths()` | What `allowPath()` was given so far, as it was given. |
| `android::callJava(extension, function, options, done)` | On Android, calls a function of the extension's Java on the UI thread with the app's host; `done` gets why it failed, or its result, once. What `done` throws goes to the system's log, and a call `done` held fails as it lets go of it. `callJava(extension, function, call)` hands the Java a page's call whole: its options, the Java's messages, which reach the page, the page's cancel, which reaches the Java, and its answer. |
| `<crossbind/app.h>` | The app's folders and quitting, as its native code calls them, and the events it sends the pages by the host's names, which have no dot: `emitEvent()` to every page that listens, or to one by its id, `emitEventToFront()` to the page in front that listens, and `holdEvent()` for those a page takes once it asks, as an extension in the place of one of the host's sends the host's events. |

What an extension throws:

| Where | What it does |
|---|---|
| The entry | Stops the app, saying why and naming the extension, as an app that cannot start does (see [app.md](./app.md#the-window)). |
| `onStart` | Stops the app as the entry does, once every extension's `onQuit` ran. |
| A function | Fails its call. |
| `onLaunch` | Ends the launch with exit status 1, saying why. |
| `onWindow`, `onWindowClosed`, `onPage`, `onActive`, `onReopen`, `onQuit`, `onOpenUrl`, `onOpenFiles`, `onNotification`, `onPushToken`, `onPushTokenFailure`, `onDrop`, a download's `onProgress` and `onFinish`, a task of `onMainThread` | Goes to the app's output, and the app goes on. |
| `onUserActivity`, `onShortcutItem` | Goes to the app's output, and the activity or the tap is not taken: macOS tells its user it could not continue the user activity. |
| `onPushMessage` | Goes to the app's output, and its answer is `noData()`. |
| `onClose` | Goes to the app's output, and the window closes, unless another extension keeps it. |
| `onQuitRequest` | Goes to the app's output, and the app quits, unless another extension keeps it running. |
| The owner of a request of the page's | Cancels the request. |
| A route | Answers 500, with what it threw. |
| An `onCancel` | Goes to the app's output. |

The host's own extensions start first, in the order of their names, then those `extensions` lists, in its order, and
each kind of hook runs in that order. Each hook of what the system hands the app, a launch, a link, a file, a user
activity, a quick action's tap, a notification and a push, runs on the main thread, Android's UI thread there, one at a
time, in the order the system hands them over: the next waits for each to return. A function and a route run where their calls and
requests come from, as their rows say. An extension sends the page its events through `registry.events()`, and on
Windows takes the messages it posts the app's window from `RegisterWindowMessageW`, as the host's `menu` does, so that
they are no other extension's.

A function checks every option the page gives, and a call it refuses rejects with why and what mends it, starting with
`crossbind:`: it never does nothing. Only the app's own page reaches the functions, as the host admits no other origin,
and a function that reaches beyond what the page could do itself, as one that opens files, takes the app's opt-in: the
options of the extension's function in `crossbind.config.js`, which build its native code in only then.

## Messages, cancels and bytes

A function sends the page messages before its answer with `call.send()`, from any thread: the page's `onMessage` gets
them in the order they were sent, all of them before `invoke()` resolves, so progress, a stream of values or a
subscription goes to the call that asked for it alone. The page cancels a call through the `signal` it passed:
`invoke()` rejects with the signal's reason, and the call's `onCancel` runs on the module's thread, as it does for each
call of a page another replaces, as a reload does. A call answers nothing once it is cancelled.

```cpp
registry.function("reader.read", [](crossbind::Call call) {
    auto isStopped = std::make_shared<std::atomic<bool>>(false);
    call.onCancel([isStopped] { *isStopped = true; });
    std::thread([call, isStopped] {
        crossbind::Value::Bytes file;
        for (int part = 1; part <= 10 && !*isStopped; part += 1) {
            // A part of the file is read into file here.
            call.send(crossbind::Value::Object{{"part", part}, {"of", 10}});
        }
        call.resolve(std::move(file));
    }).detach();
});
```

Options, messages and results carry bytes beside JSON: a typed array, a `DataView` or an `ArrayBuffer` of the page's is
a `Value::Bytes` in native code, anywhere in the options, and native code's bytes are a `Uint8Array` on the page. The
page's bytes from 16 KiB up, and a result that is bytes from 4 KiB up, travel apart from the message's text, as the
module's do; those in a message or in a result's object go in its text, in base64, so a large file is better served
by a route.

## Routes

An extension serves the page URLs of its own, `crossbind://app/ext/<extension>/<path>`, which Android's WebView takes as
`https://appassets.androidplatform.net/ext/<extension>/<path>`, and which `routeUrl(extension, path)` from
`crossbind/app` names, for the page's `<img>`, `<video>` and `fetch()`. Its route gets each GET and HEAD, with the path
decoded and the request's headers. The host answers another method with 405, as Android's WebView gives no request's
body, so what the page sends goes as a call's options; a path that could lead out of a folder it is joined to with 400;
and a URL of an extension without a route with 404. Any of the app's pages may load the URLs, as they load the page's
own files, without the token the page's calls carry, so a route serves what the page may see. The page's own files
keep out of a folder `ext` at their top, whose URLs the routes take.

```cpp
registry.route([folder = registry.options()["folder"].asString()](crossbind::Request request) {
    if (request.path() == "/hello.txt") {
        request.respond(200, {{"Content-Type", "text/plain; charset=utf-8"}}, "hello");
        return;
    }
    // A file of the extension's folder, which the host reads on a thread of its own.
    request.respondFile(folder + request.path());
});
```

| `Request` | What it is |
|---|---|
| `method()` | `GET` or `HEAD`. |
| `path()` | What follows the extension's name, decoded, from its `/`, as `/clips/intro.mp4`: never with a part `..`, nor an empty one, and on Windows never with a `\` or a `:`, so it joins to a folder within it. |
| `query()` | What follows the `?`, as the URL has it. |
| `header(name)` | The request's header of that name, in any case, or `""`. |
| `page()` | The page that asks. |
| `respond(status, headers, body)` | Answers with the whole body, of the type its `Content-Type` header names, `application/octet-stream` without one; a HEAD gets the headers alone. A webview follows no redirect of an app's URLs, so `status` is no 3xx one. |
| `respondFile(path)` | Answers with a file, which the host reads on a thread of its own, of the type its extension names, as for the page's files: the part a `Range` header asks for, as 206, up to 4 MiB of it, from where the webview asks for more, as a video's player does; 416 for a range past its end; the whole file otherwise; 404 for no regular file there. |

The route runs on the thread the webview asks on, the main thread but on Android, which it must not hold up: it answers
there, or hands the request on, as `respondFile()` does to a thread of its own. A request that every copy lets go of
unanswered gets 500. A route answers whole, as WebView2 reads a response only once all of it is there: what comes in
parts, as progress or a log, goes as a call's messages. Android's WebView takes a request's Range to any answer, as a
server would to its whole body: a route's 200 to such a request gives the page the part the range names, and its 206,
as `respondFile()`'s, and its failures reach the page as the route gave them. It measures an answer in an int, so it
takes no file of 2 GiB or more. During development the page comes from the dev server, so the routes answer any
origin, as the page's files do.

## Launches and links

The host's `instance` keeps a desktop app to one instance through `onLaunch`, `onQuit` and `launchedAgain()`, where
`app.singleInstance` asks for it (see [app.md](./app.md#one-instance)). An app sets `app.singleInstance` to `false` for
an extension of its own to take the launches instead, with the same hooks, or lists one that takes the role
`instance`, in the host's place.

An extension gets the links of a scheme of its own, as a sign-in's redirect, without the page:

```cpp
void crossbind_extension_signin(crossbind::Registry &registry) {
    // crossbind.extension.js gives app.urlSchemes: ['com.example.app.signin'].
    registry.onOpenUrl([](const crossbind::OpenUrl &open) {
        // The sign-in's code is in open.url; the call that started the sign-in resolves here.
    });
}
```

The host hands each link to the owner of its scheme, wherever it comes from: the holder of `links` owns those of
`app.urlSchemes`, which the host's holds for the page as the event `open-url`. A link reaches `onOpenUrl` once the
app's module has started, and a later launch's arguments, which `second-instance` carries, leave every link out.

An extension that hands the page what came before it listened, as `links` does, holds it with `registry.events()`'s
`hold()`, which the page takes with `events.held(name)` from `crossbind/app` (see
[app.md](./app.md#events-and-callbacks)). One that takes the role `links` gets the links of `app.urlSchemes` through
`onOpenUrl`, which it calls, and hands each it lets through to the page as the host's does, with `<crossbind/app.h>`'s
`holdEvent("open-url", {"url": …})`, which `app.launchUrls()` and the event `open-url` give.

The files of a type of its own reach an extension as the links of a scheme do, through `onOpenFiles`, and the host's
`files` holds those of `app.fileTypes` for the page as the event `open-files`, with those no extension's type takes.
On iOS and Android the https links of an extension's `app.links` reach its `onOpenUrl` beside its schemes'.

A user activity of a type of its own reaches an extension on iOS and macOS through `onUserActivity`, as the links of a
scheme do, and the host's `activities` holds those of `app.activityTypes` for the page as the event `user-activity`.
The taps of a quick action of its own reach it on iOS and Android through `onShortcutItem`, and the host's `shortcuts`
holds those of `app.shortcutItems` for the page as the event `shortcut-item`.

## Notifications and push

On iOS and macOS the host owns the system's notification center: it takes it as the app launches, before the tap that
launched the app comes, which reaches the extensions after their entries ran. An extension leaves the center's delegate
as it is, and hears of each notification through `onNotification`, beside the others:

```cpp
void crossbind_extension_chat(crossbind::Registry &registry) {
    registry.onNotification([events = registry.events()](const crossbind::Notification &notification) {
        if (!notification.payload()["chat"].isString()) return;
        // A message that comes while the app is in front shows in the list alone.
        if (!notification.isAnswered()) notification.present({false, true, false, false});
        // A tap that launched the app comes before the page listens, which the host holds as the event chat.opened.
        else if (notification.isTap()) events.hold("opened", notification.payload());
    });
}
```

A `Notification` is one the system shows while the app is in front, or one its user answered: `id()`, `title()`,
`body()` and `payload()`, its userInfo, as a user activity's is ([app.md](./app.md#user-activities)), `isRemote()` for
a push, `isAnswered()`, `isTap()` for the tap that opens the app, `isDismissed()` for one its user dismissed, which a
category with a dismiss action tells, and `action()`, the identifier of another action, one of its category's, or
empty. How the system shows one while the app is in front, `present({ banner, list, sound, badge })`, is the first
hook's that calls it, while the hooks run; without one, as a banner, in the list and with its sound. The host's `menu`
hears of the taps of its own `notification.show()` so, which it hands the page as the event `notification` while the
app runs. An extension adds the categories of its notifications, with their actions, through
`addNotificationCategories()`, beside every other extension's.

An extension asks for the app's push token with `registerForPush()`, and gets it through `onPushToken`, its `token`, or
why the system gave none through `onPushTokenFailure`; every extension that listens hears of both. The token is text
the extension hands its push provider as it is, on Apple's platforms the APNs device token in lowercase hex. The app needs the
`aps-environment` entitlement on iOS and `com.apple.developer.aps-environment` on macOS, which the extension's
`entitlements` give with the environment of its pushes. A silent push reaches every `onPushMessage` with its payload
and a `PushDone`, which answers once, from any thread: `newData()`, `noData()` or `failed()`, and `noData()` when let go
of unanswered. iOS hears the answers as one once each has answered, or 25 s after the push came, of the 30 it gives:
`newData` where one gave it, else `failed` where one gave that, else `noData`; macOS takes none. A silent push needs
`UIBackgroundModes` with `remote-notification` on iOS, which the extension's `plist` gives. The page hears of none of
this unless an extension tells it, through `registry.events()`.

## The page's requests

The page's `alert()`, `confirm()` and `prompt()`, what it asks to use, as the camera through `getUserMedia()`, and the
files its user picks through a file input reach the holder of each one's role, `page-dialogs`, `page-permissions` or
`page-files`: the host's own extension of that name, or the one `extensions` lists in its place. Its entry calls the
hook once:

```cpp
// An app's acme-dialogs, whose crossbind.extension.js gives replaces: 'page-dialogs' and this source to each platform
// but Android, whose Java takes the dialogs: every dialog answers OK, and a prompt() with its text unchanged.
void crossbind_extension_acme_dialogs(crossbind::Registry &registry) {
    registry.onPageDialog([](const crossbind::PageDialog &dialog) { dialog.accept(dialog.defaultText()); });
}
```

| `fn` gets | What it is |
|---|---|
| `PageDialog` | `kind()`, `alert`, `confirm` or `prompt`; its `message()` and a prompt's `defaultText()`. `accept(text)` is OK, with a prompt's text, and `cancel()` Cancel. |
| `PagePermission` | `kinds()`, what it asks for together, as `camera` and `microphone`; the `origin()` of the frame that asks, as `crossbind://app`, on Linux the page's, as WebKitGTK names no frame; and `isListed()`, whether `app.permissions` lists each of them, false for a kind that is no device. `allow()` or `deny()` answers it. |
| `FileInput` | `allowsMultiple()`, `allowsFolders()` and the types its `accept()` names, where the webview tells them: macOS's tells no types, and WebKitGTK no folders. `pick(paths)` answers with the files picked, and `cancel()` with none. |

Each gets the `page()` that asks as well, and `useDefault()`, which leaves the request to the webview where it takes
one: WebKitGTK on Linux shows its own dialog and file picker where the owner calls it before its hook returns, and
denies a permission; WebKit on Apple's platforms and WebView2 on Windows ask their user for a permission; anywhere else
a dialog and a file input are cancelled. `fn` runs on the main thread, where it may show a modal dialog of the
platform's, while which it may be asked again, and the request is answered once, from any thread, as the page waits.
One that every copy lets go of unanswered, or whose `fn` throws, is cancelled: an alert closes, a confirm gives false
and a prompt null, a permission is denied and a file input gets no files. A page of another origin, which
`page-navigation` may load, gets no dialog and nothing it asks to use, as each would show under the app's name: the
host cancels them before any extension hears of them. The kinds, each by the name crossbind gives it:

| Kinds | Where |
|---|---|
| `camera`, `microphone`, `location` | Every platform |
| `clipboard` | Linux and Windows, as a read on its user's gesture |
| `motion` | iOS |
| `screen`, `notifications`, `device-info`, `media-keys`, `pointer-lock`, `website-data`, `media-plugins` | Linux |
| `notifications`, `files`, `fonts`, `midi`, `window-management`, `downloads`, of several files at once | Windows |
| `media-keys`, `midi` | Android |
| `unknown` | Any request crossbind names none of, as a later webview's |

| | `page-dialogs` | `page-permissions` | `page-files` |
|---|---|---|---|
| macOS | Every dialog | The camera, the microphone, and the location `page-location` gives the page, which asks about it once a run | Every file input |
| iOS | Every dialog | The camera, the microphone, the location and the device's motion | None: WKWebView shows its own picker |
| Linux | Every dialog | Every request of WebKitGTK's | Every file input |
| Windows | Every dialog | Every request of WebView2's but autoplay and the sensors, which it gives as it would. A clipboard read without its user's gesture is denied first. | None: WebView2 shows its own picker |
| Android | Through the Java, from a frame of the app's origins alone | Through the Java, from a frame of the app's origins alone | Through the Java |

The host's own `page-dialogs` shows the system's dialog, titled with the app's name; `page-permissions` allows what
`app.permissions` lists, which the system may then ask its user for, and a clipboard read, and denies the rest; and
`page-files` shows macOS's open panel and Android's picker. Where the holder of the role has no native code, as one
an app lists for macOS alone, the webview does as it would without crossbind: WKWebView answers a dialog at once, as an
alert's OK and a confirm's and a prompt's Cancel, and asks its own question for a permission, but for a macOS page's
location, which `page-location` then denies; WebKitGTK and WebView2 show their own dialogs, WebKitGTK denies a permission
and WebView2 asks; and an Android app's WebView shows its own dialogs and denies a permission. A page's `beforeunload`
asks nothing where `page-dialogs` takes the dialogs, as it never does on Apple's and Android's: the page leaves at once.

WKWebView gives a macOS page no location of its own. A macOS app whose `app.permissions` lists the location has the
host's `page-location`, which answers the top frame's `navigator.geolocation` from CoreLocation, with that reason,
once `page-permissions` allows the page the location: it asks through `askPagePermission()`, as an extension does that
gives the page what its webview lacks. An extension that takes the role `page-location` takes its place.

## Navigation

The app's own origins, `crossbind://app` and during development the dev server's, load in any frame without asking, and
a window the page asks for at one of them opens nowhere, as the app's windows open through `windows.open()`. Every other
URL the page goes to, in its top frame, in one of its frames or in a window it asks for, reaches the holder of
`page-navigation`: the host's own extension of that name, or the one `extensions` lists in its place. The HTTP
authentications and certificate errors of the page's requests reach the holder of `page-authentication`, the host's
`page-navigation` as well, unless an app's extension takes that role. Its entry calls the hooks once:

```cpp
// An app's acme-navigation, whose crossbind.extension.js gives replaces: 'page-navigation': its docs load in the app,
// and any other link its user follows opens in the browser.
void crossbind_extension_acme_navigation(crossbind::Registry &registry) {
    registry.onNavigation([](const crossbind::Navigation &navigation) {
        if (navigation.url().rfind("https://docs.example.com/", 0) == 0) return crossbind::NavigationAnswer::load;
        return navigation.isUserInitiated() ? crossbind::NavigationAnswer::openOutside : crossbind::NavigationAnswer::refuse;
    });
}
```

| `fn` gets | What it is |
|---|---|
| `Navigation` | Its `url()`; `isMainFrame()`, whether it loads the top frame, always on Linux, as WebKitGTK names no frame; `isUserInitiated()`, as a click on a link is; `isNewWindow()`, as `window.open()` and a link of `target="_blank"` ask for, never on Android, whose WebView loads those in the page's place itself; and the `page()` that navigates. `fn` returns its answer: `load` loads it in the app, a window's in the page's place, as the app opens no window of the page's; `openOutside` opens an http, https or mailto URL in the system's browser or mail app, and refuses any other; `refuse` and `useDefault` refuse it, as without an owner. |
| `HttpAuthentication` | A server's ask for a name and password, as HTTP's Basic, Digest and NTLM authentication and a proxy's are: its `host()`, with its port as an origin names it, which Android's WebView leaves out; its `realm()`; `isProxy()`, whether a proxy asks, never on Windows and Android, whose webviews do not tell; and the `page()` whose request it is. `answer(user, password)`, `cancel()` or `useDefault()`, a cancel, answers it: a cancel goes on without them, so the page gets what the server answers to that. |
| `CertificateError` | A request to a server whose certificate the system does not trust: its `url()`, on Apple's platforms its origin alone; its `host()`; its `reason()`, a sentence, the system's own on Apple's platforms; and its `page()`. `trust()` lets it go on, and the host's later requests with that certificate, as long as the app runs, and `refuse()` or `useDefault()` fails it. On macOS and iOS App Transport Security fails it all the same, but in an app whose Info.plist exempts its webviews: an extension that trusts certificates gives `plist: { NSAppTransportSecurity: { NSAllowsArbitraryLoadsInWebContent: true } }` on `macos` and `ios`, and a `trust()` in an app without it says so in the app's output. Android's WebView refuses each without asking, as Android asks of an app. |

A navigation's `fn` runs on the main thread and answers as it returns, as the webview waits for it: one it throws on
is refused. Android's WebView asks about no frame's first load, which goes on without `page-navigation`, as a frame's
later navigations do not. An authentication and a certificate error are answered once, from any thread: one that every
copy lets go of unanswered, or whose `fn` throws, is cancelled or refused. Their `fn` runs on the main thread as well,
where it may show a modal dialog, which on Windows runs once WebView2's event has returned.

The host's own `page-navigation` loads the origins `app.navigation.load` lists, opens any other link its user follows
outside and refuses the rest. As the holder of `page-authentication` it takes neither authentications nor certificate
errors, which the app then cancels and refuses. A page of another origin that loads gets no token, so it reaches none of the app's functions, nor reads any of
its files.

## Downloads

What the page downloads, as a link with a `download` attribute does, or a response the webview cannot show, reaches
the holder of `page-downloads` before any of it is saved: the host's own extension of that name, or the one
`extensions` lists in its place. Its entry calls the hook once:

```cpp
#include "crossbind/app.h"
#include "crossbind/extension.h"

// An app's acme-downloads, whose crossbind.extension.js gives replaces: 'page-downloads': each download goes to the
// app's data folder, and the page hears of it as the event acme-downloads.saved or acme-downloads.failed.
void crossbind_extension_acme_downloads(crossbind::Registry &registry) {
    registry.onDownload([events = registry.events()](const crossbind::Download &download) {
        download.onFinish([events](const crossbind::DownloadEnd &end) { events.emit(end.path.empty() ? "failed" : "saved"); });
        download.saveTo(crossbind::app::paths().data + "/" + download.suggestedName());
    });
}
```

| `Download` | What it is |
|---|---|
| `url()`, `suggestedName()`, `mimeType()`, `size()`, `page()` | Its address; the file's name, as the page's link or the server names it, or as the URL ends, a name alone with no folder in it; its MIME type, `""` where the webview tells none; its size in bytes, -1 where the server tells none; and the page that starts it. |
| `saveTo(path)` | Saves it at this absolute path, which it replaces once all of it has arrived: it arrives in a file beside the path first, so one that fails leaves the file there as it was. A path that is not absolute, or a folder's, throws. |
| `ask()` | Saves it as the host does without `page-downloads`: where the app's user picks, in macOS's save panel, iOS's export sheet and Android's save picker; in the user's Downloads folder on Linux; and through WebView2's own downloads on Windows. A failure there tells the app's user, as each did before. |
| `cancel()` | Refuses it before an answer, and stops it after one. |
| `useDefault()` | Saves it as without an owner, as `ask()` does. |
| `onProgress(fn)` | `fn` gets the bytes that have arrived and its size, -1 where the server tells none, on the main thread as they arrive, at most every 100 ms. Android's page hands a download over whole, so `fn` hears nothing there. |
| `onFinish(fn)` | `fn` gets, once on the main thread as the download ends, a `DownloadEnd`: the `path` it was saved at, on Android after `ask()` the `content:` URI of the picker's; or `isCancelled`, as it was cancelled before an answer or after one; or the `failure`, why it was not saved, as the system tells it. |

`fn` runs on the main thread, and the download is answered once, from any thread: one that every copy lets go of
unanswered, or whose `fn` throws before an answer, is cancelled. `onProgress` and `onFinish`, set before the answer, hear
of it from then on. Without an owner, as where the holder of `page-downloads` has no native code, each download saves
as `ask()` does.

The host's own `page-downloads` saves each download as `ask()` does. On Android, the page hands each download over,
its name and bytes, before `page-downloads` hears of it: a page that cannot, as one of another origin, saves nothing,
and the app's user is told.

## Drops

The files the app's user drops on a page of the app's origins, on the desktop, reach the holder of `page-drops` as the
page's own `drop` event goes on: the host's own extension of that name, or the one `extensions` lists in its place.
The page needs no `dragover` of its own, as the host takes every drag of files on the app's own pages.
`fn` gets a `Drop`, of their absolute `paths`, the page's point they were dropped at, `x` and `y` in CSS pixels from its
top left, and the `page`, on the main thread:

```cpp
#include "crossbind/extension.h"

// An app's acme-drops, whose crossbind.extension.js gives replaces: 'page-drops': the page reaches the PNG images
// dropped on it alone, and hears of them as the event acme-drops.images.
void crossbind_extension_acme_drops(crossbind::Registry &registry) {
    registry.onDrop([events = registry.events()](const crossbind::Drop &drop) {
        crossbind::Value::Array images;
        for (const auto &path : drop.paths) {
            if (path.size() <= 4 || path.compare(path.size() - 4, 4, ".png") != 0) continue;
            crossbind::allowPath(path);
            images.emplace_back(path);
        }
        if (!images.empty()) events.emit("images", std::move(images));
    });
}
```

The host's own tells the page, as the event `drop` of `{ paths, x, y }`, and lets it reach each path through
`crossbind/app`'s shell functions, as one its user picked. The page's own `drop` event goes on as in a browser, with
its `File`s. On Windows the host's script in the page lets it take files dragged over it, as WebView2 tells the files'
paths to the page alone, and a drop the page takes none of opens nothing, as `page-navigation` refuses the file. iOS
and Android take no drops of files.

## Android

The extension's Java answers what its native code asks through `android::callJava()`:

```java
package dev.example.clipboard;

import dev.crossbind.app.Extension;
import dev.crossbind.app.ExtensionHost;

import org.json.JSONObject;

public final class ClipboardExtension implements Extension {
    @Override
    public void call(ExtensionHost host, String function, JSONObject options, Call call) {
        switch (function) {
            case "writeText" -> {
                // The platform's clipboard takes options.optString("text") here.
                call.resolve(null);
            }
            default -> call.reject("crossbind: the clipboard extension's Java has no function " + function);
        }
    }
}
```

The activity calls each method on the UI thread with the `ExtensionHost`: its `activity()`, the page's `webView()`,
`afterAsking(permissions, then)`, which asks the app's user for permissions, and `startForResult(intent, (result,
data) -> …)`, which starts an activity for its result, so the requests of the activity and of other extensions never
meet the extension's own. `call` answers once, from any thread, with `resolve()`, which takes one of org.json's values
or a `byte[]`, in an object or an array as well, which the page gets as a `Uint8Array`, or `reject()`. What `call()`
throws fails the call; one that it never answers never settles, as Java tells the host of no copy let go. The
extension's options reach its Java as its native code passes them in `callJava()`'s, the page's bytes among them as a
`byte[]`. A call its native code hands it whole, with `callJava(extension, function, call)`, sends the page messages
before its answer with `send(value)`, from any thread, which a value `resolve()` would not take fails as `resolve()`
does, and hears of the page's cancel through `onCancel(fn)`, on the UI thread. An extension hears of the activity's
life through `onCreate`, `onNewIntent`, `onResume`, `onPause` and `onDestroy`, each a default of `Extension`'s, in the
order of the app's extensions, as the native hooks run, and what one of them throws goes to the system's log as the
others hear of it too. `Extension.CONTRACT` is the version of the contract the host is built for.

The Java of the holder of `page-dialogs`, `page-permissions` or `page-files` gets the page's requests through
`onPageDialog(host, dialog)`, `onPagePermission(host, request)` and `onFileInput(host, input)`, defaults of
`Extension`'s, on the UI thread, and answers each once, from any thread: `useDefault()` leaves a dialog or a file input
to the WebView, which shows its own dialog or no picker, where the hook calls it before it returns, and else cancels
it, and denies a permission, as the WebView would. One that is never answered keeps the page waiting, as Java tells
the host of no copy let go. One it throws on is cancelled, and a frame of another origin, which Android lets the page
hold, gets no dialog and nothing it asks to use. `FileInput`'s `params()` is the WebView's account of the input, whose
`createIntent()` opens the system's picker, and its `pick(uris)` keeps content URIs alone. These three stay with the
Java, as Android's WebView asks for them in Java; the holders' C++ of `page-navigation`, `page-authentication` and
`page-downloads` take the page's navigations, authentications and downloads on Android as everywhere, as the activity
hands them over.

## iOS app extensions

An extension adds Apple's app extensions to an iOS app with `app.ios.targets`: a widget, a share extension, a
notification service or content extension, or one of iOS's other extension points. Each is a target of the app's Xcode
project of its own, whose sources Xcode compiles alone, in Swift, Objective-C, Objective-C++, C and C++, with none of
the host's: no page, no module and no `<crossbind/…>`, as iOS gives an extension little memory, 24 MB to a
notification service. The app builds each first and carries it in its PlugIns.

```js
ios: {
    targets: [{
        name: 'clock',
        kind: 'widget',
        sources: ['ios/widget/ClockWidget.swift'],
        resources: ['ios/widget/Assets.xcassets'],
        appGroup: true,
        privacy: { userDefaults: ['1C8F.1'] },
    }],
},
```

| Key | Value |
|---|---|
| `name` | Its name, of lowercase letters and digits that dashes may join, which no other target of the app's has: its bundle is the app's id and its name, as `com.example.notes.clock`, its product `clock.appex`, and its Swift module `clock`, with underscores for dashes. |
| `kind` | `widget`, `share`, `notification-service`, `notification-content`, or `other` with its `extensionPoint`, as below. |
| `sources` | Its own sources, of which it compiles one at least: Swift, Objective-C, Objective-C++, C and C++, with the headers, `.h` and `.hpp`, they import from beside them. One the extension's `ios` part lists as well compiles into both. |
| `resources` | The files and folders the target carries, as an asset catalog, which Xcode compiles. |
| `displayName` | The name iOS shows of it, as in the share sheet: the app's by default. |
| `plist`, `attributes` | Keys of its Info.plist, and of its `NSExtension`'s `NSExtensionAttributes`, but those crossbind writes: its bundle's keys, `CrossbindAppGroup`, its `NSExtension`, and the attributes its kind's options give, as a share target's activation rule. A content extension's `UNNotificationExtensionInitialContentSizeRatio` is 1 unless its attributes give another. |
| `entitlements`, `frameworks`, `privacy` | Its own, as an extension's `ios` part gives the app's: its entitlements, the frameworks it links, and its reasons for Apple's required reason API, in a privacy manifest of its own, as App Store Connect asks of each bundle. |
| `appGroup` | `true` puts the app's App Group in its entitlements and the app's, as below. |
| `deploymentTarget` | The iOS it needs, as `'17.0'`, from the app's 15.1, which it is by default: iOS shows it from that iOS on alone, and the app from 15.1 as ever. |

What each kind runs at and takes:

| Kind | Extension point | Takes |
|---|---|---|
| `widget` | `com.apple.widgetkit-extension` | A Swift source among its sources, whose `@main` is its `Widget` or `WidgetBundle`. |
| `share` | `com.apple.share-services` | `principalClass`, the class iOS makes, and `activation`, what of the share sheet's items it takes, as `{ images: 10, urls: 1, text: true }`: a count from 1 of `attachments`, `files`, `images`, `movies`, `urls` and `webPages`, and `text: true`. App Review refuses the predicate that takes everything. |
| `notification-service` | `com.apple.usernotifications.service` | `principalClass`, a `UNNotificationServiceExtension`, which iOS hands each remote notification of `mutable-content` to change before it shows. |
| `notification-content` | `com.apple.usernotifications.content-extension` | `principalClass`, its view controller, and `categories`, the ids of the notification categories it shows. It links UserNotifications and UserNotificationsUI of itself, as iOS starts it with their classes, which its code may name none of. |
| `other` | Its `extensionPoint`, as `com.apple.keyboard-service` | `principalClass`, of a point that makes one, and the `attributes` the point reads. |

The principal class of a target of Swift alone is its module's, as Xcode's templates name it,
`$(PRODUCT_MODULE_NAME).ShareViewController`; one beside Objective-C goes by the name its runtime knows, so a Swift
class there declares `@objc(ShareViewController)`.

An app whose targets ask for one shares an App Group with them: `group.` and the app's id, as `group.com.example.notes`,
unless `app.ios.appGroup` names another. crossbind writes it into the entitlements of the app and of each target that
asks for it, and into their Info.plists as `CrossbindAppGroup`; the app's native code finds its folder as
`crossbind::app::paths().group`, and the page as `app.paths()`' `group`. A widget reads what the app wrote there, in
files or in the `UserDefaults(suiteName:)` of that id, which each side's `privacy` gives the reason `1C8F.1` for, and
the app has it reload through WidgetKit's `WidgetCenter`; a widget's link opens the app as a link of `app.urlSchemes`
does. An App Group is registered with Apple before an App Store build is signed with it: Xcode registers one as it signs
a build it develops, and the developer portal's Identifiers list them.

Each target is signed as the app is: Xcode signs a development build with the app's team, and
`crossbind app publish app-store` signs each target in the archive with its own entitlements before the app, checks its
binary against its own privacy manifest, and uploads them together. Each takes an App ID of its own, of which a free
team makes ten a week.

An Android app's widget and share target take nothing of this: an extension's `manifest` declares the `<receiver>` of
its `AppWidgetProvider`, and an `<activity>` of its own with an `<intent-filter>` of `ACTION_SEND`, its `resources` the
widget's layout and its `appwidget-provider` XML, and its `java` the classes, as [Android](#android) says.

## The host's own extensions

Each is a package of the repository's `extensions/`, `@crossbind/extension-<name>`, among the dependencies of
`@crossbind/core-app-host`, as crossbind's stores and installers are: an app has them by having the host, and crossbind
finds them through it, as `pnpm` shows them to the host alone. The host's `package.json` is the one list of them, with its
`js/app.js` and `app.d.ts`, which put together what each gives the page. Each says the rest of itself in its own
`crossbind.extension.js`: `holds`, the roles it holds where they are more than its name; `reads`, the options of the app it
reads, by their paths in `app`; and `fromApp`, which takes them, and leaves out of an app one that has nothing to do there.

The page calls them through `crossbind/app`, whose functions serve any extension that holds their role. An app's bundler
plugin takes it from the host: `crossbind/app/core`'s functions, with what each package's `page.js` gives. A TypeScript page
reads its types with `/// <reference types="@crossbind/core-app-host/app" />`, as it reads `vite/client`'s.

`app.without` leaves out those it names, of every kind, with their commands, stores and installers:

```js
// crossbind.config.js
export default { app: { without: ['menu', 'power'] } };
```

A page that calls one of their functions then hears that the app has no such function. A name that is none of crossbind's
own stops the build, and so does one whose option the app's config sets to something, as `without: ['updater']` with
`app.updater`, as nothing would honor it. An extension may still take a role of one it leaves out.

Each of the host's own extensions holds roles, which an app's extension takes with `replaces`: `menu` holds `menu`,
`tray` and `notification`, `page-navigation` holds `page-navigation` and `page-authentication`, and each other one the
role of its own name. The extension that takes a role takes its calls and hooks, and answers them as the host's does:
by the same names, with the options the page's `crossbind/app` sends, and with the
results [app.md](./app.md#the-apps-functions) gives. The host's extension leaves it the functions of that role, whose
names start with the role's and a dot, and the hooks of the page's requests the role takes, and goes on with its other
roles; one left with none is not built in. An app's `acme-tray` takes `tray.set` and `tray.remove`, and the host's
`menu` goes on with the menus and the notifications:

```js
// crossbind.extension.js
export default function acmeTray() {
    return { name: 'acme-tray', contract: 1, replaces: 'tray', root: import.meta.dirname, app: { sources: ['tray.cpp'] } };
}
```

Windows shows a notification as a balloon of a tray icon, so where an app's extension takes `tray` alone, the host's
`notification.show()` shows an icon of the app's of its own beside that extension's until the notification goes; one
that takes both shows them from its own. Two extensions that take one role stop the build, and one that takes several
takes each, as `['page-navigation', 'page-downloads']`. An extension in a role's place gets its own options alone, as `crossbind.config.js` lists it or
its `fromApp` gives them, and the host's `fromApp` does not run, so that the app's options the host's took, as `app.navigation` is `page-navigation`'s and
`app.updater` the `updater`'s, are its own to read, and it reads the app's id with `appId()`.

An extension named as one of the host's own takes its place with the roles it held, saying so at each build, as a later
crossbind may add one of a name an app has already. One named as a role that another of the host's holds, as `tray`, stops
the build.

| Extension | Its functions, with the options each takes | What it sends the page |
|---|---|---|
| `dialog` | `dialog.open`, `dialog.save` and `dialog.message`, with the page's options | |
| `shell` | `shell.openExternal` with `{ url }`; `shell.openPath`, `shell.revealInFolder` and `shell.trash` with `{ path }` | |
| `updater` | `updater.check` and `updater.install`, with none | |
| `menu`, holding `menu`, `tray` and `notification` | `menu.set` with `{ menus }`, `menu.popup` with `{ items, x, y }`, which answers the id clicked or null, `menu.setDock` with `{ items }`, `tray.set` with the page's options, `tray.remove` with none, and `notification.show` with the page's options | The events of [Menus](./app.md#menus) and [Tray and notifications](./app.md#tray-and-notifications) |
| `power` | | The events `suspend` and `resume` of [Events and callbacks](./app.md#events-and-callbacks) |
| `links` | `onOpenUrl`, for the links of `app.urlSchemes` and a phone's `app.links` | The held event `open-url`, `{ url }`, as [Links](./app.md#links) tells |
| `files` | `onOpenFiles`, for the files of `app.fileTypes` and of a type no extension owns | The held event `open-files`, `{ paths }`, as [Files](./app.md#files) tells |
| `activities` | `activities.set` with `{ type, userInfo, webpageUrl }`, or `{}` for none, with `{ types }`, the types of `app.activityTypes`, as its options, and `onUserActivity`, for the user activities of those types | The held event `user-activity`, `{ type, userInfo, webpageUrl }`, as [User activities](./app.md#user-activities) tells |
| `shortcuts` | `onShortcutItem`, for the taps of the quick actions of `app.shortcutItems` | The held event `shortcut-item`, `{ type }`, as [Quick actions](./app.md#quick-actions) tells |
| `instance` | `onLaunch` and `onQuit`, with `launchedAgain()` | |
| `page-dialogs`, `page-permissions`, `page-files` | The hooks of [the page's requests](#the-pages-requests) | |
| `page-navigation`, holding `page-navigation` and `page-authentication` | The hooks of [Navigation](#navigation), with `app.navigation` as its options | |
| `page-downloads` | The hook of [Downloads](#downloads) | |
| `page-drops` | The hook of [Drops](#drops) | The event `drop`, `{ paths, x, y }` |
| `page-location` | `onWindow`, where it gives a macOS page its `navigator.geolocation`, and `askPagePermission()` | |

## The page side

`invoke(name, options)` from `crossbind/app` calls one of the app's functions by its name, with options of JSON values
and bytes, and resolves with its result or rejects with why it failed. An extension's package wraps its functions in
its own, which check their arguments as the page gives them, and types them:

```js
import { invoke } from 'crossbind/app';

export const writeText = async (text) => {
    if (typeof text !== 'string') throw new TypeError('crossbind: clipboard.writeText takes a string.');
    return invoke('clipboard.writeText', { text });
};
```

A third argument takes the call's messages and cancels it:

```js
const controller = new AbortController();
cancel.onclick = () => controller.abort();
const file = await invoke('reader.read', { path }, {
    onMessage: ({ part, of }) => { bar.value = part / of; },
    signal: controller.signal,
});
```

`routeUrl(extension, path)` names a URL an extension's route serves, as `routeUrl('media', '/clips/intro.mp4')`, with
the path as a URL holds it: escaped where it must be, with a query of its own after a `?`, and without a part `.` or
`..`, which the URL would resolve to another extension's or the page's own. It needs no `initNative()`.

## Publishers

An extension's `publisher` sends the app to a store: `crossbind app publish <name>` runs it, with the extension's
name. crossbind's own `google-play`, `app-store` and `github` are publishers of this kind, which use the same
[`api`](#the-api) alone, and an extension `extensions` lists under one of their names, with a publisher, replaces it;
one with an `app` alone leaves it as it is.

```js
// crossbind.extension.js
export default function demoStore() {
    return {
        name: 'demo-store',
        contract: 1,
        root: import.meta.dirname,
        publisher: {
            platform: 'android',
            store: 'Demo Store',
            options: {
                channel: { help: 'the channel the release goes to', value: '<channel>', default: 'beta' },
                draft: { help: 'leave the release a draft' },
            },
            async check(api) {
                const token = process.env.DEMO_STORE_TOKEN ?? api.secrets.get('token');
                if (!token) return { missing: ['Demo Store takes uploads with a token: set DEMO_STORE_TOKEN.'] };
                return { session: { token } };
            },
            async upload(api, { token }, { bundle }) {
                api.log(`uploading ${bundle} to Demo Store's ${api.options.channel} channel.`);
                // The store's own API takes it here.
                return { published: { url: 'https://store.example/apps/demo' } };
            },
        },
    };
}
```

| Key | Value |
|---|---|
| `platform` | The platform of the apps it takes: `android`, `ios`, `macos`, `linux`, `windows`, or `desktop` for the last three; or a list of them. |
| `isDefault` | True for the store a publish of its platforms goes to where it names none: the last that says so, an app's after crossbind's, whose `google-play` and `app-store` do for Android and iOS. |
| `store` | The name the store goes by in crossbind's messages; the extension's name without it. |
| `options` | The options it takes after its name, by camelCase names the command line writes in `--kebab-case`: `{ help }` for a flag, which is true or false, and `{ help, value, default }` for one that takes a value, which `value` names as `'<channel>'`. `platform`, `help` and `version` are the command's own, and those of the Vite build the publish runs, as `mode` and `debug`, are Vite's, so no publisher takes their names; two publishers of one publish take an option of one name alike. |
| `after` | The publisher it comes after: the publish runs that one first, from the same build. A publisher after another takes no `build`, `buildNumber` or `buildEnv`, and asks for no other build. |
| `build(api)` | The changes the publish's build makes to `crossbind.config.js`, the app's other builds keeping it as it is: a JSON merge patch of its export, in which objects merge, `null` removes a key and any other value takes the place of the one there. `{ app: { updater: null } }` builds the app without its updater, as a store that updates apps itself takes it, and signs no update whatever `CROSSBIND_UPDATER_PRIVATE_KEY` holds. |
| `check(api)` | All the store needs, before the build: `{ missing }` lists what is not there, and `{ session }` is what the steps after it get. On a terminal, `api.isGuided`, it may ask for what is missing and set it up. |
| `buildNumber(api, session)` | The build number, a whole number from 1 to 2100000000, as both stores take, which the build gets as `CROSSBIND_APP_BUILD_NUMBER`, or null for the app's own. |
| `buildEnv(api, session)` | Variables the build runs with beside crossbind's; one set to `undefined` is left out. |
| `upload(api, session, output, published)` | Sends what the build made to the store. It returns `{ isRebuildAsked: true }` for another build, after which it runs again, four builds in all at most, or `{ published }`: what it put out, which a publisher after it gets as `published`. |

All but `platform` and `upload` are optional. A step that fails with a message not crossbind's own stops the publish
with one that names the publisher and the step, as `demo-store's check failed: …`.

### A publish

`crossbind app publish demo-store --channel stable --mode staging`:

1. finds the publisher, after those it comes after, and says so of one an extension lists in the place of crossbind's
   own;
2. builds for the platform `-p` names, else the publisher's only one, else `CROSSBIND_APP_PLATFORM`'s, else this
   machine's desktop one;
3. takes each publisher's options from the command line, after the store's name: one of another store's is refused,
   naming whose it is, and any other goes on to Vite, as `--mode` does;
4. runs the first publisher's `build`, then every `check`: without a terminal, as in CI, every missing piece is named at
   once;
5. builds the app once, with the first publisher's changes, build number and environment;
6. hands the build's output to each `upload` in turn.

Without a name, `-p android` publishes to `google-play` and `-p ios` to `app-store`. `crossbind app publish --help`
lists the app's stores, crossbind's own and its extensions', with their options.

### What the build made

| Platform | `output` |
|---|---|
| `android` | `{ project, apk, bundle, symbols }`: the Gradle project, and beside it the APK, the bundle and the zip of the native debug symbols, each null where the build made none, as the bundle without an upload key. |
| `ios` | `{ project }`: the Xcode project, which a store archives. |
| `macos`, `linux`, `windows` | `{ apps }`, one `{ app, arch, installers }` for each arch: the app, and what each installer that made any made, as `[{ name: 'dmg', files: ['…/demo.dmg'] }]`, in the order they ran. Where `app.updater` and its key made an update, `updater`'s files are its file and its manifest, the file one that an installer before it made on Linux and Windows. |

## Installers

An extension's `installer` makes what installs a desktop app, beside it, in each build of the app. crossbind's own
`dmg` on macOS, `deb` and `tar-gz` on Linux, and `nsis` and `zip` on Windows are installers of this kind, which use the
same [`api`](#the-api) alone, and an extension `extensions` lists under one of their names, with an installer,
replaces it. So is `updater`, which makes a desktop app's update after them, and whose place an extension takes with
`replaces`.

```js
// crossbind.extension.js
import { spawnSync } from 'node:child_process';

export default function appimage() {
    return {
        name: 'appimage',
        contract: 1,
        root: import.meta.dirname,
        installer: {
            platform: 'linux',
            // appimagetool runs on this machine, where crossbind's linux image, which api.run runs in, has none.
            check() {
                const isThere = spawnSync('appimagetool', ['--version']).status === 0;
                if (!isThere) throw new Error('appimage takes appimagetool, which is on no folder of the PATH.');
            },
            make(api, { app, arch }) {
                // Here appimagetool packs a copy of the app's folder for the arch, with its AppRun and desktop entry.
                return [`${app}.AppImage`];
            },
        },
    };
}
```

| Key | Value |
|---|---|
| `platform` | The platform of the apps it makes what installs: `macos`, `linux`, `windows`, or `desktop` for the three; or a list of them. |
| `isLast` | True for one that runs after every other, whatever `app.installers` names, as `updater` does. |
| `licenses` | The code of others what it makes carries, as `app.licenses` lists it, which the app's license report lists where it runs. |
| `check(api, { installers })` | What it takes, checked before anything compiles: what it throws stops the build. `installers` names those that run. |
| `make(api, { app, arch, made })` | Makes what installs the app, once every app of the build has its page: `app` is the app's bundle on macOS and its folder on Linux and Windows, beside which it writes, and `arch` is `x64` or `arm64`. A Linux or Windows app's folder holds its executable, named as `general.name`, with `.exe` on Windows, and its resources in `resources/`, a Linux app's icon as `resources/icon.png`. `made` is what those before it made, as `[{ name, files }]`. It returns the paths of the files it made, a relative one beside the app, or none. |

`make` alone is required. A step that fails with a message not crossbind's own stops the build with one that names the
installer and the step, as a publisher's does.

A desktop build runs every installer of its platform: crossbind's, then those of the extensions `extensions` lists, in
its order, and says so of one listed in the place of crossbind's own. `app.installers` names those alone that run, as `installers: ['deb']` builds a Linux app without its tar.gz,
and a publisher's `build` may narrow them for its own build, as `{ app: { installers: ['pkg'] } }` would for a store
that takes a package. Those with `isLast` run after the others, whatever it names. A name that is no installer stops the
build. The build's output gives each one's files to the publishers, in the order they ran.

A Linux or Windows app with `app.updater` updates itself from an installer's first file: a Linux app from `tar-gz`'s,
which it unpacks with tar, and a Windows app from `nsis`'s, a setup program it runs with `/S /UPDATE /D=<its folder>`.
Its build takes that installer: one where `app.installers` leaves it out stops, naming it; an extension's installer in
its place makes a file of the same kind. A macOS app's update is a zip of its own. `updater` makes the update last, with
the key `CROSSBIND_UPDATER_PRIVATE_KEY` gives, beside the app: its file, and `<name>-<platform>-<arch>.update.json`, the
manifest that signs it. Without the key it makes none.

## Commands

An extension's `commands` add commands under `crossbind app`, which run in crossbind's process with the
[`api`](#the-api). crossbind's own `updater` gives `crossbind app updater-key` this way.

```js
// crossbind.extension.js
export default function demoTool() {
    return {
        name: 'demo-tool',
        contract: 1,
        root: import.meta.dirname,
        commands: {
            'demo-report': {
                help: 'print what the app is',
                options: {
                    out: { help: 'the file it writes to', value: '<file>' },
                    short: { help: 'a line alone' },
                },
                run(api) {
                    api.log(`${api.app.name} ${api.app.version}${api.options.short ? '' : ` in ${api.project.root}`}`);
                },
            },
        },
    };
}
```

| Key | Value |
|---|---|
| `help` | Its line in `crossbind app --help`. |
| `options` | The options it takes, as a publisher's are: by camelCase names the command line writes in `--kebab-case`, `{ help }` for a flag and `{ help, value, default }` for one that takes a value. |
| `run(api)` | Does its work, with the options in `api.options`. A failure with a message not crossbind's own stops the command with one that names the extension and the command. |

A command has no platform, so its `api.platform` is null and `api.run`, an installer's, refuses it. It is there only in
a project whose `target.runtimeEnv` is `app`. A name that `crossbind app` has already, of crossbind's or of another
extension's, stops `crossbind app` in the project, naming both; an extension that takes the place of one of
crossbind's own, by its name or with `replaces`, takes the place of that one's commands too.

## The api

A publisher's, an installer's or a command's code imports nothing of crossbind's: each step gets the `api`, made for its
extension and its run, and frozen.

| Member | What it is |
|---|---|
| `name`, `platform`, `isGuided`, `options` | The extension's name, the platform it publishes or makes what installs, whether a terminal answers questions, and a publisher's or a command's options. |
| `project` | `{ root, name, package }`: the project's folder, its name, `general.name`, which names the app's files, and its `package.json`. |
| `workDir` | A folder of the extension's own under the build's, `.crossbind/build/<name>`, for its files and logs, which the extension makes as it needs it. |
| `app` | The app as its platform's build makes it: `id`, `name`, `version`, which is package.json's, `appleVersion`, its numbers alone as Apple takes them, `versionCode`, Android's, `buildNumber`, `team`, the Apple team, `encryption`, `urlSchemes`, the schemes whose links open it, `fileTypes`, the types of files it opens, its extensions' among them, each `{ name, extensions, mimeTypes, role, contentTypes }`, `depends`, what a Linux app's package depends on beside WebKitGTK and GTK, as its extensions' `linux.depends` list it, and `category`, `app.category` as macOS and a Linux menu name it, `{ macos, linux }`, or null. |
| `config` | `crossbind.config.js`'s export as crossbind read it, with the changes a publisher's `build` made and the `app` options the api wrote since, which each read sees, read-only: none of this machine's settings or of what crossbind fills in. `await config.write('app.id', 'com.example.app')` writes `app.id`, `app.name`, `app.icon`, `app.encryption` or `app.privacy` into it once the user says yes on a terminal, and fails without one. A value the build would refuse fails with `isInvalid` set, for the publisher to ask again; one the config sets already is the user's to change. |
| `publisherChanges` | An installer's: the changes a publisher's `build` made to this build's config, as its JSON merge patch, or null. |
| `log(text)`, `warn(text)` | A line of crossbind's output. |
| `ask(question)`, `askYesNo(question)` | A question on the terminal, which fails without one. |
| `openUrl(url)` | Opens an http or https page in the user's browser, as a store's console. |
| `settings` | `get(key)` and `set(values)`: this machine's settings in `~/.crossbind.json`, by uppercase names, each with text: crossbind's own by their names, which `set` takes as `crossbind config set` does, and by any other name the extension's own, which the file keeps apart from crossbind's and every other extension's, under `extensions` by the extension's name, as `{ "extensions": { "demo-store": { "TOKEN": "…" } } }`. `set` writes all it is given or none. `crossbind config list` shows them as `demo-store.TOKEN`, which `crossbind config get` and `crossbind config delete` take. |
| `secrets` | `get(name)`, null without one or without a keychain, and `set(name, secret)`, true where the keychain took it: secrets the system keychain keeps under the extension's own service, which goes by its name, so one in the place of crossbind's own store has that store's. |
| `run(command, { cwd, isSigning })` | An installer's: runs a tool to its end where crossbind packages the platform's apps, on this Mac with Apple's tools, `/bin`, `/usr/sbin` and `/sbin` on the PATH for macOS, and for Linux and Windows in crossbind's linux or windows image, which sees the project's `paths.base` alone. `command` is the program and its arguments; `cwd`, relative to the project's folder, which it is without it, is under the base for an image. `isSigning` gives a Windows tool the key that signs the app, which `windows.signer` signs with. The tool's output goes to crossbind's, and a failure throws, saying the tool's exit status. |
| `windows` | `icon()`, the app's icon as a Windows `.ico`, or null without `app.icon`; and `signer`, the script that signs a file in the windows image with the key the environment names, which a tool that signs as it builds runs, as NSIS does, or null without a key. |
| `android` | `signing()`, the environment a release builds in with this machine's upload key, as `{ env, isSigned }`, and `makeUploadKey()`, as `crossbind app upload-key` makes it. |
| `apple` | `key()`, the App Store Connect API key the environment names, or null; `teams()`, the teams Xcode is signed in to; `xcodebuild(what, args, { log, facts, causes })`, which writes xcodebuild's output to the file `log` names and returns it, and whose failure names xcodebuild's reasons and the fix of the cause it finds, crossbind's first, then one of `causes`; `unreasonedApis(binary, privacy)`, the required reason API a binary calls with no reason in `privacy`; `privacyCategories`; and `dsyms()`, the dSYMs of the prebuilt frameworks crossbind puts in an app. |

Each function of the api may return a promise, so a step awaits each: one that answers at once now may wait in a later
crossbind. A publisher's or a command's code runs in crossbind's process, and an installer's in the Vite build's, with the
developer's credentials, as all build code does: listing an extension is the decision to trust it. `e2e/desktop-app`
checks the contract with the probe's store, a mirror after it and the probe's installer: its `pnpm e2e:publish`
publishes through the two stores, and every build makes the installer's note beside the app, which its `pnpm e2e:prod`
reads.

## The package

An extension's `package.json`:

- names it `@<scope>/extension-<name>`, or `crossbind-extension-<name>` without a scope;
- points `crossbind.extension` at `./crossbind.extension.js`, which `exports` gives as well;
- lists the native sources in `files`;
- names the crossbind versions it works with as a peer dependency of `crossbind`;
- has the keyword `crossbind-extension`, by which npm finds extensions;
- has the license of the code it carries, its own and any it wraps, as an SPDX expression.

crossbind's own have the keyword too, though an app has them already and `crossbind add` refuses them, with the one of the
group [the site](https://crossbind.dev/extensions/) lists them under: `publishing`, `installer`, `system`, `launch` or
`page`. Those whose page code imports `crossbind/app/core` name `crossbind` as a peer dependency; the others name none,
as the host brings the versions it works with.

Its `crossbind.extension.js` gives the extension's `contract`, as [Versions](#versions) says. The native code an
extension builds from is in the package, pinned with it; a build downloads none.

`npm create crossbind@beta -- <name> Extension` scaffolds one, `crossbind-extension-<name>`, from `examples/app-extension`.

## Testing

Native code has its checks in an app: the page calls the extension's functions and checks what they answer, on each
platform the extension takes. crossbind's own run in `e2e/desktop-app`, whose page checks the clipboard on macOS, Linux,
Windows, the iOS Simulator and the Android emulator, and the page's requests through extensions of its own that take the
roles `page-dialogs`, `page-permissions`, `page-downloads` and `page-navigation`, with functions of the roles' names: a
download saved and one cancelled, without a dialog, and navigations of the top frame and a frame refused, each of the
page that made it. Its probe extension takes every part an extension adds to an app, as its page checks: C beside C++,
with folders and macros of its own, an Apple app's Info.plist key, an iOS app's privacy reasons, an Android app's
permission, manifest elements and resources, `invoke()`, `onStart` before the window, `onWindow`'s window, the app's,
`appId()`, `onPage` with the page each call comes from, a hook of a role it does not hold, which the host refuses, the
window's `onClose`, `onActive`, `onQuitRequest`, macOS's `onReopen`, the files of its type and the https links of its
site, which reach it as the app's own reach the page, its route, a body and a file in its ranges, with the page that
asks, calls with messages, cancels and bytes, of its C++ and on Android of its Java, the files it carries, the Dock's
menu, the user activities and quick action taps it hands the app's delegates, as the system does, the host's
notification center, as a notification is shown and answered, the push token and a silent push, and its events
through `registry.events()`, for every page, for the page in front, for one page and held, as a desktop page opens a
second window and the probe sees each close.
`e2e/app-page-requests` keeps the host's own, whose dialogs its run answers as the app's user would, on Linux and
Windows. The JavaScript is unit-tested as any package's.

## What the host keeps

The host's core does what every extension stands on, and no extension takes its place:

- the app's windows and their webviews, the first at `app.window`'s size, and their pages, whose own origins load
  without asking and alone reach the app's functions, and which open windows through `windows.open()` alone;
- the channel between the page and the native code: `crossbind/app`'s calls by name, their messages, cancels and
  answers, and the events, with those held for the page; and the app's own URLs, under which each extension's route
  serves its own;
- the module, the app's own code in Hermes on a thread of its own, and `app.paths()`, `app.quit()`,
  `app.requestQuit()`, `app.relaunch()` and `app.launchArgs()`;
- a launch's entry points, its arguments, macOS's Apple Events and app delegate, the iOS scene and app delegate and the
  Android intent, from which it hands each link, file, user activity and quick action to the owner of its scheme, site,
  type or kind, and each push to every extension;
- the system's notification center on iOS and macOS, whose delegate it is from before the app finishes launching, and
  whose notifications it hands every extension;
- of the page's requests, a clipboard read without its user's gesture, which Windows denies before any extension hears
  of it, a page's `beforeunload`, which asks nothing, and iOS's and Windows' file inputs, for which their webview shows
  its own picker;
- the app, Edit, View and Window menus every Mac app has.

## Limits

- **Not in the contract yet**, to come with designs of their own: an iOS app's App Intents extensions, which
  ExtensionKit puts in the app's Extensions, a macOS app's own app extensions, the programs an extension would carry to
  run, and quick actions that change as the app runs. An Android extension takes its own pushes, as Firebase's, through
  its Java, manifest and Maven libraries.
- **iOS app extensions** have been measured in the iOS Simulator, of an iPhone and of an iPad, as the app carries them,
  of their kinds, ids and versions, as iOS registers each, and with the App Group the app writes into. A widget's
  drawing, a share sheet's extension, a notification service's change of a real push, a notification content
  extension's view, a keyboard, a build for a device, signed for development, and an upload of an app with targets,
  which signs each, have not been run.
- **Routes** answer whole, with a body or a file, as WebView2 reads a response only once all of it is there, and take
  GET and HEAD alone, as Android's WebView gives no request's body: a stream goes as a call's messages, and what the
  page sends as a call's options.
- **Android:** Java and Kotlin, which build offline against the Maven cache of crossbind's android-app image, but for
  an app whose extensions name `maven` libraries, which builds online, checked.
- **Apple:** C, C++, Objective-C, Objective-C++ and Swift, for the app's deployment targets, macOS 11 and iOS 15.1:
  Swift that calls a later system's API guards it with `#available`.
- **Windows:** Win32, and WinRT through mingw-w64's ABI headers in C++, as `windows.ui.notifications.h` and
  `windows.security.credentials.ui.h`, linking `runtimeobject`: crossbind defines `IReference<boolean>` away, which
  those headers define twice in C++. The toolchain has no C++/WinRT projection, nor the Store's headers.
- **Linux:** GTK 3 and WebKitGTK 4.1, the libraries of crossbind's sysroot, 28 pinned Ubuntu 22.04 packages per
  architecture, and those of an extension's `packages`, which its `depends` asks its users' systems for. The tar.gz depends on nothing, so a library
  beyond WebKitGTK's and GTK's has to be on its users' machines.
