# @crossbind/extension-mac-app-store

Sends a sandboxed macOS app to App Store Connect, for TestFlight and App Review.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app store mac-app-store
npx crossbind app publish mac-app-store --submit
```

`crossbind app store` names what Apple alone takes: the macOS platform added to the app's record on App Store Connect,
which the iOS app shares as a universal purchase. A publish then builds the app in the App Sandbox, without its updater
and for macOS 13 or later, puts it in an archive as Xcode makes one, and has Xcode export it to App Store Connect, as
the iOS app goes: Xcode's account or an Admin key signs the app and its installer package in the cloud, so no
certificate is made by hand. `--submit` hands the version to App Review with the listing `store/app-store` holds, its
`APP_DESKTOP` screenshots for macOS, and `--phased` releases it in phases over 7 days once App Review approves it.

## Platforms

A macOS app, built and uploaded on macOS.

## Replace or leave out

An extension named `mac-app-store` with a publisher takes its place, and `app: { without: ['mac-app-store'] }` in
`crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers)
says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#mac-app-store) has what it needs and what the
App Sandbox changes.
