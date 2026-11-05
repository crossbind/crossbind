# @crossbind/extension-page-dialogs

A page's alert, confirm and prompt, as the system's dialogs.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## What it does

The page's `alert()`, `confirm()` and `prompt()` show as the system's own dialogs, under the app's name, and the page
waits for their answer, as in a browser.

## Platforms

macOS, iOS, Linux, Windows and Android.

## Replace or leave out

It holds the role `page-dialogs`. An extension that gives `replaces: 'page-dialogs'` takes it; `app: { without: ['page-dialogs'] }` in `crossbind.config.js` leaves it out. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-pages-requests) has the hooks a replacement answers.
