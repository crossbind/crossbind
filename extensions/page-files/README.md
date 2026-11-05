# @crossbind/extension-page-files

The system's picker for a page's file input, on macOS and Android.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## What it does

A page's file input opens the system's picker, with the types and the multiple choice the input asks for.

## Platforms

macOS and Android; the other webviews show their own picker.

## Replace or leave out

It holds the role `page-files`. An extension that gives `replaces: 'page-files'` takes it; `app: { without: ['page-files'] }` in `crossbind.config.js` leaves it out. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-pages-requests) has the hooks a replacement answers.
