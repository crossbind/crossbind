# @crossbind/extension-dialog

Open and save dialogs on the desktop, message dialogs everywhere.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```js
import { dialog } from 'crossbind/app';

const files = await dialog.open({ multiple: true, filters: [{ name: 'Text', extensions: ['txt'] }] });
const button = await dialog.message({ message: 'Saved.', buttons: ['OK', 'Show'] });
```

`dialog.open` and `dialog.save` resolve with what the user picked, or `null` when they cancel; `dialog.message` with the
index of the button clicked. A file a dialog picked is one the page's `shell` functions may reach during this run.

## Platforms

`dialog.open` and `dialog.save` on macOS, Linux and Windows; `dialog.message` there and on iOS and Android.

## Replace or leave out

It holds the role `dialog`. An extension that gives `replaces: 'dialog'` takes it; `app: { without: ['dialog'] }` in `crossbind.config.js` leaves it out. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#the-apps-functions) has every option.
