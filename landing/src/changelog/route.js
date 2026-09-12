// Route shape only; page.js builds the page on top of it and quick-start.js links to the current
// version without importing page.js (that would close an import cycle through guide/nav.js).
export const CHANGELOG_BASE = '/changelog';

export const CHANGELOG_INDEX_PATH = CHANGELOG_BASE;

// Directory-style, like the guide: /changelog/ -> changelog/index.html.
export const CHANGELOG_INDEX_HREF = `${CHANGELOG_BASE}/`;

// The changelog is one page; a version is a section on it.
export const changelogHref = (version) => `${CHANGELOG_INDEX_HREF}#${version}`;
