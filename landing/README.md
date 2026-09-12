# @crossbind/landing

The crossbind.dev site: the landing page, the `/guide/` docs, the `/api/` and `/agent/` reference
pages, the `/ports/` library catalog, `/examples/` and the `/changelog/`. Plain Vite + React, no
router and no CMS: the landing is one page built from a [Claude Design](https://claude.ai/design)
mock, and every other page is prerendered to its own static HTML file, so links are plain
`<a href>` and the browser does the navigating.

```bash
pnpm --filter @crossbind/landing dev      # http://localhost:5173
pnpm --filter @crossbind/landing build    # → landing/dist
pnpm --filter @crossbind/landing preview
pnpm --filter @crossbind/landing demos    # build the /examples/ live demos from the published packages
pnpm --filter @crossbind/landing check:deploy   # everything deploy does except the upload
pnpm --filter @crossbind/landing deploy   # build, verify the release snapshot and demos, wrangler pages deploy
```

This is separate from `website/`, which is the Docusaurus documentation site and stays as it is.

## Release snapshot

The navbar version menu, the `/changelog/` page, the Quick Start install commands and the `/ports/`
catalog are generated from one verified release snapshot, so they cannot disagree. `dev` and
`build` run `scripts/site/prepare-site.mjs` first, which resolves the release through
`scripts/release/resolve-site-release.mjs`:

1. reads the npm channel from `release.config.js` (`beta` → npm `beta`, `rc` → `next`,
   `stable` → `latest`) and resolves it to one exact `crossbind` version;
2. lists the repository's GitHub Releases, keeps the published `crossbind@*` ones that carry a
   `crossbind-release.json` manifest (the current version must be among them), and for each
   validates the manifest against `releases/crossbind/manifest.schema.json` and checks the
   registry integrity, the tag's commit and the GitHub prerelease flag against it;
3. reads each release note and toolchain digest table at the manifest's commit, checks the
   note's frontmatter and the table's SHA-256, and converts the note into the guide's block model
   (`scripts/release/release-notes-blocks.mjs` - headings, paragraphs, lists, fenced code, pipe
   tables and quotes; images, HTML and other heading levels fail the build);
4. resolves `@crossbind/plugin-vite` and `create-crossbind` through the same dist-tag and checks
   that the plugin's `crossbind` range admits the resolved version - each package keeps its own
   version, nothing is copied across;
5. builds the Libraries catalog (`scripts/site/build-ports-catalog.mjs`) from `ports/catalog.json`,
   every port's `package.json` and `build.mjs`, and what npm serves for each variant on the same
   dist-tag - a variant counts as published only when the registry has it;
6. writes `generated/release-snapshot.js` and `generated/ports-catalog.js`, which `src/release.js`
   and `src/ports/catalog.js` re-export to the site, and starts `vite` with a one-off build token
   that `vite.config.js` checks, so a bare `vite build` cannot reuse files left behind by an
   earlier run.

`/changelog/` is one page: the repository's `CHANGELOG.md`, converted section by section, with a
release row (channel, date, npm and GitHub links) under every version the snapshot verified, so
`/changelog/#<version>` links survive the channel moving on. The build refuses a `CHANGELOG.md`
whose generated region is out of date with `releases/crossbind/` (`pnpm changelog` renders it) and
a release note in the tree that differs from the one published. GitHub's generic "latest release" endpoint is never
used, so other release streams in the repository cannot leak in, and nothing falls back: a missing
or inconsistent piece of metadata fails the build. That means a build needs the network, the
`npm` CLI and `gh` with credentials (`gh auth login` on a laptop, `GH_TOKEN` in CI). To inspect
what a channel resolves to without building:

```bash
node scripts/release/resolve-site-release.mjs --channel beta
```

For offline work, point `CROSSBIND_SITE_RELEASE_FIXTURE` at a fixture file:

```bash
CROSSBIND_SITE_RELEASE_FIXTURE=../scripts/release/test/fixtures/site-release/beta.json \
    pnpm --filter @crossbind/landing dev
```

A fixture build is marked `source: "fixture"` in `dist/release-snapshot.json`, and `deploy` refuses
it (`scripts/release/check-site-snapshot.mjs`), so it cannot reach crossbind.dev by accident. The
release-infrastructure CI job builds the site from that fixture and checks that the gate refuses it.

The site does not redeploy itself. After an npm release train has published `crossbind`, run
`pnpm --filter @crossbind/landing deploy` once; the build resolves the new version. To move the
site from beta to stable, change `channel` in `release.config.js` and deploy - that is the only
switch, and it is deliberately not automatic.

## Layout

| Path | What lives there |
| --- | --- |
| `release.config.js` | The npm channel the site is built from |
| `src/release.js` | The verified release snapshot every version-dependent surface reads |
| `src/data.js` | Every piece of copy, every figure, every outbound URL |
| `src/site-pages.js` | Every page of the site in one list: routing, prerender, sitemap, llms.txt and search derive from it |
| `src/pages/` | `/api/` and `/agent/` as page objects rendered in the guide shell; `/examples/` as a page object plus its own `ExamplesPage.jsx` |
| `src/demos.js` | The live demos manifest (`generated/example-demos.js`), keyed by example id |
| `src/ports/` | `/ports/` and `/ports/<name>/` from the generated catalog, each with its own page component (`LibrariesPage.jsx`, `PortPage.jsx`) |
| `src/changelog/` | `/changelog/`: the page object built from `generated/changelog.js`, its own `ChangelogPage.jsx` with a version rail, the anchor helper and the release row; reached from the navbar's version menu, not the docs sidebar |
| `src/why.js` | The "why" bullets and the limits, shared by the introduction and llms.txt |
| `src/llms.js` | Renders `/llms.txt` at build time from the snapshot, the catalog and the page list |
| `public/_redirects` | 301s for the retired Docusaurus routes; checked by `scripts/site/check-site-links.mjs` |
| `src/theme.js` | Palettes, the light/dark token tables, and the persisted theme hook |
| `src/components/` | `Nav` and its `VersionMenu` (version, channel, changelog, GitHub and npm links), the `PlatformGlyph` SVG set, and the shared `ui.jsx` primitives |
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

`/examples/` lists only examples that were run end to end from the published packages; the
navbar shows Examples while `EXAMPLES_URL` in `src/data.js` is set. After a build,
`node scripts/site/check-site-links.mjs` verifies every internal link and anchor, the redirect
targets and the required routes; CI runs it on the fixture build.

## Live demos

The web examples run inside the page. `pnpm --filter @crossbind/landing demos`
(`scripts/site/build-example-demos.mjs`) scaffolds each web template with `npm create crossbind`
on the site's channel, installs it from the registry, builds it and copies the output to
`public/examples/<id>/`, rewritten to load from that subpath, then opens every one in Chromium and
checks the on-screen C++ result before writing `public/examples/demos.json`. Both are gitignored.
`prepare-site.mjs` turns the manifest into `generated/example-demos.js`; the page shows a frame for
a demo that is present and nothing for one that is not, so a fixture or CI build has no frames.
Add `-- --only web-vanilla,web-react-rspack` to rebuild some of them.
In `dev`, a small middleware in `vite.config.js` maps `/examples/<id>/` to that directory's
`index.html`, which Vite's public-file serving does not do by itself; the static build needs nothing.

The deploy gate reads `dist/examples/demos.json` and refuses to deploy unless every demo is present
and was built with the crossbind version the site resolved. Run `demos` once per release, before
`deploy`; needs Docker and the Playwright browsers from `e2e/web-vite`.

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

`TODO(rename)` — the page is written for the **crossbind** name shipping as stable 2.0. `@crossbind/*`
ships on the npm `beta` tag today, which is why every install command carries the channel suffix
from the release snapshot; a bare `npm create crossbind` is only right once a stable train has moved
`latest`. `REPO_URL` deliberately still points at
`crossbind/crossbind` so the GitHub link works.
The code samples keep today's public API names (`initNative`, `crossbind.config.js`) so the landing
matches the implementation. Agent guidance is distributed as the portable skill under `agents/`.

`TODO(content)` — the per-runtime timings, the init times, the "42 prebuilt libraries" count, the
community counters came from the mock and are not corroborated in this repo. The
headline benchmark is fine: 6.75×, 0.872s and 5.886s are the project's own published figures, taken
from `website/src/pages/index.js`.

## Design source

Mock: `crossbind new design` (Claude Design project `53feab0c-a74e-41a6-8ffe-3dfed8b6d52e`), file
`index.html`. Two things in the mock deliberately did not ship: the tweaks panel, which is the
design tool's own host protocol, and the two alternate hero variants it switched between. The
mock's defaults — the code hero, the verdant palette, dark theme — are what this implements. The
fixed desktop grids became responsive, and code blocks scroll inside their own frame rather than
widening the page.
