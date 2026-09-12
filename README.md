# cpp.js.org

The js.org subdomain cpp.js.org serves this branch through GitHub Pages. cpp.js became crossbind;
this branch keeps the last cpp.js documentation online, rebuilt once from its source with an
announcement bar on every page. The bar links, on the reader's click only, to crossbind.dev, to the
same path there (its `_redirects` maps the old routes to the new pages) and to the migration guide.
js.org allows no automatic redirects away from its domain and no placeholder pages, so nothing
here redirects. The archived 1.x documentation lives at https://v1.crossbind.dev.

## How it was produced

- Source: the `website/` Docusaurus project at commit `3dbdf2e9` (16 August 2026), the commit the
  previous deployment of this branch was built from.
- Changes before building, kept in `cppjs-notice.patch`: the announcement bar in
  `docusaurus.config.js`, its size and colours in `src/css/custom.css`, and `static/notice.js`,
  which points the bar's first link at the same path on crossbind.dev when it is clicked.
- Build: `pnpm install --frozen-lockfile --filter ./website` and `pnpm run build` in `website/`,
  with Node.js 25.8 and pnpm 10, on 12 September 2026. Nothing here is rebuilt afterwards.
