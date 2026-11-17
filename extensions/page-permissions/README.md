# @crossbind/extension-page-permissions

What a page may use, such as the camera and the microphone.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## What it does

The page gets the devices `app.permissions` lists, such as the camera and the microphone, and the clipboard's text on a
user gesture, and nothing else, so the webview never asks the app's user anything itself. The system still asks for each
device.

## Options

`app.permissions` lists each device with the reason the system shows, as `{ camera: 'To scan barcodes' }`.

## Platforms

macOS, iOS, Linux, Windows and Android.

## Replace or leave out

It holds the role `page-permissions`. An extension with `replaces: 'page-permissions'` takes it; `app: { without: ['page-permissions'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.permissions` is set stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-pages-requests) has the hooks a replacement answers.
