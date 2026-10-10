import { CHANGELOG_PAGE } from './changelog/page.js';
import { GUIDE_PAGES, normalizePath } from './guide/nav.js';
import AGENT_PAGE from './pages/agent.js';
import API_PAGE from './pages/api.js';
import EXAMPLES_PAGE from './pages/examples.js';
import PLAYGROUND_PAGE from './pages/playground.js';
import PRIVACY_PAGE from './pages/privacy.js';
import { PORT_PAGES, PORT_PLATFORM_PAGES, PORTS_INDEX } from './ports/pages.js';

// Every prerendered page of the site in one list: the guide, the reference pages, the playground,
// the Libraries catalog with each library's platform pages, the changelog and the privacy page.
// Routing, prerendering, the sitemap, llms.txt and search all derive from it. Must stay importable
// from Node with no JSX: vite.config.js reads it.
export const SITE_PAGES = [
    GUIDE_PAGES, [API_PAGE, AGENT_PAGE, EXAMPLES_PAGE, PLAYGROUND_PAGE], [PORTS_INDEX, ...PORT_PAGES, ...PORT_PLATFORM_PAGES], [CHANGELOG_PAGE, PRIVACY_PAGE],
].flat();

export const SITE_ROUTES = SITE_PAGES.map((page) => page.href);

export function findSitePage(url) {
    const path = normalizePath(url);
    return SITE_PAGES.find((page) => page.path === path) || null;
}
