# @crossbind/extension-github

Puts a desktop app's installers and update on a GitHub release.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app publish github -p macos
```

It builds the desktop app and puts its installers, and with `app.updater` its update and the update's manifest, on the
GitHub release of the version `package.json` gives. `--draft` leaves the release a draft.

## Platforms

macOS, Linux and Windows apps.

## Replace or leave out

An extension named `github` with a publisher takes its place, and `app: { without: ['github'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#github-releases) has the token it takes and the address `app.updater.url` points at.
