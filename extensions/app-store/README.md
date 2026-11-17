# @crossbind/extension-app-store

Uploads an iOS or a macOS app to App Store Connect, for TestFlight and App Review.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## Use

```sh
npx crossbind app store app-store
npx crossbind app store app-store --send
npx crossbind app publish app-store --submit
npx crossbind app publish app-store -p macos --submit
```

A publish sends the iOS app, then the macOS one; `-p` sends one alone, and `crossbind app publish -p ios` with no
store name comes here. `crossbind app store` lists what only Apple's sites take, and `crossbind app store app-store
--send` sends the listing in `store/app-store` alone, with no build, into the version of `package.json`'s number,
through the App Store Connect API key.

- **iOS:** the publish builds the app with the next build number, archives it and uploads it to App Store Connect,
  whose TestFlight hands it to testers.
- **macOS:** the publish builds the app in the App Sandbox, without its updater and for macOS 13 or later, and Xcode
  exports it into the iOS app's record, as a universal purchase. Xcode's account or an Admin key signs the app and its
  installer package in the cloud, so you make no certificate by hand.

`--submit` also hands the version to App Review, with the listing in `store/app-store`: its `APP_DESKTOP` screenshots
go with the macOS version, the others with the iOS one. `--phased` releases what App Review approves in phases over 7
days.

## Platforms

An iOS app, built on a Mac with Xcode, and a macOS app, built and uploaded on macOS.

## Replace or leave out

An extension named `app-store` with a publisher takes its place, and `app: { without: ['app-store'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#app-store-connect) has what it needs before the build and how it asks for what is missing, and its [Mac App Store](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#mac-app-store) section what the App Sandbox changes.
