# @crossbind/extension-microsoft-store

Sends a Windows app's MSIX packages and listing to the Microsoft Store through Partner Center's submission API.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app store microsoft-store
npx crossbind app publish microsoft-store --rollout 10
```

`crossbind app store` names what Partner Center alone takes: the app's name, reserved as an "MSIX or PWA app", whose
identity `app.windows.msix` copies; the first submission, with its age ratings; and the Entra ID application its API
takes. Each later version then goes with a publish: it builds the Windows app's MSIX packages, x64 and arm64, puts them
into a new submission with the listing `store/microsoft-store` holds, and commits it for certification. `--draft`
leaves the submission for Partner Center to submit, and `--rollout` gives the packages to a percent of the app's users
first.

## Platforms

A Windows app.

## Replace or leave out

An extension named `microsoft-store` with a publisher takes its place, and `app: { without: ['microsoft-store'] }` in
`crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers)
says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#microsoft-store) has what it needs, the
listing's files and how a publish asks for what is missing.
