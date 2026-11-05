# @crossbind/extension-links

URL schemes and, on a phone, the https links of your sites.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## Use

```js
import { app, events } from 'crossbind/app';

events.on('open-url', ({ url }) => route(url));
for (const url of await app.launchUrls()) route(url);
```

Listening first, then asking, misses no link, the one the app was launched with among them.

## Options

`app.urlSchemes` names the schemes whose links open the app, as `['myapp']`, and on iOS and Android `app.links` the
https links of your sites, as `['example.com/invite']`. The app has this extension only where one of them is set.

## Platforms

URL schemes on macOS, Linux, Windows, iOS and Android; https links on iOS and Android.

## Replace or leave out

It holds the role `links`. An extension that gives `replaces: 'links'` takes it; `app: { without: ['links'] }` in `crossbind.config.js` leaves it out. Leaving it out while `app.urlSchemes` or `app.links` is set stops the build. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[app.md](https://github.com/crossbind/crossbind/blob/main/docs/api/app.md#links) has the rules of each.
