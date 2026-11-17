# @crossbind/extension-app-store

Uploads an iOS or a macOS app to App Store Connect, for TestFlight and App Review.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app store app-store
npx crossbind app publish app-store --submit
npx crossbind app publish app-store -p macos --submit
```

It takes iOS and macOS apps alike: a publish sends the iOS app, then the macOS one, and `-p` names one to send alone;
an iOS publish that names no store comes here.
`crossbind app store` names what Apple alone takes of either. An iOS publish builds the app with the next build number,
archives it and uploads it to App Store Connect, whose TestFlight hands it to testers. A macOS publish builds the app in
the App Sandbox, without its updater and for macOS 13 or later, puts it in an archive as Xcode makes one, and has Xcode
export it to App Store Connect, into the iOS app's record as a universal purchase: Xcode's account or an Admin key signs
the app and its installer package in the cloud, so no certificate is made by hand. `--submit` hands the version to App
Review too, with the listing in `store/app-store`, whose `APP_DESKTOP` screenshots go with the macOS version and the
others with the iOS one, and `--phased` releases what App Review approves in phases over 7 days.

## Platforms

An iOS app, built on a Mac with Xcode, and a macOS app, built and uploaded on macOS.

## Replace or leave out

An extension named `app-store` with a publisher takes its place, and `app: { without: ['app-store'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#app-store-connect) has what it needs before the build, and how it asks for what is missing; its [Mac App Store](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#mac-app-store) section what the App Sandbox changes.
