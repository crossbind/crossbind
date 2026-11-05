# @crossbind/extension-activities

Handoff on iOS and macOS, for the user activities the page sets and continues.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```js
import { app, events } from 'crossbind/app';

await app.setUserActivity({ type: 'com.example.notes.edit', userInfo: { id: 7 } });
events.on('user-activity', ({ type, userInfo }) => open(type, userInfo));
```

## Options

`app.activityTypes` lists the types of user activities the app sets and continues, as `['com.example.notes.edit']`. The
app has this extension only where a type is listed.

## Platforms

iOS and macOS. Elsewhere `app.setUserActivity` rejects.

## Replace or leave out

It holds the role `activities`. An extension that gives `replaces: 'activities'` takes it; `app: { without: ['activities'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.activityTypes` is set stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#user-activities) has the rules of a type.
