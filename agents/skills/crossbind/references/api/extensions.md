<!-- GENERATED from docs/api/extensions.md by scripts/build-agent-skill.mjs. Do not edit. -->

# App extensions

An app extension adds functions to an app (`target.runtimeEnv: 'app'`): native code the app's host builds in, which
the page calls by name. A package of its own carries it, as
[`@crossbind/extension-clipboard`](../../extensions/clipboard/README.md) carries the system clipboard's text on macOS,
iOS, Android, Windows and Linux. The host's own, `dialog`, `instance`, `links`, `menu`, `page-dialogs`, `page-files`,
`page-location`, `page-permissions`, `power`, `shell` and `updater`, are built the same way. An extension may add a store the app is
published to as well, as [Publishers](#publishers) says, and what installs a desktop app, as
[Installers](#installers) says: crossbind's own stores, `google-play`, `app-store` and `github`, and installers, `dmg`,
`deb`, `tar-gz`, `nsis` and `zip`, are of the same kind.

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

An extension names the contract it is written for, `contract: 1` for this one. A build stops on one written for
another, naming what to update: crossbind, the extension's package, or `@crossbind/core-app-host` where the host's own
extensions are of another crossbind. crossbind raises the number with each change that breaks an extension. Until
crossbind 2.0.0 such a change may come in any release, which marks it as breaking and says in its notes what an
extension's author changes; from 2.0.0 the contract only grows within a major version, and a change that breaks an
extension waits for the next one. An extension's package names the crossbind versions it works with as a peer
dependency as well.

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
| `name` | Lowercase letters and digits, which dashes may join. Each of the extension's function names starts with it and a dot, as `clipboard.readText`, or the app stops as it starts, saying so; and it names its C++ entry, `crossbind_extension_<name>`, with underscores for dashes. An app has one extension of a name, so a distinctive one, as its package's, keeps an extension from another's. Two extensions of one name stop the build, but for one of the host's own: an extension `extensions` lists under the name `dialog`, `instance`, `links`, `menu`, `page-dialogs`, `page-files`, `page-permissions`, `power`, `shell` or `updater` replaces the host's, and the page's calls of its functions, and the app's C++ through `<crossbind/app.h>`, reach the one listed. The host's own `menu` adds `tray` and `notification`'s functions as well, which share its icon on Windows. |
| `contract` | The version of the contract it is written for, `1`, as [Versions](#versions) says. |
| `root` | The absolute path of the extension's folder, `import.meta.dirname` in `crossbind.extension.js`. It is under the project's `paths.base`, as all a build sees is. |
| `app.sources` | The C and C++ sources every platform compiles, relative to `root`. |
| `app.includes` | The extension's folders its sources' includes are found in, beside the host's `<crossbind/extension.h>` and `<crossbind/app.h>` and the platform's headers, which are all they see of the host. |
| `app.defines` | The macros its sources compile with, `NAME` or `NAME=value`, a value of letters, digits and `_.+-`. A debug build defines `CROSSBIND_APP_DEV` as well. |
| `app.urlSchemes` | The schemes whose links the extension's native code gets through `onUrl`, as [`app.urlSchemes`](./app.md#links)' rules take them, on every platform: an extension that declares them has native code on each platform the app builds for. The build tells each system of them beside the app's own, and two owners of one scheme stop the build, naming both. |
| `app.licenses` | The code of others the extension carries, which the app's license report lists beside the extension's package: `[{ name, version, license, file, source, sha256 }]`, its `license` an SPDX expression, which `crossbind licenses --check` checks, and `file` its license's text in the extension's folder; `source`, where the code comes from, and `sha256`, that source's, where it has them. |
| `app.<platform>` | What one platform adds, by the names crossbind's app commands give them: `macos`, `ios`, `linux`, `windows` or `android`. |
| `options` | What the extension's native code reads as `registry.options()`, as `crossbind.extension.js` takes it from the app: a JSON value alone, of plain objects, arrays, strings, finite numbers, booleans and null. |
| `publisher` | The store it sends the app to, as [Publishers](#publishers) says. |
| `installer` | What it makes to install a desktop app, as [Installers](#installers) says. |

What a platform adds:

| Key | Platforms | Value |
|---|---|---|
| `sources` | all | Its own sources: C `.c` and C++ `.cpp`, `.cc` or `.cxx`, and on `macos` and `ios` Objective-C `.m` and Objective-C++ `.mm` too, which compile with ARC. |
| `includes`, `defines` | all | Its folders of includes and its macros on that platform, beside `app.includes`' and `app.defines`'. |
| `frameworks` | `macos`, `ios` | The Apple frameworks the app links, as `UniformTypeIdentifiers`. |
| `libraries` | `linux`, `windows`, `android` | The libraries the app links: Windows' own, as `comctl32`, and on Linux those of crossbind's sysroot. |
| `entitlements` | `macos`, `ios` | The entitlements the app takes: on macOS merged with `app.permissions`', on iOS written into the app's entitlements file. Two owners that give one key lists join them, and other values that differ stop the build. |
| `plist` | `macos`, `ios` | Info.plist keys, each with text, a number, a boolean, or a list or an object of them, as `{ NSContactsUsageDescription: reason }` with a reason the extension's options take from the app. A key crossbind writes from the app's config, as `CFBundleIdentifier` or a reason of `app.permissions`, the extension gives with the same value alone; two extensions that give one key lists join them, and other values that differ stop the build. |
| `privacy` | `ios` | Apple's reasons for the required reason API its code calls, as `app.privacy` gives them, as `{ userDefaults: ['CA92.1'] }`: the app's privacy manifest gives them beside `app.privacy`'s. |
| `permissions` | `android` | The Android permissions the app asks for, by their full names, as `android.permission.READ_CONTACTS`, beside `app.permissions`', each once. Its Java asks its user for one that asks with the activity's `afterAsking()`. |
| `manifest` | `android` | A manifest of its own, as an `AndroidManifest.xml` is, whose elements the app's takes: those of the manifest, as `<queries>` and `<uses-feature>`, beside the app's, and those of its `<application>`, which has no attributes, as the app's are its own, inside the app's application. Its `<manifest>` has no attributes but the `android` and `tools` prefixes, and it asks for no permission with `<uses-permission>`, which `permissions` lists. It takes `${applicationId}` as Gradle gives it, as for a `<provider>`'s authorities. |
| `resources` | `android` | A folder of Android resources, as `res/` holds them, which join the app's: one at a path the app has stops the build, naming the extension. Its Java reads them through the app's `dev.crossbind.app.R`. |
| `java`, `class` | `android` | The folder of the extension's Java, relative to `root`, whose `.java` files alone join the app's sources, so that it may hold the manifest and resources as well, and the class in it the app calls, which implements `dev.crossbind.app.Extension` and has a public constructor without arguments: the app makes one of it, as it starts. Both or neither. |

## The native side

One of the sources defines the entry, which adds what the extension does and starts nothing: it runs on the main thread
as the app starts, before the app's module, in every launch, one that another instance then takes as well. What the
extension starts as the app runs, it starts in `onWindow`. The registry lives as long as the entry runs, so a function
keeps a copy of what it needs of it, as of `registry.options()`. An entry that throws stops the app, saying why and
naming the extension:

```cpp
#include "crossbind/extension.h"

#include <stdexcept>

void crossbind_extension_clipboard(crossbind::Registry &registry) {
    registry.function("clipboard.writeText", [](crossbind::Call call) {
        const crossbind::Value &text = call.options()["text"];
        if (!text.isString()) throw std::invalid_argument("crossbind: clipboard.writeText takes a string");
        crossbind::onMainThread([call, text = text.asString()] {
            // The platform's clipboard takes the text here.
            call.resolve();
        });
    });
}
```

`<crossbind/extension.h>` gives the native code all it uses of the host:

| Name | What it is |
|---|---|
| `Value` | A JSON value, which never changes, so any thread may hold a copy: `isString()`, `asString()`, `asString(fallback)` and the rest; `value["key"]`, null for a member it lacks; `json()`. |
| `Call` | A call of the page's: its `name()` and `options()`. Its function answers it once, from any thread, with `resolve(value)` or `reject(message)`; a call that every copy lets go of unanswered fails, saying it gave no answer. `isFromPage()` is false for the calls of the app's native code, through `<crossbind/app.h>` or `invoke()`, which reaches more than the page may. |
| `Registry::function(name, fn)` | Adds a function the page calls by that name, which starts with the extension's own and a dot; an extension named `menu`, as the host's own is, names `tray.` and `notification.` ones as well. The page's calls run it on the module's thread, which it must not hold up: it answers there, or hands the call on. A call of the app's native code runs it on the caller's thread, so it may run on several at once. What it throws fails the call. |
| `Registry::options()` | The extension's `options`, a `Value`: null without any. |
| `Registry::onLaunch(fn)` | Takes a desktop app's launches, as one extension alone does: `fn` gets the `Launch` of this process, its `args`, `cwd` and the `token` that lets a Linux window take the front, on the main thread before the module starts, and hands the app later ones with `launchedAgain()`. `false` ends the launch with exit status 0; what `fn` throws ends it with status 1 and says why, in a message box as well when the app's user opened it. iOS and Android keep an app to one instance themselves and never call it. |
| `Registry::onWindow(fn)` | Runs `fn` on the main thread as the app's window opens, with `appWindow()` and `appWebView()` set, before its page loads: where the extension starts what it does as the app runs, as the host's `power` starts hearing of the system's sleep. A desktop app opens one window, an iOS app one for each scene that connects; an Android app has none an extension reaches and never calls it. |
| `Registry::onPage(fn)` | Runs `fn` on the module's thread as each page of the app's starts, the first one and each that replaces the page before it, as a reload does: once the calls of the page before have reached their functions, before the new page's do. It is where the extension lets go of what it kept for the page before, whose calls get no answer from then on, and it may run more than once for one page. |
| `Registry::onClose(fn)` | Asks `fn` on the main thread as the app's window closes on the desktop, as its user closes it, or on Windows and Linux another program, as `taskkill` without `/F` does: `false` keeps the window open, as an app that stays in its tray, which hides the window itself, and asks no other extension. `app.quit()`, the menu's `quit` item and the system's own quit, as from the macOS Dock, close it without asking, and a phone's app has no window its user closes. |
| `Registry::onQuit(fn)` | Runs `fn` once as the app quits or fails, on the thread that ends it, before its module stops: never in a launch that `onLaunch` ends, nor in one whose extensions fail to start. A phone's system may end an app without either. |
| `Registry::onUrl(fn)` | Gets each link of the extension's `app.urlSchemes`, wherever the system hands it over: in a launch's arguments, as macOS's Apple Event, to the iOS scene or in the Android intent. It runs on any thread, which it must not hold up, as the later launches wait for it. The page hears of none of these links. A link is whatever the system hands the app, so `fn` takes it as it would any address from outside. An extension that declares schemes calls it, and one that calls it declares them. |
| `Registry::onPageDialog(fn)`, `onPagePermission(fn)`, `onFileInput(fn)` | Take the page's dialogs, what it asks to use and its file inputs, as the extension named `page-dialogs`, `page-permissions` or `page-files` alone does: see [The page's requests](#the-pages-requests). Not on Android, where its Java takes them. |
| `launchedAgain(launch)` | On the desktop, hands the app a later launch that the extension's `onLaunch` took from another process, from any thread: the window comes to the front, the page hears of the launch as the event `second-instance`, and its links reach the owners of their schemes. |
| `inBackground(call, work)` | Runs `work` on a thread of its own, which answers the call with what `work` returns, or with what it throws. |
| `invoke(name, options, done)` | Calls one of the app's functions by its name, as the page does, from any thread once the app's extensions have all started: the function runs on the caller's thread, and its call is no page's. `done` gets why the call failed, or its result, once, on the thread that answers: the caller's, before `invoke` returns, for a call that fails at once or that its function answers there. |
| `onMainThread(fn)` | Runs `fn` on the app's main thread, where the platform's UI is called, after what waits there already, also when the caller is on it. A modal loop `fn` runs, as a dialog's, holds the next until `fn` returns, but on Linux, where that loop runs them. What `fn` throws goes to the app's output, and a call `fn` held fails as it lets go of it. One given as the app quits, as in `onQuit`, may never run. Not on Android. |
| `appWindow()` | The app's window on the main thread: an `NSWindow` on macOS, a `UIWindow` on iOS, a `GtkWindow` on Linux and an `HWND` on Windows; null before it has one. Not on Android. |
| `appWebView()` | The app's webview on the main thread: a `WKWebView` on macOS and iOS, an `ICoreWebView2Controller` on Windows, and on Linux a `WebKitWebView` in a vertical `GtkBox`, which puts the widgets an extension adds to it with `gtk_container_add` above the page at their own height: the window holds the page to `app.window`'s limits, with their height added. Null before the app has one. Not on Android. |
| `askPagePermission(kinds, origin, done)` | Asks `page-permissions`, as the webview does, whether the page of `origin` may use these kinds, of the table in [the page's requests](#the-pages-requests): for an extension that gives the page what its webview lacks, as the host's `page-location` gives a macOS page its location. From any thread; `done` gets the answer once, on the main thread, false without `page-permissions`. Not on Android. |
| `appName()` | The app's name, as its window and dialogs show it. |
| `allowPath(path)` | Lets the page reach a file or folder through `crossbind/app`'s shell functions from now on, as what its user picked: a picker's answer, for one. |
| `allowedPaths()` | What `allowPath()` was given so far, as it was given. |
| `android::callJava(extension, function, options, done)` | On Android, calls a function of the extension's Java on the UI thread with the app's activity; `done` gets why it failed, or its result, once. What `done` throws goes to the system's log, and a call `done` held fails as it lets go of it. |
| `<crossbind/app.h>` | The app's own functions, as its native code calls them, and the events it sends the page: `emitEvent()`, and `holdEvent()` for those the page takes once it asks. One that waits for its answer, as `messageDialog()`, refuses the main thread, which gives the answer. |

What an extension throws:

| Where | What it does |
|---|---|
| The entry | Stops the app, saying why and naming the extension, as an app that cannot start does (see [app.md](./app.md#the-window)). |
| A function | Fails its call. |
| `onLaunch` | Ends the launch with exit status 1, saying why. |
| `onWindow`, `onPage`, `onQuit`, `onUrl`, a task of `onMainThread` | Goes to the app's output, and the app goes on. |
| `onClose` | Goes to the app's output, and the window closes, unless another extension keeps it. |
| The owner of a request of the page's | Cancels the request. |

The host's own extensions start first, in the order of their names, then those `extensions` lists, in its order, and
each kind of hook runs in that order. An extension names the events it sends the page after itself, as
`clipboard.changed`, and on Windows takes the messages it posts the app's window from `RegisterWindowMessageW`, as the
host's `menu` does, so that they are no other extension's.

A function checks every option the page gives, and a call it refuses rejects with why and what mends it, starting with
`crossbind:`: it never does nothing. Only the app's own page reaches the functions, as the host admits no other origin,
and a function that reaches beyond what the page could do itself, as one that opens files, takes the app's opt-in: the
options of the extension's function in `crossbind.config.js`, which build its native code in only then.

## Launches and links

The host's `instance` keeps a desktop app to one instance through `onLaunch`, `onQuit` and `launchedAgain()`, where
`app.singleInstance` asks for it (see [app.md](./app.md#one-instance)). An app sets `app.singleInstance` to `false` for
an extension of its own to take the launches instead, with the same hooks, or lists one named `instance`, which
replaces the host's.

An extension gets the links of a scheme of its own, as a sign-in's redirect, without the page:

```cpp
void crossbind_extension_signin(crossbind::Registry &registry) {
    // crossbind.extension.js gives app.urlSchemes: ['com.example.app.signin'].
    registry.onUrl([](const std::string &url) {
        // The sign-in's code is in url; the call that started the sign-in resolves here.
    });
}
```

The host hands each link to the owner of its scheme, wherever it comes from: the host's `links` owns those of
`app.urlSchemes`, which it holds for the page as the event `open-url`. A link reaches `onUrl` once the app's module has
started, and a later launch's arguments, which `second-instance` carries, leave every link out.

An extension that hands the page what came before it listened, as `links` does, sends it with `<crossbind/app.h>`'s
`holdEvent()`, which the page takes with `events.held(name)` from `crossbind/app` (see
[app.md](./app.md#events-and-callbacks)). One listed as `links`, in its place, gets the links of `app.urlSchemes`
through `onUrl`, which it calls, and hands each it lets through to the page with `holdEvent("open-url", {"url": …})`,
which `app.launchUrls()` and the event `open-url` give.

## The page's requests

The page's `alert()`, `confirm()` and `prompt()`, what it asks to use, as the camera through `getUserMedia()`, and the
files its user picks through a file input reach the extension named for each, `page-dialogs`, `page-permissions` or
`page-files`: the host's own, or the one `extensions` lists under that name in its place. Its entry calls the hook once:

```cpp
// An app's own page-dialogs: every dialog answers OK, and a prompt() with its text unchanged.
void crossbind_extension_page_dialogs(crossbind::Registry &registry) {
    registry.onPageDialog([](const crossbind::PageDialog &dialog) { dialog.accept(dialog.defaultText()); });
}
```

| `fn` gets | What it is |
|---|---|
| `PageDialog` | `kind()`, `alert`, `confirm` or `prompt`; its `message()` and a prompt's `defaultText()`. `accept(text)` is OK, with a prompt's text, and `cancel()` Cancel. |
| `PagePermission` | `kinds()`, what it asks for together, as `camera` and `microphone`; the `origin()` of the frame that asks, as `crossbind://app`, on Linux the page's, as WebKitGTK names no frame; and `isListed()`, whether `app.permissions` lists each of them, false for a kind that is no device. `allow()` or `deny()` answers it. |
| `FileInput` | `allowsMultiple()`, `allowsFolders()` and the types its `accept()` names, where the webview tells them: macOS's tells no types, and WebKitGTK no folders. `pick(paths)` answers with the files picked, and `cancel()` with none. |

`fn` runs on the main thread, where it may show a modal dialog of the platform's, while which it may be asked again,
and the request is answered once, from any thread, as the page waits. One that every copy lets go of unanswered, or
whose `fn` throws, is cancelled: an alert closes, a confirm gives false and a prompt null, a permission is denied and a
file input gets no files. The kinds, each by the name crossbind gives it:

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
`page-files` shows macOS's open panel and Android's picker. Where the extension of that name has no native code, as one
an app lists for macOS alone, the webview does as it would without crossbind: WKWebView answers a dialog at once, as an
alert's OK and a confirm's and a prompt's Cancel, and asks its own question for a permission, but for a macOS page's
location, which `page-location` then denies; WebKitGTK and WebView2 show their own dialogs, WebKitGTK denies a permission
and WebView2 asks; and an Android app's WebView shows its own dialogs and denies a permission. A page's `beforeunload`
asks nothing where `page-dialogs` takes the dialogs, as it never does on Apple's and Android's: the page leaves at once.

WKWebView gives a macOS page no location of its own. A macOS app whose `app.permissions` lists the location has the
host's `page-location`, which answers the top frame's `navigator.geolocation` from CoreLocation, with that reason,
once `page-permissions` allows the page the location: it asks through `askPagePermission()`, as an extension does that
gives the page what its webview lacks. An extension the app lists under that name takes its place.

## Android

The extension's Java answers what its native code asks through `android::callJava()`:

```java
package dev.example.clipboard;

import dev.crossbind.app.CrossbindActivity;
import dev.crossbind.app.Extension;

import org.json.JSONObject;

public final class ClipboardExtension implements Extension {
    @Override
    public void call(CrossbindActivity activity, String function, JSONObject options, Call call) {
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

The activity calls `call()` on the UI thread, and `call` answers once, from any thread, with `resolve()`, which takes
one of org.json's values, or `reject()`. What `call()` throws fails the call; one that it never answers never settles,
as Java tells the host of no copy let go. The extension's options reach its Java as its native code passes them in
`callJava()`'s. An extension hears of the activity's life through `onCreate`, `onNewIntent`, `onResume`, `onPause` and
`onDestroy`, each a default of `Extension`'s, in the order of the app's extensions, as the native hooks run, and what
one of them throws goes to the system's log as the others hear of it too. It reaches the page's WebView through the
activity's `webView()`, asks for permissions through its `afterAsking(permissions, then)` and starts an activity for
its result through `startForResult(intent, (result, data) -> …)`, so the requests of the activity and of other
extensions never meet its own.

The Java of the extension named `page-dialogs`, `page-permissions` or `page-files` gets the page's requests through
`onPageDialog(activity, dialog)`, `onPagePermission(activity, request)` and `onFileInput(activity, input)`, defaults of
`Extension`'s, on the UI thread: each returns true and answers once, from any thread, or false to leave the request to
the WebView, which shows its own dialog, denies the permission or shows no picker. One it throws on is cancelled, and a
frame of another origin, which Android lets the page hold, gets no dialog and nothing it asks to use. `FileInput`'s
`params()` is the WebView's account of the input, whose `createIntent()` opens the system's picker, and its `pick(uris)`
keeps content URIs alone.

## The host's own extensions

An extension listed under the name of one of the host's own takes its calls, and answers them as the host's does: by
the same names, with the options the page's `crossbind/app` and the app's `<crossbind/app.h>` send, and with the
results [app.md](./app.md#the-apps-functions) gives.

| Extension | Its functions, with the options each takes | What it sends the page |
|---|---|---|
| `dialog` | `dialog.open`, `dialog.save` and `dialog.message`, with the page's options | |
| `shell` | `shell.openExternal` with `{ url }`; `shell.openPath`, `shell.revealInFolder` and `shell.trash` with `{ path }` | |
| `updater` | `updater.check` and `updater.install`, with none | |
| `menu` | `menu.set` with `{ menus }`, `tray.set` with the page's options, `tray.remove` with none, and `notification.show` with the page's options | The events of [Menus](./app.md#menus) and [Tray and notifications](./app.md#tray-and-notifications) |
| `power` | | The events `suspend` and `resume` of [Events and callbacks](./app.md#events-and-callbacks) |
| `links` | `onUrl`, for `app.urlSchemes`' links | The held event `open-url`, `{ url }`, as [Links](./app.md#links) tells |
| `instance` | `onLaunch` and `onQuit`, with `launchedAgain()` | |
| `page-dialogs`, `page-permissions`, `page-files` | The hooks of [the page's requests](#the-pages-requests) | |
| `page-location` | `onWindow`, where it gives a macOS page its `navigator.geolocation`, and `askPagePermission()` | |

## The page side

`invoke(name, options)` from `crossbind/app` calls one of the app's functions by its name, with options of JSON values,
and resolves with its result or rejects with why it failed. An extension's package wraps its functions in its own,
which check their arguments as the page gives them, and types them:

```js
import { invoke } from 'crossbind/app';

export const writeText = async (text) => {
    if (typeof text !== 'string') throw new TypeError('crossbind: clipboard.writeText takes a string.');
    return invoke('clipboard.writeText', { text });
};
```

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
| `macos`, `linux`, `windows` | `{ apps }`, one `{ app, arch, installers, update }` for each arch: the app, its installers as `[{ name, files }]`, as `[{ name: 'dmg', files: ['…/demo.dmg'] }]`, and the update's `{ manifest, file }` where `app.updater` and its key made one, else null. |

## Installers

An extension's `installer` makes what installs a desktop app, beside it, in each build of the app. crossbind's own
`dmg` on macOS, `deb` and `tar-gz` on Linux, and `nsis` and `zip` on Windows are installers of this kind, which use the
same [`api`](#the-api) alone, and an extension `extensions` lists under one of their names, with an installer,
replaces it.

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
| `check(api)` | What it takes, checked before anything compiles: what it throws stops the build. |
| `make(api, { app, arch })` | Makes what installs the app, once every app of the build has its page: `app` is the app's bundle on macOS and its folder on Linux and Windows, beside which it writes, and `arch` is `x64` or `arm64`. A Linux or Windows app's folder holds its executable, named as `general.name`, with `.exe` on Windows, and its resources in `resources/`, a Linux app's icon as `resources/icon.png`. It returns the paths of the files it made, a relative one beside the app. |

`make` alone is required. A step that fails with a message not crossbind's own stops the build with one that names the
installer and the step, as a publisher's does.

A desktop build runs every installer of its platform: crossbind's, then those of the extensions `extensions` lists, in
its order, and says so of one listed in the place of crossbind's own. `app.installers` names those alone that run, as `installers: ['deb']` builds a Linux app without its tar.gz,
and a publisher's `build` may narrow them for its own build, as `{ app: { installers: ['pkg'] } }` would for a store
that takes a package. A name that is no installer stops the build. The build's output gives each one's files to the
publishers, in the order they ran.

A Linux or Windows app with `app.updater` updates itself from an installer's first file: a Linux app from `tar-gz`'s,
which it unpacks with tar, and a Windows app from `nsis`'s, a setup program it runs with `/S /UPDATE /D=<its folder>`.
Its build takes that installer: one where `app.installers` leaves it out stops, naming it; an extension's installer in
its place makes a file of the same kind. A macOS app's update is a zip of its own.

## The api

A publisher's or an installer's code imports nothing of crossbind's: each step gets the `api`, made for its extension
and its run, and frozen.

| Member | What it is |
|---|---|
| `name`, `platform`, `isGuided`, `options` | The extension's name, the platform it publishes or makes what installs, whether a terminal answers questions, and a publisher's options. |
| `project` | `{ root, name, package }`: the project's folder, its name, `general.name`, which names the app's files, and its `package.json`. |
| `workDir` | A folder of the extension's own under the build's, `.crossbind/build/<name>`, for its files and logs, which the extension makes as it needs it. |
| `app` | The app as its platform's build makes it: `id`, `name`, `version`, which is package.json's, `appleVersion`, its numbers alone as Apple takes them, `versionCode`, Android's, `buildNumber`, `team`, the Apple team, `encryption`, `updater`, `urlSchemes`, the schemes whose links open it, and `category`, `app.category` as macOS and a Linux menu name it, `{ macos, linux }`, or null. |
| `config` | `crossbind.config.js`'s export as crossbind read it, with the changes a publisher's `build` made and the `app` options the api wrote since, which each read sees, read-only: none of this machine's settings or of what crossbind fills in. `await config.write('app.id', 'com.example.app')` writes `app.id`, `app.name`, `app.icon`, `app.encryption`, `app.privacy` or `app.updater` into it once the user says yes on a terminal, and fails without one. A value the build would refuse fails with `isInvalid` set, for the publisher to ask again; one the config sets already is the user's to change. |
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
crossbind. A publisher's code runs in crossbind's process, and an installer's in the Vite build's, with the
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

Its `crossbind.extension.js` gives the extension's `contract`, as [Versions](#versions) says. The native code an
extension builds from is in the package, pinned with it; a build downloads none.

`npm create crossbind@beta -- <name> Extension` scaffolds one, `crossbind-extension-<name>`, from `examples/app-extension`.

## Testing

Native code has its checks in an app: the page calls the extension's functions and checks what they answer, on each
platform the extension takes. crossbind's own run in `e2e/desktop-app`, whose page checks the clipboard on macOS, Linux,
Windows, the iOS Simulator and the Android emulator, and the page's requests through owners of its own in place of
`page-dialogs` and `page-permissions`. Its probe extension takes every part an extension adds to an app, as its page
checks: C beside C++, with folders and macros of its own, an Apple app's Info.plist key, an iOS app's privacy reasons,
an Android app's permission, manifest elements and resources, `invoke()`, `onPage` and the window's `onClose`.
`e2e/app-page-requests` keeps the host's own, whose dialogs its run answers as the app's user would, on Linux and
Windows. The JavaScript is unit-tested as any package's.

## What the host keeps

The host's core does what every extension stands on, and no extension takes its place:

- the app's window and webview, at `app.window`'s size, and the page, which loads from the app's own origins alone:
  those alone reach the app's functions, a link to another origin opens in the default browser, and no page opens a
  window of its own;
- the channel between the page and the native code: `crossbind/app`'s calls by name, their answers, and the events,
  with those held for the page;
- the module, the app's own code in Hermes on a thread of its own, and `app.paths()`, `app.quit()` and
  `app.relaunch()`;
- a launch's entry points, its arguments, macOS's Apple Events, the iOS scene and the Android intent, from which it
  hands each link to the owner of its scheme;
- of the page's requests, a clipboard read without its user's gesture, which Windows denies before any extension hears
  of it, a page's `beforeunload`, which asks nothing, and iOS's and Windows' file inputs, for which their webview shows
  its own picker;
- the page's downloads, which ask where to save, and the app, Edit, View and Window menus every Mac app has.

## Limits

- **Not in the contract yet**, each to come with a design of its own: the app's going to the background and back;
  universal links, App Links and the files a system opens an app with; iOS's callbacks of push notifications; binary
  data and streams between the page and native code, which JSON carries today; and extensions of the page's downloads
  and of its links to other origins.
- **Android:** Java alone, and nothing from Maven, as the app builds offline against the Maven cache of crossbind's
  android-app image, which pins every artifact: Kotlin and Maven artifacts need that image to change first.
- **Apple:** Objective-C, Objective-C++, C and C++, with no Swift.
- **Windows:** Win32 alone, as the toolchain has no WinRT projection.
- **Linux:** the libraries of crossbind's sysroot alone, 28 pinned Ubuntu 22.04 packages per architecture. The app's
  Debian package depends on WebKitGTK and GTK alone, so a library beyond theirs has to be on its users' machines.
