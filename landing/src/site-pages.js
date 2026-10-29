import { CHANGELOG_PAGE } from './changelog/page.js';
import { GUIDE_PAGES, normalizePath } from './guide/nav.js';
import AGENT_PAGE from './pages/agent.js';
import EXAMPLES_PAGE from './pages/examples.js';
import LICENSE_PAGE from './pages/license.js';
import PLAYGROUND_PAGE from './pages/playground.js';
import PRIVACY_PAGE from './pages/privacy.js';
import TERMS_PAGE from './pages/terms.js';
import { TUTORIAL_PAGES } from './pages/tutorial.js';
import { PORT_PAGES, PORTS_INDEX } from './ports/pages.js';

// Every prerendered page of the site in one list: the guide, agent setup, the examples, the playground,
// the tutorial's steps, the Libraries catalog and each library's page, the changelog, the privacy
// page, the terms and the license. Routing, prerendering, the sitemap, llms.txt and search all derive from it.
// Must stay importable from Node with no JSX: vite.config.js reads it.
export const SITE_PAGES = [
    GUIDE_PAGES, [AGENT_PAGE, EXAMPLES_PAGE, PLAYGROUND_PAGE], TUTORIAL_PAGES, [PORTS_INDEX, ...PORT_PAGES], [CHANGELOG_PAGE, PRIVACY_PAGE, TERMS_PAGE, LICENSE_PAGE],
].flat();

export const SITE_ROUTES = SITE_PAGES.map((page) => page.href);

export function findSitePage(url) {
    const path = normalizePath(url);
    return SITE_PAGES.find((page) => page.path === path) || null;
}
