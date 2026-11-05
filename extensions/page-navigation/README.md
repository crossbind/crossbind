# @crossbind/extension-page-navigation

Loads the app's pages and the origins it lists, and opens other links the user follows in the browser.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## What it does

The app's own pages load, and so do those of the origins `app.navigation.load` lists. A link to another origin that the
user follows opens in the default browser; any other navigation loads nothing. It holds `page-authentication` as well,
for which it answers nothing, so the host cancels an HTTP sign-in and a certificate error: an extension that takes
`page-authentication` answers them.

## Options

`app.navigation.load` lists the origins that load in the app, as `['https://login.example.com']`.

## Platforms

macOS, iOS, Linux, Windows and Android.

## Replace or leave out

It holds the roles `page-authentication` and `page-navigation`. An extension that gives `replaces: 'page-authentication'` takes that role alone, and this one goes on with the rest; `app: { without: ['page-navigation'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.navigation` is set stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-pages-requests) has the hooks a replacement answers.
