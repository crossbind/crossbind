# @crossbind/extension-shell

Opens addresses and files outside the app, shows them in the file manager, moves them to the trash.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## Use

```js
import { shell } from 'crossbind/app';

await shell.openExternal('https://crossbind.dev');
await shell.revealInFolder(path);
```

## Options

`app.openPath` lists where `shell.openPath` may open files: `data`, `cache`, `logs` and `picked`. Without it, nowhere,
since opening a program runs it. `shell.revealInFolder` and `shell.trash` reach the app's own folders and what a dialog
picked during this run. The app's native code, calling these by name with `invoke()`, reaches any path. A page of the
role `project`, of an origin an extension serves, reaches `shell.openExternal` alone, for an http, https or mailto
address as any page.

## Platforms

`shell.openExternal` on macOS, Linux, Windows and iOS; the others on the desktop alone.

## Replace or leave out

It holds the role `shell`. An extension with `replaces: 'shell'` takes it; `app: { without: ['shell'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.openPath` lists a place stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#the-apps-functions) has each function.
