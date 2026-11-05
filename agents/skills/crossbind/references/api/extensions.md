<!-- GENERATED from docs/api/extensions.md by scripts/build-agent-skill.mjs. Do not edit. -->

# App extensions

An app extension adds functions to an app (`target.runtimeEnv: 'app'`): native code the app's host builds in, which
the page calls by name. A package of its own carries it, as
[`@crossbind/extension-clipboard`](../../extensions/clipboard/README.md) carries the system clipboard's text on macOS,
iOS, Android, Windows and Linux. The host's own, `dialog`, `instance`, `links`, `menu`, `page-dialogs`, `page-files`,
`page-permissions`, `power`, `shell` and `updater`, are built the same way. An extension may add a store the app is
published to as well, as [Publishers](#publishers) says, and what installs a desktop app, as
[Installers](#installers) says: crossbind's own stores, `google-play`, `app-store` and `github`, and installers, `dmg`,
`deb`, `tar-gz`, `nsis` and `zip`, are of the same kind.

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
| `name` | Lowercase letters and digits, which dashes may join. It prefixes the extension's function names, as `clipboard.readText`, and names its C++ entry, `crossbind_extension_<name>`, with underscores for dashes. Two extensions of one name stop the build, but for one of the host's own: an extension `extensions` lists under the name `dialog`, `instance`, `links`, `menu`, `page-dialogs`, `page-files`, `page-permissions`, `power`, `shell` or `updater` replaces the host's, and the page's calls of its functions, and the app's C++ through `<crossbind/app.h>`, reach the one listed. The host's own `menu` adds `tray` and `notification`'s functions as well, which share its icon on Windows. |
| `root` | The absolute path of the extension's folder, `import.meta.dirname` in `crossbind.extension.js`. It is under the project's `paths.base`, as all a build sees is. |
| `app.sources` | The C++ sources every platform compiles, relative to `root`. |
| `app.urlSchemes` | The schemes whose links the extension's native code gets through `onUrl`, as [`app.urlSchemes`](./app.md#links)' rules take them, on every platform: an extension that declares them has native code on each platform the app builds for. The build tells each system of them beside the app's own, and two owners of one scheme stop the build, naming both. |
| `app.<platform>` | What one platform adds: `darwin`, `ios`, `linux`, `win32` or `android`. |
| `options` | What the extension's native code reads as `registry.options()`, as `crossbind.extension.js` takes it from the app: a JSON value alone, of plain objects, arrays, strings, finite numbers, booleans and null. |
| `publisher` | The store it sends the app to, as [Publishers](#publishers) says. |
| `installer` | What it makes to install a desktop app, as [Installers](#installers) says. |

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
| `Registry::onPageDialog(fn)`, `onPagePermission(fn)`, `onFileInput(fn)` | Take the page's dialogs, what it asks to use and its file inputs, as the extension named `page-dialogs`, `page-permissions` or `page-files` alone does: see [The page's requests](#the-pages-requests). Not on Android, where its Java takes them. |
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
| `FileInput` | `allowsMultiple()`, `allowsFolders()` and the types its `accept()` names, where the webview tells them. `pick(paths)` answers with the files picked, and `cancel()` with none. |

`fn` runs on the main thread, where it may show a modal dialog of the platform's, and the request is answered once, from
any thread, as the page waits. One that every copy lets go of unanswered, or whose `fn` throws, is cancelled: an alert
closes, a confirm gives false and a prompt null, a permission is denied and a file input gets no files. The kinds are
`camera`, `microphone`, `location` and `clipboard`, and the webview's others by their names, as `screen`,
`notifications`, `midi`, `media-keys`, Windows' `downloads`, of several files at once, or iOS's `motion`.

| | `page-dialogs` | `page-permissions` | `page-files` |
|---|---|---|---|
| macOS | Every dialog | The camera, the microphone, and the location the host gives the page, which it asks about once a run | Every file input |
| iOS | Every dialog | The camera, the microphone, the location and the device's motion | None: WKWebView shows its own picker |
| Linux | Every dialog | Every request of WebKitGTK's | Every file input |
| Windows | Every dialog | Every request of WebView2's but autoplay and the sensors, which it gives as it would. A clipboard read without its user's gesture is denied first. | None: WebView2 shows its own picker |
| Android | Through the Java, from a frame of the app's origins alone | Through the Java, from a frame of the app's origins alone | Through the Java |

The host's own `page-dialogs` shows the system's dialog, titled with the app's name; `page-permissions` allows what
`app.permissions` lists, which the system may then ask its user for, and a clipboard read, and denies the rest; and
`page-files` shows macOS's open panel and Android's picker. Where the extension of that name has no native code, as one
an app lists for macOS alone, the webview does as it would without crossbind: WKWebView answers a dialog at once, as an
alert's OK and a confirm's and a prompt's Cancel, and asks its own question for a permission, but for a macOS page's
location, which the host denies; WebKitGTK and WebView2 show their own dialogs, WebKitGTK denies a permission and
WebView2 asks; and an Android app's WebView shows its own dialogs and denies a permission. A page's `beforeunload` asks
nothing where `page-dialogs` takes the dialogs, as it never does on Apple's and Android's: the page leaves at once.

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

The Java of the extension named `page-dialogs`, `page-permissions` or `page-files` gets the page's requests through
`onPageDialog(activity, dialog)`, `onPagePermission(activity, request)` and `onFileInput(activity, input)`, defaults of
`Extension`'s, on the UI thread: each returns true and answers once, from any thread, or false to leave the request to
the WebView, which shows its own dialog, denies the permission or shows no picker. One it throws on is cancelled, and a
frame of another origin, which Android lets the page hold, gets no dialog and nothing it asks to use. `FileInput`'s
`params()` is the WebView's account of the input, whose `createIntent()` opens the system's picker, and its `pick(uris)`
keeps content URIs alone.

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
| `options` | The options it takes after its name, by camelCase names the command line writes in `--kebab-case`: `{ help }` for a flag, which is true or false, and `{ help, value, default }` for one that takes a value, which `value` names as `'<channel>'`. `platform`, `help` and `version` are the command's own, and two publishers of one publish take an option of one name alike. |
| `after` | The publisher it comes after: the publish runs that one first, from the same build. A publisher after another takes no `build`, `buildNumber` or `buildEnv`, and asks for no other build. |
| `build(api)` | The changes the publish's build makes to `crossbind.config.js`, the app's other builds keeping it as it is: a JSON merge patch of its export, in which objects merge, `null` removes a key and any other value takes the place of the one there. `{ app: { updater: null } }` builds the app without its updater, as a store that updates apps itself takes it, and signs no update whatever `CROSSBIND_UPDATER_PRIVATE_KEY` holds. |
| `check(api)` | All the store needs, before the build: `{ missing }` lists what is not there, and `{ session }` is what the steps after it get. On a terminal, `api.isGuided`, it may ask for what is missing and set it up. |
| `buildNumber(api, session)` | The build number, as `CROSSBIND_APP_BUILD_NUMBER` gives it to the build, or null for the app's own. |
| `buildEnv(api, session)` | Variables the build runs with beside crossbind's; one set to `undefined` is left out. |
| `upload(api, session, output, published)` | Sends what the build made to the store. It returns `{ isRebuildAsked: true }` for another build, after which it runs again, or `{ published }`: what it put out, which a publisher after it gets as `published`. |

All but `platform` and `upload` are optional.

### A publish

`crossbind app publish demo-store --channel stable --mode staging`:

1. finds the publisher, after those it comes after;
2. builds for the platform `-p` names, else the publisher's only one, else `CROSSBIND_APP_PLATFORM`'s, else this
   machine's desktop one;
3. takes each publisher's options from the command line, after the store's name: one of another store's is refused,
   naming whose it is, and any other goes on to Vite, as `--mode` does;
4. runs the first publisher's `build`, then every `check`: without a terminal, as in CI, every missing piece is named at
   once;
5. builds the app once, with the first publisher's changes, build number and environment;
6. hands the build's output to each `upload` in turn.

Without a name, `-p android` publishes to `google-play` and `-p ios` to `app-store`. `crossbind app publish --help`
lists crossbind's own stores with their options.

### What the build made

| Platform | `output` |
|---|---|
| `android` | `{ project, apk, bundle, symbols }`: the Gradle project, and beside it the APK, the bundle and the zip of the native debug symbols, each null where the build made none, as the bundle without an upload key. |
| `ios` | `{ project }`: the Xcode project, which a store archives. |
| `macos`, `linux`, `windows` | One `{ app, arch, installers, update }` for each arch: the app, its installers as `[{ name, files }]`, as `[{ name: 'dmg', files: ['…/demo.dmg'] }]`, and the update's `{ manifest, file }` where `app.updater` and its key made one, else null. |

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
        root: import.meta.dirname,
        installer: {
            platform: 'linux',
            check() {
                const isThere = spawnSync('appimagetool', ['--version']).status === 0;
                if (!isThere) throw new Error('appimage takes appimagetool, which is on no folder of the PATH.');
            },
            make(api, { app, arch }) {
                // appimagetool packs a copy of the app's folder for the arch, with its AppRun and desktop entry.
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
| `make(api, { app, arch })` | Makes what installs the app, once every app of the build has its page: `app` is the app's bundle on macOS and its folder on Linux and Windows, beside which it writes, and `arch` is `x64` or `arm64`. It returns the paths of the files it made, a relative one beside the app. |

`make` alone is required.

A desktop build runs every installer of its platform: crossbind's, then those of the extensions `extensions` lists, in
its order. `app.installers` names those alone that run, as `installers: ['deb']` builds a Linux app without its tar.gz,
and a publisher's `build` may narrow them for its own build, as `{ app: { installers: ['pkg'] } }` would for a store
that takes a package. A name that is no installer stops the build. The build's output gives each one's files to the
publishers, in the order they ran.

A Linux or Windows app with `app.updater` updates itself from an installer's first file: a Linux app from `tar-gz`'s,
which it unpacks with tar, and a Windows app from `nsis`'s, a setup program it runs with `/S /UPDATE /D=<its folder>`.
Its build keeps that installer, and stops naming it where `app.installers` leaves it out; an extension's installer in
its place makes a file of the same kind. A macOS app's update is a zip of its own.

## The api

A publisher's or an installer's code imports nothing of crossbind's: each step gets the `api`, made for its extension
and its run, and frozen.

| Member | What it is |
|---|---|
| `name`, `platform`, `isGuided`, `options` | The extension's name, the platform it publishes or makes what installs, whether a terminal answers questions, and a publisher's options. |
| `project` | `{ root, name, package }`: the project's folder, its name, `general.name`, which names the app's files, and its `package.json`. |
| `workDir` | A folder of the extension's own under the build's, `.crossbind/build/<name>`, for its files and logs. |
| `app` | The app as its platform's build makes it: `id`, `name`, `version`, which is package.json's, `appleVersion`, its numbers alone as Apple takes them, `versionCode`, Android's, `buildNumber`, `team`, the Apple team, `encryption`, `updater`, `urlSchemes`, the schemes whose links open it, and `category`, `app.category` as macOS and a Linux menu name it, `{ macos, linux }`, or null. |
| `config` | `crossbind.config.js` as crossbind read it, read-only. `config.write('app.id', 'com.example.app')` writes an option into it once the user says yes on a terminal. A value the build would refuse fails with `isInvalid` set, for the publisher to ask again; one the config sets already is the user's to change. |
| `log(text)`, `warn(text)` | A line of crossbind's output. |
| `ask(question)`, `askYesNo(question)` | A question on the terminal, which fails without one. |
| `openUrl(url)` | Opens a page in the user's browser, as a store's console. |
| `settings` | `get(key)` and `set(values)`: this machine's settings in `~/.crossbind.json`, by uppercase names. |
| `secrets` | `get(name)` and `set(name, secret)`: secrets the system keychain keeps under the extension's own service. |
| `run(command, { cwd, isSigning })` | An installer's: runs a tool to its end where crossbind packages the platform's apps, on this Mac with Apple's tools on the PATH for macOS, and for Linux and Windows in crossbind's linux or windows image, which sees the project's `paths.base` alone. `command` is the program and its arguments; `cwd`, relative to the project's folder, which it is without it, is under the base for an image. `isSigning` gives a Windows tool the key that signs the app, which `windows.signer` signs with. A failure throws, with the tool's output. |
| `windows` | `icon()`, the app's icon as a Windows `.ico`, or null without `app.icon`; and `signer`, the script that signs a file in the windows image with the key the environment names, which a tool that signs as it builds runs, as NSIS does, or null without a key. |
| `android` | `signing()`, the environment a release builds in with this machine's upload key, as `{ env, isSigned }`, and `makeUploadKey()`, as `crossbind app upload-key` makes it. |
| `apple` | `key()`, the App Store Connect API key the environment names, or null; `teams()`, the teams Xcode is signed in to; `xcodebuild(what, args, { log, facts, causes })`, whose failure names xcodebuild's reasons and the fix of the cause it finds, crossbind's first, then one of `causes`; `unreasonedApis(binary, privacy)`, the required reason API a binary calls with no reason in `privacy`; `privacyCategories`; and `dsyms()`, the dSYMs of the prebuilt frameworks crossbind puts in an app. |

A publisher's or an installer's code runs in crossbind's process, with the developer's credentials, as all build code
does: listing an extension is the decision to trust it. `e2e/desktop-app` checks the contract with the probe's store,
a mirror after it and the probe's installer: `pnpm e2e:publish` publishes through the two stores, and every build makes
the installer's note beside the app, which `pnpm e2e:prod` reads.

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
Windows, the iOS Simulator and the Android emulator, and the page's requests through owners of its own in place of
`page-dialogs` and `page-permissions`. `e2e/app-page-requests` keeps the host's own, whose dialogs its run answers as
the app's user would, on Linux and Windows. The JavaScript is unit-tested as any package's.

## Limits

- **Android:** Java alone, and nothing from Maven, as the app builds offline against the Maven cache of crossbind's
  android-app image, which pins every artifact.
- **Apple:** Objective-C++ and C++, with no Swift.
- **Windows:** Win32 alone, as the toolchain has no WinRT projection.
- **Linux:** the libraries of crossbind's sysroot alone, 28 pinned Ubuntu 22.04 packages per architecture. The app's
  Debian package depends on WebKitGTK and GTK alone, so a library beyond theirs has to be on its users' machines.
