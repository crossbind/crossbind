# @crossbind/extension-deb

A Debian package for Linux, whose dependencies bring WebKitGTK.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app build -p linux
```

A Linux build writes a `.deb` named after the app beside its folder, which `dpkg-deb` makes in crossbind's linux image. Its
dependencies bring the WebKitGTK and GTK the app runs on, and those its extensions list.

## Platforms

Linux, x64 and arm64.

## Replace or leave out

An extension named `deb` with an installer takes its place, and `app: { without: ['deb'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#installers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#installers) has every installer, and `app.installers` names those a build runs, as `['dmg']`.
