# Playbook — Author an app extension

> **Extension author** — Use this workflow when an app needs a native function crossbind's host does not have, and it
> should ship as a package any crossbind app lists.

## Goal

A package that:

- adds functions to an app's host, which its page calls by name, on every platform it takes;
- builds from sources it carries, with no download;
- checks every option the page gives, and rejects what it refuses with what mends it;
- has page-side checks that pass in an app on each of its platforms.

[`docs/api/extensions.md`](../api/extensions.md) is the contract; this playbook is the order of the work.

## When to use

- The function is the app's, on the device: the clipboard, a sensor, a system dialog or service.
- The web's own API cannot do it in the system webview, or does it worse.

For C or C++ the page calls as a library, with no host of its own, port the library instead (see
[`new-port.md`](./new-port.md)). For code of one app alone, keep the extension in the app's repository and list it in
its `crossbind.config.js` with `root` its folder, as a package would give.

## Package shape

`npm create crossbind@beta -- <name> Extension` makes a start: `crossbind-extension-<name>`, with one function every
platform compiles from `native/<name>.cpp`, the page's module and types, and a README, named after the project.

Compare with `extensions/clipboard/`:

```text
<name>/
├── package.json              # @<scope>/extension-<name>, crossbind.extension, the crossbind-extension keyword
├── crossbind.extension.js    # default export: (options) => ({ name, contract: 1, root, app, options })
├── index.js                  # the page's functions, each through invoke('<name>.<function>')
├── index.d.ts
├── README.md                 # install, use, and what each platform does
└── native/
    ├── <name>.h              # the functions each platform defines
    ├── <name>.cpp            # crossbind_extension_<name>(Registry &): checks options, calls the platform
    ├── darwin.mm             # macOS
    ├── ios.mm                # iOS
    ├── linux.cpp             # GTK and GLib
    ├── windows.cpp           # Win32
    ├── android.cpp           # android::callJava() to the extension's Java
    └── android/dev/<...>/<Name>Extension.java
```

Every platform compiles `app.sources`, so a source there that calls a platform's code needs that code on every
platform. An extension that takes some platforms alone gives its sources per platform, the entry among them; on a
platform it gives none, the page's call rejects as the host has no such function: say so in the README.

## Beyond functions

An extension takes more than calls through the same registry, each as a section of
[`docs/api/extensions.md`](../api/extensions.md) tells:

| What | Through |
|---|---|
| URLs the page loads, as `<img>` and `<video>` do | `registry.route()`, [Routes](../api/extensions.md#routes) |
| Progress before an answer, and the page's cancel | `call.send()`, `call.onCancel()`, [Messages, cancels and bytes](../api/extensions.md#messages-cancels-and-bytes) |
| What it starts as the app runs, the app's windows, pages, state before its user, quit and reopening | `onStart`, `onWindow`, `onWindowClosed`, `onPage`, `onActive`, `onClose`, `onQuitRequest`, `onQuit`, `onReopen`, [The native side](../api/extensions.md#the-native-side) |
| Events the page listens for | `registry.events()`, [The native side](../api/extensions.md#the-native-side) |
| Launches, and the links, files, user activities and quick actions the system opens the app with | `onLaunch`, `onOpenUrl`, `onOpenFiles`, `onUserActivity`, `onShortcutItem`, with what the descriptor declares, [Launches and links](../api/extensions.md#launches-and-links) |
| Notifications and push on iOS and macOS | `onNotification`, `addNotificationCategories()`, `registerForPush()`, `onPushToken`, `onPushTokenFailure`, `onPushMessage`, [Notifications and push](../api/extensions.md#notifications-and-push) |
| The page's navigations, downloads, drops, dialogs, permissions and file inputs | the hooks of the role of each, which an extension takes from the host's with `replaces`, [The page's requests](../api/extensions.md#the-pages-requests) |
| What one of the host's own does, as its tray | `replaces`, [The host's own extensions](../api/extensions.md#the-hosts-own-extensions) |
| Files the app carries for it, as models | `app.files`, `registry.files()`, [What an extension is](../api/extensions.md#what-an-extension-is) |
| A store the app is published to, or what installs a desktop app | `publisher`, `installer`, [Publishers](../api/extensions.md#publishers), [Installers](../api/extensions.md#installers) |

What the system hands an app at launch reaches the owner the descriptor names: a scheme, a file type, a site, a user
activity's type or a quick action has one owner, the app or one extension, and an extension that declares one calls its
hook. What the host keeps for itself, [What the host keeps](../api/extensions.md#what-the-host-keeps) lists.

## Steps

1. **Name it.** Lowercase letters and digits, from a letter, dashes between. Look on npm for the keyword `crossbind-extension`
   first, so two extensions do not take one name, which stops an app that lists both: crossbind keeps the names of the
   host's own extensions and of their roles, `app`, `events`, `crossbind` and those that start with `page-`. Give it
   `contract: 1`, the version of the contract it is written for, and `replaces` for each role of the host's it takes.
2. **Write the shared C++.** The entry registers each function as `<name>.<function>`, which the app checks as it
   starts, checks the options, and hands the call to the platform's code. A function that waits, as one that reads a
   file, goes `inBackground()`; one that calls the platform's UI goes `onMainThread()`, which runs it after what waits
   there, or through the Java on Android. What the extension starts as the app runs it starts in `onStart`, and what it
   keeps for a page it lets go of in `onPage`.
3. **Write each platform.** Each answers the call once, from any thread. A failure rejects with `crossbind: ` and
   what happened; a function never does nothing.
4. **Declare what each platform links and takes** in `crossbind.extension.js`, never by editing the app's generated
   projects: its folders of includes and macros, frameworks, libraries and entitlements, an Apple app's Info.plist keys,
   as a usage description with a reason the extension's options take from the app, an iOS app's privacy reasons, an
   Android app's permissions, manifest elements and resources, and in `app.licenses` the code of others it carries.
5. **Write the page's module and types.** Each function checks its arguments before it calls `invoke`, so a wrong
   type fails at once, with the extension's name.
6. **Try it in an app.** `npm pack` it, and `crossbind add` the tarball in an app, which installs it and lists it in
   the app's `crossbind.config.js`; then build each platform: `crossbind app build -p macos`, `linux`, `windows`, `ios` and `android`. Linux and Windows build in
   crossbind's Docker images. A build sees the project's `paths.base` alone, its folder unless set, so a package
   linked in from beside the app, as a workspace's, takes `paths: { base: '..' }` or above both; a packed tarball
   installed into the app takes nothing.
7. **Check it.** The app's page calls each function and checks its answer, on each platform: on the desktop with
   `crossbind app dev`, on iOS in the Simulator and on Android in the emulator. crossbind's own extensions have their
   checks in `e2e/desktop-app/src/main.js`, as `checkClipboard`.
8. **Publish.** `npm publish` with the package's license as its SPDX expression, the keyword `crossbind-extension`,
   and `crossbind` as a peer dependency of the versions it was checked with.

## Review checklist

- [ ] Every option the page gives is checked in C++, and in the page's module.
- [ ] Each call is answered once on every path, a failure as well.
- [ ] Nothing holds up the module's thread.
- [ ] Nothing reaches beyond what the page could do itself without the app's opt-in in the extension's options.
- [ ] Each platform the README names has passed its page-side checks.
- [ ] The package carries every source it builds from, and no binary; `app.licenses` names the code of others in it.
- [ ] The extension gives the `contract` it is written for, and `replaces` for each role of the host's it takes.
- [ ] Each hook does its work on the thread its section names, and hands what the page should hear of on through
      `registry.events()`, with `hold()` where it may come before the page listens, as a launch's does.
- [ ] Each scheme, file type, site, user activity type and quick action the extension owns is in its descriptor, and
      the hook that gets them is called on each platform the system hands them over on.
- [ ] The files it carries are its own, inside its folder, with no link.
