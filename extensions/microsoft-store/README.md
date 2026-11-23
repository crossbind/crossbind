# @crossbind/extension-microsoft-store

Sends a Windows app's MSIX packages and listing to the Microsoft Store through Partner Center's submission API, and
submits them for certification.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## Use

```sh
npx crossbind app store microsoft-store
npx crossbind app store microsoft-store --send
npx crossbind app upload microsoft-store
npx crossbind app release microsoft-store --rollout 10
```

`crossbind app store` lists what only Partner Center does: reserving the app's name as an "MSIX or PWA app", whose
identity goes in `app.windows.msix`; the Entra ID application its API takes, whose tenant the account's owner
associates first; and what the app's first submission still wants there, its age ratings first. An upload builds the
MSIX packages, x64 and arm64, and leaves them with the listing in `store/microsoft-store` in a submission of the app,
not submitted yet; the app's first goes up the same way and is finished in Partner Center. A release puts the listing
into that submission again and commits it for certification, with no build, and `--rollout` gives the packages to a
share of the app's users first. `crossbind app store microsoft-store --send` sends the listing alone, with no build,
in a submission of the packages Partner Center has, and stops at one an upload left, naming the release.

## Platforms

A Windows app.

## Replace or leave out

An extension named `microsoft-store` with a publisher takes its place, and `app: { without: ['microsoft-store'] }` in
`crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers)
says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#microsoft-store) has what it needs, the
listing's files and how an upload asks for what is missing.
