# App extensions

An app extension adds functions to an app (`target.runtimeEnv: 'app'`): native code the app's host builds in, which
the page calls by name. A package of its own carries it, as
[`@crossbind/extension-clipboard`](../../extensions/clipboard/README.md) carries the system clipboard's text on macOS,
iOS, Android, Windows and Linux. The host's own, `dialog`, `instance`, `links`, `menu`, `power`, `shell` and
`updater`, are built the same way.

The contract is experimental: until crossbind declares the host API stable, an extension moves with crossbind's
version, as the beta's packages all do.

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
each one before anything compiles (see [crossbind-config.md](./crossbind-config.md)), and sees the project's
`paths.base` alone: a package linked in from beside the project, as a workspace's, takes `paths.base` set above both.
[`new-extension.md`](../playbooks/new-extension.md) is the order of the work of writing one.

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
| `name` | Lowercase letters and digits, which dashes may join. It prefixes the extension's function names, as `clipboard.readText`, and names its C++ entry, `crossbind_extension_<name>`, with underscores for dashes. Two extensions of one name stop the build, but for one of the host's own: an extension `extensions` lists under the name `dialog`, `instance`, `links`, `menu`, `power`, `shell` or `updater` replaces the host's, and the page's calls of its functions, and the app's C++ through `<crossbind/app.h>`, reach the one listed. The host's own `menu` adds `tray` and `notification`'s functions as well, which share its icon on Windows. |
| `root` | The absolute path of the extension's folder, `import.meta.dirname` in `crossbind.extension.js`. It is under the project's `paths.base`, as all a build sees is. |
| `app.sources` | The C++ sources every platform compiles, relative to `root`. |
| `app.urlSchemes` | The schemes whose links the extension's native code gets through `onUrl`, as [`app.urlSchemes`](./app.md#links)' rules take them, on every platform: an extension that declares them has native code on each platform the app builds for. The build tells each system of them beside the app's own, and two owners of one scheme stop the build, naming both. |
| `app.<platform>` | What one platform adds: `darwin`, `ios`, `linux`, `win32` or `android`. |
| `options` | What the extension's native code reads as `registry.options()`, as `crossbind.extension.js` takes it from the app: a JSON value alone, of plain objects, arrays, strings, finite numbers, booleans and null. |

What a platform adds:

| Key | Platforms | Value |
|---|---|---|
| `sources` | all | Its own sources: `.cpp`, `.cc` or `.cxx`, and on `darwin` and `ios` Objective-C++ `.mm` too, which compile with ARC. |
| `frameworks` | `darwin`, `ios` | The Apple frameworks the app links, as `UniformTypeIdentifiers`. |
| `libraries` | `linux`, `win32`, `android` | The libraries the app links: Windows' own, as `comctl32`, and on Linux those of crossbind's sysroot. |
| `entitlements` | `darwin`, `ios` | The entitlements the app takes: on macOS merged with `app.permissions`', on iOS written into the app's entitlements file. Two owners that give one key different values stop the build. |
| `java`, `class` | `android` | The folder of the extension's Java, relative to `root`, and the class in it the app calls, which implements `dev.crossbind.app.Extension`. Both or neither. |

## The native side

One of the sources defines the entry, which adds what the extension does and starts nothing: it runs on the main thread
as the app starts, before the app's module, in every launch, one that another instance then takes as well. What the
extension starts as the app runs, it starts in `onWindow`. An entry that throws stops the app, saying why and naming the
extension:

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
| `Call` | A call of the page's: its `name()` and `options()`. Its function answers it once, from any thread, with `resolve(value)` or `reject(message)`; a call that every copy lets go of unanswered fails. `isFromPage()` is false for the calls the host's own extensions take from the app's native code through `<crossbind/app.h>`, which reaches more than the page may. |
| `Registry::function(name, fn)` | Adds a function the page calls by that name. It runs on the module's thread, which it must not hold up: it answers there, or hands the call on. What it throws fails the call. |
| `Registry::options()` | The extension's `options`, a `Value`: null without any. |
| `Registry::onLaunch(fn)` | Takes a desktop app's launches, as one extension alone does: `fn` gets each `Launch`, its `args`, `cwd` and the `token` that lets a Linux window take the front, on the main thread before the module starts. `false` ends the launch with exit status 0; what `fn` throws ends it with status 1 and says why, in a message box as well when the app's user opened it. iOS and Android keep an app to one instance themselves and never call it. |
| `Registry::onWindow(fn)` | Runs `fn` on the main thread as the app's window opens, with `appWindow()` and `appWebView()` set, before its page loads: where the extension starts what it does as the app runs, as the host's `power` starts hearing of the system's sleep. A desktop app opens one window, an iOS app one for each scene that connects; an Android app has none an extension reaches and never calls it. |
| `Registry::onQuit(fn)` | Runs `fn` once as the app quits or fails, on the thread that ends it, before its module stops: never in a launch that `onLaunch` ends, nor in one whose extensions fail to start. A phone's system may end an app without either. |
| `Registry::onUrl(fn)` | Gets each link of the extension's `app.urlSchemes`, wherever the system hands it over: in a launch's arguments, as macOS's Apple Event, to the iOS scene or in the Android intent. It runs on any thread, which it must not hold up, as the later launches wait for it. The page hears of none of these links. A link is whatever the system hands the app, so `fn` takes it as it would any address from outside. An extension that declares schemes calls it, and one that calls it declares them. |
| `launchedAgain(launch)` | On the desktop, hands the app a later launch that the extension's `onLaunch` took from another process, from any thread: the window comes to the front, the page hears of the launch as the event `second-instance`, and its links reach the owners of their schemes. |
| `inBackground(call, work)` | Runs `work` on a thread of its own, which answers the call with what `work` returns, or with what it throws. |
| `onMainThread(fn)` | Runs `fn` on the app's main thread, where the platform's UI is called. Not on Android. |
| `appWindow()` | The app's window on the main thread: an `NSWindow` on macOS, a `UIWindow` on iOS, a `GtkWindow` on Linux and an `HWND` on Windows; null before it has one. Not on Android. |
| `appWebView()` | The app's webview on the main thread: a `WKWebView` on macOS and iOS, an `ICoreWebView2Controller` on Windows, and on Linux a `WebKitWebView` in a vertical `GtkBox`, which puts the widgets an extension adds to it with `gtk_container_add` above the page at their own height: the window holds the page to `app.window`'s limits, with their height added. Null before the app has one. Not on Android. |
| `appName()` | The app's name, as its window and dialogs show it. |
| `allowPath(path)` | Lets the page reach a file or folder through `crossbind/app`'s shell functions from now on, as what its user picked: a picker's answer, for one. |
| `allowedPaths()` | What `allowPath()` was given so far, as it was given. |
| `android::callJava(extension, function, options, done)` | On Android, calls a function of the extension's Java on the UI thread with the app's activity; `done` gets why it failed, or its result, once. |

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
one of org.json's values, or `reject()`. What `call()` throws fails the call. An extension hears of the activity's life
through `onCreate`, `onNewIntent`, `onResume`, `onPause` and `onDestroy`, each a default of `Extension`'s. It asks for
permissions through the activity's `afterAsking(permissions, then)` and starts an activity for its result through
`startForResult(intent, (result, data) -> …)`, so the requests of the activity and of other extensions never meet
its own.

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

## The package

An extension's `package.json`:

- names it `@<scope>/extension-<name>`, or `crossbind-extension-<name>` without a scope;
- points `crossbind.extension` at `./crossbind.extension.js`, which `exports` gives as well;
- lists the native sources in `files`;
- names the crossbind versions it works with as a peer dependency of `crossbind`;
- has the keyword `crossbind-extension`, by which npm finds extensions;
- has the license of the code it carries, its own and any it wraps, as an SPDX expression.

The native code an extension builds from is in the package, pinned with it; a build downloads none.

`npm create crossbind@beta -- <name> Extension` scaffolds one, `crossbind-extension-<name>`, from `examples/app-extension`.

## Testing

Native code has its checks in an app: the page calls the extension's functions and checks what they answer, on each
platform the extension takes. crossbind's own run in `e2e/desktop-app`, whose page checks the clipboard on macOS, Linux,
Windows, the iOS Simulator and the Android emulator. The JavaScript is unit-tested as any package's.

## Limits

- **Android:** Java alone, and nothing from Maven, as the app builds offline against the Maven cache of crossbind's
  android-app image, which pins every artifact.
- **Apple:** Objective-C++ and C++, with no Swift.
- **Windows:** Win32 alone, as the toolchain has no WinRT projection.
- **Linux:** the libraries of crossbind's sysroot alone, 28 pinned Ubuntu 22.04 packages per architecture. The app's
  Debian package depends on WebKitGTK and GTK alone, so a library beyond theirs has to be on its users' machines.
