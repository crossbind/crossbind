# @crossbind/extension-google-play

Sends an Android bundle to a Google Play track, as a draft or a staged rollout.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```sh
npx crossbind app publish google-play --track beta --rollout 10
```

It builds the Android app with the next versionCode Google Play takes and releases its bundle on a track: `internal`
unless `--track` names another. `--draft` leaves the release for Play Console to roll out, and `--rollout` gives it to a
percent of the track's users first. An Android publish that names no store comes here.

## Platforms

An Android app.

## Replace or leave out

An extension named `google-play` with a publisher takes its place, and `app: { without: ['google-play'] }` in `crossbind.config.js` leaves it out. [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#publishers) says what one gives.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#google-play) has what it needs before the build, and how it asks for what is missing.
