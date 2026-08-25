# @crossbind/landing

The crossbind landing page and the `/guide/` docs that sit behind it. Plain Vite + React, no
router and no CMS: the landing is one page built from a [Claude Design](https://claude.ai/design)
mock, and every guide page is prerendered to its own static HTML file, so links are plain
`<a href>` and the browser does the navigating.

```bash
pnpm --filter @crossbind/landing dev      # http://localhost:5173
pnpm --filter @crossbind/landing build    # → landing/dist
pnpm --filter @crossbind/landing preview
```

This is separate from `website/`, which is the Docusaurus documentation site and stays as it is.

## Layout

| Path | What lives there |
| --- | --- |
| `src/data.js` | Every piece of copy, every figure, every outbound URL |
| `src/theme.js` | Palettes, the light/dark token tables, and the persisted theme hook |
| `src/components/` | `Nav`, the `PlatformGlyph` SVG set, and the shared `ui.jsx` primitives |
| `src/sections/` | One file per band of the page, composed in `src/App.jsx` |
| `src/guide/pages/` | One file per guide page — content as data, no markup |
| `src/guide/nav.js` | The order everything derives from: sidebar, prev/next, hub cards, routes |
| `src/guide/` | `Guide.jsx` (the doc shell), `Article.jsx` (block renderer), ⌘K `Search.jsx` |

Components take a resolved `tokens` object and style themselves from it, so light and dark come
from one source. The theme lives in `localStorage` under `crossbind.landing.theme`.

## Guide

The structure is lifted from [gdal3.js](https://gdal3.js.org/docs/)'s docs: a grouped sidebar, the
article, and an "on this page" rail, with a breadcrumb eyebrow, filename-barred code blocks and
prev/next at the foot. What differs is the plumbing — pages are data rather than HTML files, and
they render through the landing's own tokens, so the theme toggle keeps working.

Adding a page is three steps:

1. Write `src/guide/pages/<slug>.js`, exporting `{ slug, title, description, lede, blocks }`.
2. Import it in `src/guide/nav.js` and drop it into the section you want it in.
3. Nothing else. The sidebar, reading order, hub cards, search index, prerendered routes and
   `dist/sitemap.xml` all derive from that array.

Blocks are plain objects: `p`, `h2` (needs an `id`, which is what the page toc lists), `h3`, `ul`,
`ol`, `code` (`{ file, code }`), `callout` (`{ tone: 'note' | 'warn', title, text }`), `table`
(`{ head, rows }`) and `cards`. Anywhere prose is accepted, three inline tokens work:
`` `code` ``, `**bold**` and `[label](/guide/x/)`.

Search is derived from those same objects at load — no crawler, no index to download, no build
step. `src/main.jsx` writes each route's `<title>`, description and canonical during prerender;
`index.html` carries only the tags that are identical on every page.

## Before this goes public

`src/data.js` opens with two markers.

`TODO(rename)` — the page is written for the **crossbind** name shipping as stable 2.0, but nothing
behind it exists yet: `crossbind.dev` is not registered, `@crossbind/*` is not published, and
`npm create crossbind` will not resolve until that publish. `REPO_URL` deliberately still points at
`crossbind/crossbind` so the GitHub link works.
The code samples keep today's public API names (`initNative`, `crossbind.config.js`) so the landing
matches the implementation. Agent guidance is distributed as the portable skill under `agents/`.

`TODO(content)` — the per-runtime timings, the init times, the "42 prebuilt libraries" count, the
community counters and the changelog came from the mock and are not corroborated in this repo. The
headline benchmark is fine: 6.75×, 0.872s and 5.886s are the project's own published figures, taken
from `website/src/pages/index.js`.

## Design source

Mock: `crossbind new design` (Claude Design project `53feab0c-a74e-41a6-8ffe-3dfed8b6d52e`), file
`index.html`. Two things in the mock deliberately did not ship: the tweaks panel, which is the
design tool's own host protocol, and the two alternate hero variants it switched between. The
mock's defaults — the code hero, the verdant palette, dark theme — are what this implements. The
fixed desktop grids became responsive, and code blocks scroll inside their own frame rather than
widening the page.
