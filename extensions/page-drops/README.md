# @crossbind/extension-page-drops

The paths of files dropped on a desktop page, which a web page never gets.

It comes with `@crossbind/core-app-host`: there is nothing to install or list.

## What it does

When its user drops files on a desktop page, the page gets the event `drop`, `{ paths, x, y }`: their absolute paths,
which a web page never gets, and where they were dropped. The page's own `drop` event still fires, with its `File`s.

```js
import { events } from 'crossbind/app';

events.on('drop', ({ paths }) => importAll(paths));
```

## Platforms

macOS, Linux and Windows.

## Replace or leave out

It holds the role `page-drops`. An extension with `replaces: 'page-drops'` takes it; `app: { without: ['page-drops'] }` in `crossbind.config.js` leaves it out. [The guide](https://crossbind.dev/guide/extensions/#replace) shows how, and [extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-hosts-own-extensions) what a replacement answers.

[extensions.md](https://github.com/crossbind/crossbind/blob/main/docs/api/extensions.md#the-pages-requests) has the hooks a replacement answers.
