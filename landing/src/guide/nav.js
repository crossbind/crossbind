import { AGENT_URL } from '../data.js';
import apps from './pages/apps.js';
import architecture from './pages/architecture.js';
import assets from './pages/assets.js';
import bindings from './pages/bindings.js';
import browser from './pages/browser.js';
import cli from './pages/cli.js';
import conan from './pages/conan.js';
import configuration from './pages/configuration.js';
import cratesIo from './pages/crates-io.js';
import edge from './pages/edge.js';
import electron from './pages/electron.js';
import executables from './pages/executables.js';
import filesystem from './pages/filesystem.js';
import introduction from './pages/introduction.js';
import libraries from './pages/libraries.js';
import migration from './pages/migration.js';
import node from './pages/node.js';
import performance from './pages/performance.js';
import publishing from './pages/publishing.js';
import quickStart from './pages/quick-start.js';
import reactNative from './pages/react-native.js';
import remoteBuilds from './pages/remote-builds.js';
import runtimeApi from './pages/runtime-api.js';
import rust from './pages/rust.js';
import threading from './pages/threading.js';
import troubleshooting from './pages/troubleshooting.js';

// The guide's one source of order. Sidebar grouping, reading order (prev/next), the search index,
// the prerender route list and the sitemap all derive from the array below, so a new page is one
// import plus one entry - nothing else can drift out of sync.
//
// This file must stay importable from Node with no JSX and no CSS: vite.config.js reads it to
// emit the sitemap.

export const GUIDE_BASE = '/guide';

// Directory-style URLs, matching what the static host serves: /guide/quick-start/ -> the
// prerendered guide/quick-start/index.html.
export const guideHref = (slug = '') => (slug ? `${GUIDE_BASE}/${slug}/` : `${GUIDE_BASE}/`);

// A section's links are sidebar entries for pages that live outside /guide/.
const SECTIONS = [
    { label: 'Get started', pages: [introduction, quickStart], links: [{ title: 'Agent setup', href: AGENT_URL }] },
    { label: 'Native code', pages: [bindings, rust, libraries, cratesIo, conan] },
    { label: 'Platforms', pages: [browser, node, edge, electron, apps, reactNative, executables] },
    { label: 'Runtime', pages: [filesystem, assets, threading] },
    { label: 'Build', pages: [architecture, performance, remoteBuilds, publishing] },
    { label: 'Reference', pages: [configuration, runtimeApi, cli, troubleshooting, migration] },
];

const withRoute = (page, section) => ({
    ...page,
    section,
    path: page.slug ? `${GUIDE_BASE}/${page.slug}` : GUIDE_BASE,
    href: guideHref(page.slug),
});

export const GUIDE_SECTIONS = SECTIONS.map((section) => ({
    label: section.label,
    pages: section.pages.map((page) => withRoute(page, section.label)),
    links: section.links ?? [],
}));

export const GUIDE_PAGES = GUIDE_SECTIONS.flatMap((section) => section.pages);

export const GUIDE_ROUTES = GUIDE_PAGES.map((page) => page.href);

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
