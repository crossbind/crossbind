# @crossbind/extension-deb

A Debian package for Linux, whose dependencies bring WebKitGTK.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## Use

```sh
npx crossbind app build -p linux
```

A Linux build writes a `.deb` named after the app beside its folder. Its dependencies bring the WebKitGTK and GTK the
app runs on, and whatever its extensions list.

## Platforms

Linux, x64 and arm64.

## Replace or leave out

An extension named `deb` with an installer takes its place, and `app: { without: ['deb'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#installers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#installers) has every installer, and `app.installers` names those a build runs, as `['dmg']`.
