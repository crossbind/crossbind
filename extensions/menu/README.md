# @crossbind/extension-menu

The app's menus and context menus, the tray icon and system notifications.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```js
import { events, menu, notification, tray } from 'crossbind/app';

events.on('menu', ({ id }) => run(id));
await menu.set([{ label: 'File', items: [{ label: 'Export', id: 'export', accelerator: 'CmdOrCtrl+E' }] }]);
await tray.set({ tooltip: 'My app', menu: [{ label: 'Show', id: 'show' }] });
await notification.show({ title: 'Export done', body: 'report.csv is saved.' });
```

A click of an item with an id is the event `menu`; `menu.popup` opens a context menu at the page's point.

## Platforms

macOS, Linux and Windows; `menu.setDock` is macOS's alone. On a phone each call rejects. A Linux tray and its notifications go over D-Bus, and a Windows notification shows as a balloon of the tray's icon.

## Replace or leave out

It holds the roles `menu`, `notification` and `tray`. An extension that gives `replaces: 'menu'` takes that role alone, and this one goes on with the rest; `app: { without: ['menu'] }` in `crossbind.config.js` leaves it out. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#menus) has the menus' items, and [Tray and notifications](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#tray-and-notifications) the rest.
