import changelog from '../../generated/changelog.js';
import { normalizePath } from '../guide/nav.js';
import { RELEASE } from '../release.js';
import { CHANGELOG_INDEX_HREF, CHANGELOG_INDEX_PATH } from './route.js';

// The changelog is CHANGELOG.md rendered as one page of its own, newest release first
// (scripts/site/prepare-site.mjs converts it and checks it against the notes). A version that is in
// the verified snapshot gets its release row - channel, date, npm and GitHub links - under its
// heading; the rest are entries from before the release manifest, shown as written.
//
// This module must stay importable from Node with no JSX: vite.config.js reads it for the sitemap.

const verified = new Map(RELEASE.history.map((entry) => [entry.version, entry]));

export const CHANGELOG_PAGE = {
    kind: 'changelog',
    slug: '',
    title: 'Changelog',
    description: 'Every crossbind release on one page, newest first. Released versions carry their verified npm and GitHub links.',
    lede: 'Newest first. A release row under a version means that release was verified against npm and its GitHub Release at the exact commit that shipped, and the notes are the ones published with it.',
    section: 'Changelog',
    path: CHANGELOG_INDEX_PATH,
    href: CHANGELOG_INDEX_HREF,
    blocks: changelog.sections.flatMap((section) => [
        { type: 'h2', id: section.version, text: `v${section.version}` },
        ...(verified.has(section.version) ? [{ type: 'release', release: verified.get(section.version) }] : []),
        ...section.blocks,
    ]),
};

export const CHANGELOG_ROUTES = [CHANGELOG_PAGE.href];

export function findChangelogPage(url) {
    return normalizePath(url) === CHANGELOG_PAGE.path ? CHANGELOG_PAGE : null;
}
