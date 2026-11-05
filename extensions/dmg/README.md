# @crossbind/extension-dmg

A macOS disk image, which is also what Apple notarizes.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app build
```

A macOS build writes a `.dmg` named after the app beside it: a window with the app and a link to Applications, which its
user drags it to. With a Developer ID and an App Store Connect key, the disk image is what Apple notarizes.

## Platforms

macOS.

## Replace or leave out

An extension named `dmg` with an installer takes its place, and `app: { without: ['dmg'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#installers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#installers) has every installer, and `app.installers` names those a build runs, as `['dmg']`.
