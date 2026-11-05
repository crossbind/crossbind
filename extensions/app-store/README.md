# @crossbind/extension-app-store

Uploads an iOS app to App Store Connect, for TestFlight and App Review.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app publish app-store --submit
```

It builds the iOS app with the next build number, archives it and uploads it to App Store Connect, whose TestFlight
hands it to testers. `--submit` hands the version to App Review too, with the listing in `store/app-store`, and
`--phased` releases what App Review approves in phases over 7 days. An iOS publish that names no store comes here.

## Platforms

An iOS app, built on a Mac with Xcode.

## Replace or leave out

An extension named `app-store` with a publisher takes its place, and `app: { without: ['app-store'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#app-store-connect) has what it needs before the build, and how it asks for what is missing.
