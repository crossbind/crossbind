# cpp.js 1.x documentation, frozen

This branch holds the built documentation site of cpp.js 1.x, the previous name of crossbind,
as it last stood under that name. It is served as a static archive at v1.crossbind.dev; the
current documentation is at https://crossbind.dev/ and the migration guide at
https://crossbind.dev/guide/migration/.

Do not rebuild or edit the pages here. The archive is frozen on purpose; a change to the current
site belongs in `landing/` on `main`.

## How it was produced

- Source: the `website/` Docusaurus project at commit `549beaac` (19 January 2025), five commits
  after tag `cpp.js@1.0.4` and the last change to the site under the cpp.js name: the changelog
  pages brought up to 1.0.4 and Docusaurus 3.7.
- Changes before building, kept in `v1-archive.patch`: the site URL set to `https://v1.crossbind.dev`,
  a non-closable amber announcement bar naming the archive and linking to the current docs and the
  migration guide (its size and colours come from a few lines appended to `src/css/custom.css`),
  and a `robots: noindex` meta tag on every page so search engines rank the current site instead.
- Build: `pnpm install --no-frozen-lockfile --filter ./website` (the lockfile at that commit was stale
  for one sample package, which the website does not use) and `pnpm run build` in `website/`, with
  Node.js 25.8 and pnpm 10, on 12 September 2026.
- `static/CNAME` (cpp.js.org) is not included; hosting is configured on the Pages project, not here.

## Hosting

Static files at the root of this branch, no build step. `_headers` adds `X-Robots-Tag: noindex`
for non-HTML responses. cpp.js.org is a js.org subdomain and may not redirect automatically; it
keeps the last cpp.js documentation online with a notice that links here and to crossbind.dev.
