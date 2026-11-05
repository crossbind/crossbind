# @crossbind/extension-zip

A Windows zip, for those who take no setup program.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app build -p windows
```

A Windows build writes a `.zip` named after the app beside its folder, of the app as signed, which registers nothing.

## Platforms

Windows, x64 and arm64.

## Replace or leave out

An extension named `zip` with an installer takes its place, and `app: { without: ['zip'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#installers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#installers) has every installer, and `app.installers` names those a build runs, as `['dmg']`.
