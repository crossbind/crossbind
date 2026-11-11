# @crossbind/extension-page-feel

A page that behaves as an app's own view, not as a web page.

An app has it by having `@crossbind/core-app-host`, which lists it as a dependency: there is nothing to install or list.

## What it does

| The page | Phones | Desktop |
| --- | --- | --- |
| Zoom, by a pinch, a double tap or focusing a small input | Off | Off on Windows, where Ctrl and the wheel zoom the page |
| The window moving past its edges | Only where the page scrolls | Off |
| Selecting text, and the I-beam over it | Only in what its user edits | Only in what its user edits |
| The menu of a long press or a right click | Only on what its user edits | Only on what its user edits |
| Dragging an image or a link out | Off | Off |
| The grey flash of a tap | Off | |
| A tapped element staying `:hover` | Its `:hover` styles show as pressed, while the finger is down | |
| Windows' status bar, autofill, swipe navigation and browser keys | | Off in a build for its users |

A build for development keeps the right-click menu, for Inspect Element, and on Windows the browser's keys.

Every style it adds loses to any rule of the app's, so the app chooses again where it wants the other:

```css
.article {
    -webkit-user-select: text;
    user-select: text;
    cursor: text;
}
html {
    overscroll-behavior: auto;
}
```

An app that names `maximum-scale` or `user-scalable` in its own viewport keeps its zoom.

## Platforms

macOS, iOS, Android, Linux and Windows.

## Replace or leave out

It holds the role `page-feel`. An extension that gives `replaces: 'page-feel'` takes it; `app: { without: ['page-feel'] }` in `crossbind.config.js` leaves it out, and the page behaves as in a browser.
