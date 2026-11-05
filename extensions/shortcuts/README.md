# @crossbind/extension-shortcuts

The quick actions of a phone app's icon.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```js
import { events } from 'crossbind/app';

events.on('shortcut-item', ({ type }) => start(type));
for (const { type } of await events.held('shortcut-item')) start(type);
```

## Options

`app.shortcutItems` lists the quick actions of the app's icon, as `[{ type: 'new-note', title: 'New note' }]`. The app
has this extension only where one is listed.

## Platforms

iOS and Android.

## Replace or leave out

It holds the role `shortcuts`. An extension that gives `replaces: 'shortcuts'` takes it; `app: { without: ['shortcuts'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.shortcutItems` is set stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#quick-actions) has what an item takes.
