# @crossbind/extension-page-drops

The paths of files dropped on a desktop page, which a web page never gets.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## What it does

A desktop page hears of the files its user drops on it as the event `drop`, `{ paths, x, y }`: their absolute paths and
where they were dropped, which a web page never gets. The page's own `drop` event goes on, with its `File`s.

```js
import { events } from 'crossbind/app';

events.on('drop', ({ paths }) => importAll(paths));
```

## Platforms

macOS, Linux and Windows.

## Replace or leave out

It holds the role `page-drops`. An extension that gives `replaces: 'page-drops'` takes it; `app: { without: ['page-drops'] }` in `crossbind.config.js` leaves it out. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-pages-requests) has the hooks a replacement answers.
