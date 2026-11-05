# @crossbind/extension-page-downloads

Where a page's downloads go, asking on macOS, iOS and Android and saving to Downloads on Linux.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## What it does

A download the page starts, as a link with the `download` attribute, asks where to save: in a save panel on macOS, in the system's
export sheet on iOS and in its save picker on Android. On Linux it goes to the user's Downloads folder.

## Platforms

macOS, iOS, Android and Linux; on Windows, WebView2 shows its own downloads.

## Replace or leave out

It holds the role `page-downloads`. An extension that gives `replaces: 'page-downloads'` takes it; `app: { without: ['page-downloads'] }` in `crossbind.config.js` leaves it out. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-pages-requests) has the hooks a replacement answers.
