# @crossbind/extension-instance

Keeps a desktop app to one instance, handing later launches to the one running.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```js
import { events } from 'crossbind/app';

events.on('second-instance', ({ args, cwd }) => openFrom(args, cwd));
```

A later launch brings the running app's window to the front and hands it its arguments.

## Options

`app.singleInstance: true` keeps the app to one instance. On Windows and Linux an app with URL schemes or file types has it
without asking, as a link or a file starts the app again there; `false` turns that off.

## Platforms

macOS, Linux and Windows. A phone keeps every app to one instance itself.

## Replace or leave out

It holds the role `instance`. An extension that gives `replaces: 'instance'` takes it; `app: { without: ['instance'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.singleInstance` is true stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#one-instance) has how a launch is handed over.
