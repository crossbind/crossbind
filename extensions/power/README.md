# @crossbind/extension-power

Tells a desktop page when the system sleeps and wakes.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```js
import { events } from 'crossbind/app';

events.on('suspend', () => saveDraft());
events.on('resume', () => reconnect());
```

## Platforms

macOS, Linux and Windows, from the time the app's first window opens.

## Replace or leave out

It holds the role `power`. An extension that gives `replaces: 'power'` takes it; `app: { without: ['power'] }` in `crossbind.config.js` leaves it out. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#events-and-callbacks) has the app's other events.
