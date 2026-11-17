# @crossbind/extension-page-navigation

Loads the app's pages and the origins it lists, and opens other links the user follows in the browser.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## What it does

The app's own pages load, and so do those of the origins `app.navigation.load` lists. A link to another origin that the
user follows opens in the default browser; any other navigation loads nothing. It also holds `page-authentication` and
answers nothing there, so the host cancels HTTP sign-ins and certificate errors; an extension that takes
`page-authentication` can answer them.

## Options

`app.navigation.load` lists the origins that load in the app, as `['https://login.example.com']`.

## Platforms

macOS, iOS, Linux, Windows and Android.

## Replace or leave out

It holds the roles `page-authentication` and `page-navigation`. An extension with `replaces: 'page-authentication'` takes that role alone, and this one keeps the rest; `app: { without: ['page-navigation'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.navigation` is set stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-pages-requests) has the hooks a replacement answers.
