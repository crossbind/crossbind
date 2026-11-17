# @crossbind/extension-dialog

Open and message dialogs everywhere, save dialogs on the desktop.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## Use

```js
import { dialog } from 'crossbind/app';

const files = await dialog.open({ multiple: true, filters: [{ name: 'Text', extensions: ['txt'] }] });
const button = await dialog.message({ message: 'Saved.', buttons: ['OK', 'Show'] });
```

`dialog.open` and `dialog.save` resolve with what the user picked, or `null` when they cancel; `dialog.message` with the
index of the button clicked. A file a dialog picked is one the page's `shell` functions may reach during this run.

## Platforms

`dialog.open` and `dialog.message` on macOS, Linux, Windows, iOS and Android; `dialog.save` on macOS, Linux and Windows.

On a phone, `dialog.open` shows the system's document picker, without a title, and gives copies of the picked files in a
temporary folder the system may empty. With `directory: true` an iOS app gets the folder itself, which it reaches while
it runs; Android picks files only. Android filters by type where it knows an extension's type, and offers any file
otherwise. A phone saves the page's files as downloads: the export sheet on iOS, the save picker on Android.

## Replace or leave out

It holds the role `dialog`. An extension with `replaces: 'dialog'` takes it; `app: { without: ['dialog'] }` in `crossbind.config.js` leaves it out. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#the-apps-functions) has every option.
