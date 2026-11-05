# @crossbind/extension-tar-gz

A Linux archive, which a Linux app updates itself from.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app build -p linux
```

A Linux build writes a `.tar.gz` named after the app beside its folder: the app, which unpacks anywhere its user can write and
registers nothing. A Linux app with `app.updater` updates itself from it.

## Platforms

Linux, x64 and arm64.

## Replace or leave out

An extension named `tar-gz` with an installer takes its place, and `app: { without: ['tar-gz'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#installers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#installers) has every installer, and `app.installers` names those a build runs, as `['dmg']`.
