<!-- GENERATED from docs/playbooks/new-extension.md by scripts/build-agent-skill.mjs. Do not edit. -->

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
├── crossbind.extension.js    # default export: (options) => ({ name, root, app })
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

## Steps

1. **Name it.** Lowercase letters and digits, dashes between. Look on npm for the keyword `crossbind-extension`
   first, so two extensions do not take one name, which stops an app that lists both.
2. **Write the shared C++.** The entry registers each function as `<name>.<function>`, checks the options, and hands
   the call to the platform's code. A function that waits, as one that reads a file, goes `inBackground()`; one that
   calls the platform's UI goes `onMainThread()`, or through the Java on Android.
3. **Write each platform.** Each answers the call once, from any thread. A failure rejects with `crossbind: ` and
   what happened; a function never does nothing.
4. **Declare what each platform links and takes:** frameworks, libraries and entitlements in `crossbind.extension.js`,
   never by editing the app's generated projects.
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
- [ ] The package carries every source it builds from, and no binary.
