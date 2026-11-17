# @crossbind/extension-microsoft-store

Sends a Windows app's MSIX packages and listing to the Microsoft Store through Partner Center's submission API.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## Use

```sh
npx crossbind app store microsoft-store
npx crossbind app store microsoft-store --send
npx crossbind app publish microsoft-store --rollout 10
```

`crossbind app store` lists what only Partner Center does: reserving the app's name as an "MSIX or PWA app", whose
identity goes in `app.windows.msix`; the first submission, with its age ratings; and the Entra ID application its API
takes. Each later version goes with a publish: it builds the MSIX packages, x64 and arm64, makes a submission with them
and the listing in `store/microsoft-store`, and commits it for certification. `--draft` leaves the submission for you to
submit in Partner Center, and `--rollout` gives the packages to a share of the app's users first. `crossbind app store
microsoft-store --send` sends the listing alone, with no build, in a submission of the packages Partner Center has.

## Platforms

A Windows app.

## Replace or leave out

An extension named `microsoft-store` with a publisher takes its place, and `app: { without: ['microsoft-store'] }` in
`crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers)
says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#microsoft-store) has what it needs, the
listing's files and how a publish asks for what is missing.
