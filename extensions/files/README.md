# @crossbind/extension-files

The files the system opens the app with.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```js
import { app, events } from 'crossbind/app';

events.on('open-files', ({ paths }) => openAll(paths));
openAll(await app.launchFiles());
```

## Options

`app.fileTypes` lists the types of files the app opens, as `[{ name: 'GeoJSON', extensions: ['geojson'] }]`. The page
gets those no extension's type takes. The app has this extension only where a type is listed.

## Platforms

macOS, Linux, Windows, iOS and Android.

## Replace or leave out

It holds the role `files`. An extension that gives `replaces: 'files'` takes it; `app: { without: ['files'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.fileTypes` is set stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#files) has each platform's rules.
