# @crossbind/extension-msix

A Windows app's MSIX package: for the Microsoft Store, which signs, hosts and updates it, or handed out, signed with the
app's key.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## Use

For the Store, `app.windows.msix` in `crossbind.config.js` gives the identity Partner Center's Product identity page
shows once the app's name is reserved as an "MSIX or PWA app":

```js
app: {
    icon: 'icon.png',
    windows: {
        msix: { name: '12345Example.Demo', publisher: 'CN=1A2B3C4D-…', publisherDisplayName: 'Example' },
    },
},
```

```sh
npx crossbind app build -p windows
```

A Windows build then writes an `.msix` named after the app and its architecture beside the app's folder, unsigned,
which Partner Center takes and the Store signs.

A package to hand out instead, with `msix` in `app.installers` and no `app.windows.msix`, takes the app's id as its name
and its publisher from the certificate of the app's signing key (`CROSSBIND_WINDOWS_SIGNING_*`), which signs it too.
Windows installs it where that certificate is trusted.

- The version is `package.json`'s, as `1.2.3.0`. A prerelease such as `1.2.3-beta.1` stops the build, as the Store
  cannot tell it from the release.
- The logos come from `app.icon`, and the URL schemes and file types from `app.urlSchemes` and `app.fileTypes`. The app
  also opens by its executable's name, as an alias.
- An app from its package does not update itself: `updater.check()` rejects there, and the Store, or a newer package,
  updates it.

## Platforms

Windows 10 1809 and later, x64 and arm64.

## Replace or leave out

An extension named `msix` with an installer takes its place, and `app: { without: ['msix'] }` in `crossbind.config.js`
leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#installers) says
what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#installers) has every installer.
