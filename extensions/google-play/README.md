# @crossbind/extension-google-play

Sends an Android bundle to a Google Play testing track, puts what the testers have out on production, at a staged
rollout's share, and sends the app's listing alone.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## Use

```sh
npx crossbind app upload google-play --track beta
npx crossbind app release google-play --rollout 10
npx crossbind app store google-play --send
```

An upload builds the Android app with the next versionCode Google Play takes and puts its bundle out to the testers of
a testing track: `internal` unless `--track` names another. `crossbind app upload -p android` with no store name uses
it. A release puts the newest release the testing tracks have out on production, with no build, and `--rollout` gives
it to a percent of the users first. The listing in `store/google-play`, its texts, images and settings, goes with a
release, or alone with `crossbind app store google-play --send`; an upload sends the release's notes.

## Platforms

An Android app.

## Replace or leave out

An extension named `google-play` with a publisher takes its place, and `app: { without: ['google-play'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#google-play) has what it needs before the build, and how it asks for what is missing.
