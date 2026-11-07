# @crossbind/extension-nsis

A Windows setup program, which a Windows app updates itself from.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app build -p windows
```

A Windows build writes a `-setup.exe` named after the app beside its folder, which NSIS makes in crossbind's windows image. It
installs the app for its user, with a Start menu shortcut, its URL schemes and file types, and an uninstaller, which the
apps Settings lists show with package.json's `author` as the publisher. With a key
in the environment, the setup program and its uninstaller are signed. A Windows app with `app.updater` updates itself
from it.

## Platforms

Windows.

It carries NSIS 3.11's license (zlib, and MIT for its System plugin), whose stub and plugins the setup program holds, in
`third_party/nsis/`; provenance in its README.

## Replace or leave out

An extension named `nsis` with an installer takes its place, and `app: { without: ['nsis'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#installers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#installers) has every installer, and `app.installers` names those a build runs, as `['dmg']`.
