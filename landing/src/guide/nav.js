import { AGENT_URL, API_URL, REPO_URL } from '../data.js';
import architecture from './pages/architecture.js';
import assets from './pages/assets.js';
import bindings from './pages/bindings.js';
import bundlers from './pages/bundlers.js';
import configuration from './pages/configuration.js';
import filesystem from './pages/filesystem.js';
import home from './pages/index.js';
import introduction from './pages/introduction.js';
import libraries from './pages/libraries.js';
import migration from './pages/migration.js';
import quickStart from './pages/quick-start.js';
import runtimes from './pages/runtimes.js';
import rust from './pages/rust.js';
import threading from './pages/threading.js';
import troubleshooting from './pages/troubleshooting.js';
import wasi from './pages/wasi.js';

// The guide's one source of order. Sidebar grouping, reading order (prev/next), the hub cards,
// the search index, the prerender route list and the sitemap all derive from the array below, so
// a new page is one import plus one entry - nothing else can drift out of sync.
//
// This file must stay importable from Node with no JSX and no CSS: vite.config.js reads it to
// emit the sitemap.

export const GUIDE_BASE = '/guide';

// Directory-style URLs, matching what the static host serves: /guide/quick-start/ -> the
// prerendered guide/quick-start/index.html.
export const guideHref = (slug = '') => (slug ? `${GUIDE_BASE}/${slug}/` : `${GUIDE_BASE}/`);

const SECTIONS = [
    { label: 'Getting started', pages: [introduction, quickStart, bundlers, runtimes] },
    { label: 'Concepts', pages: [architecture, bindings, rust, libraries, filesystem, threading, assets, wasi, configuration] },
    { label: 'Help', pages: [troubleshooting, migration] },
];

const withRoute = (page, section) => ({
    ...page,
    section,
    path: `${GUIDE_BASE}/${page.slug}`,
    href: guideHref(page.slug),
});

export const GUIDE_SECTIONS = SECTIONS.map((section) => ({
    label: section.label,
    pages: section.pages.map((page) => withRoute(page, section.label)),
}));

// The hub is the same shape as any other page; its body is generated so the cards cannot fall
// behind the sidebar.
export const GUIDE_HOME = {
    ...home,
    section: '',
    path: GUIDE_BASE,
    href: guideHref(),
    blocks: GUIDE_SECTIONS.flatMap((section) => [
        { type: 'h2', id: section.label.toLowerCase().replace(/\s+/g, '-'), text: section.label },
        {
            type: 'cards',
            items: section.pages.map((page) => ({
                kicker: page.kicker || section.label.toUpperCase(),
                title: page.title,
                desc: page.description,
                href: page.href,
            })),
        },
    ]),
};

export const GUIDE_PAGES = [GUIDE_HOME, ...GUIDE_SECTIONS.flatMap((section) => section.pages)];

export const GUIDE_ROUTES = GUIDE_PAGES.map((page) => page.href);

// Reference pages the guide deliberately does not duplicate. The changelog is not here: it is
// linked from Guide.jsx with the active state a section link gets.
export const GUIDE_EXTERNAL_LINKS = [
    { label: 'API reference', href: API_URL },
    { label: 'Agent setup', href: AGENT_URL },
    { label: 'GitHub', href: REPO_URL, external: true },
];

// Both '/guide/quick-start/' (what the browser shows) and '/guide/quick-start' (what the
// prerenderer passes) have to resolve to the same page.
export function normalizePath(url = '/') {
    const path = String(url).split('?')[0].split('#')[0];
    const trimmed = path.replace(/\/+$/, '');
    return trimmed || '/';
}

export function findGuidePage(url) {
    const path = normalizePath(url);
    return GUIDE_PAGES.find((page) => page.path === path) || null;
}

export function getNeighbours(page) {
    const index = GUIDE_PAGES.findIndex((candidate) => candidate.path === page.path);
    return {
        prev: index > 0 ? GUIDE_PAGES[index - 1] : null,
        next: index >= 0 && index < GUIDE_PAGES.length - 1 ? GUIDE_PAGES[index + 1] : null,
    };
}
