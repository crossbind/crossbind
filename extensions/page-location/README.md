# @crossbind/extension-page-location

navigator.geolocation on macOS, which WKWebView leaves out.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## What it does

A macOS page gets `navigator.geolocation`, which WKWebView gives a macOS page none of, where `app.permissions` lists the
location. The system asks its user first.

## Options

`app.permissions.location` turns it on, with the reason the system shows, as `{ location: 'To show where you are' }`.

## Platforms

macOS alone.

## Replace or leave out

It holds the role `page-location`. An extension that gives `replaces: 'page-location'` takes it; `app: { without: ['page-location'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.permissions.location` is set stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-pages-requests) has the hooks a replacement answers.
