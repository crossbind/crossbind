import { useCallback, useState } from 'react';
import Nav from './components/Nav.jsx';
import ChangelogPage from './changelog/ChangelogPage.jsx';
import Guide from './guide/Guide.jsx';
import ExamplesPage from './pages/ExamplesPage.jsx';
import LibrariesPage from './ports/LibrariesPage.jsx';
import PortPage from './ports/PortPage.jsx';
import Search from './guide/Search.jsx';
import Closing from './sections/Closing.jsx';
import Features from './sections/Features.jsx';
import Hero from './sections/Hero.jsx';
import Scaffolder from './sections/Scaffolder.jsx';
import Showcase from './sections/Showcase.jsx';
import { findSitePage } from './site-pages.js';
import { resolveTokens, useTheme } from './theme.js';

// Routing is one lookup. Every guide URL is prerendered to its own HTML file, so links stay
// plain <a href> and the browser does the navigation - no router, no history handling, and a
// crawler (or a JS-less visitor) sees the finished page.
//
// `url` is passed by the prerenderer, which has no DOM; the browser falls back to its location.
function currentPath(url) {
    if (url) return url;
    return typeof location === 'undefined' ? '/' : location.pathname;
}

// Libraries and Examples are pages of their own; everything else that is not the landing renders
// in the guide shell.
function Page({ tokens, page }) {
    if (page.kind === 'ports-index') return <LibrariesPage tokens={tokens} page={page} />;
    if (page.kind === 'port') return <PortPage tokens={tokens} page={page} />;
    if (page.kind === 'examples') return <ExamplesPage tokens={tokens} page={page} />;
    if (page.kind === 'changelog') return <ChangelogPage tokens={tokens} page={page} />;
    return <Guide tokens={tokens} page={page} />;
}

export default function App({ url }) {
    const [theme, toggleTheme] = useTheme();
    const [searchOpen, setSearchOpen] = useState(false);
    const tokens = resolveTokens(theme);
    const path = currentPath(url);
    const page = findSitePage(path);

    const openSearch = useCallback(() => setSearchOpen(true), []);
    const closeSearch = useCallback(() => setSearchOpen(false), []);

    return (
        <div
            style={{
                background: tokens.bgGrad,
                color: tokens.text,
                fontFamily: tokens.sans,
                minHeight: '100vh',
            }}
        >
            <a href="#content" className="skip-link tap-target">
                Skip to content
            </a>
            <Nav tokens={tokens} path={path} onToggleTheme={toggleTheme} onOpenSearch={openSearch} />
            {page ? (
                <Page tokens={tokens} page={page} />
            ) : (
                <main id="content">
                    <Hero tokens={tokens} />
                    <Scaffolder tokens={tokens} />
                    <Features tokens={tokens} />
                    <Showcase tokens={tokens} />
                </main>
            )}
            <Closing tokens={tokens} />
            <Search tokens={tokens} open={searchOpen} onOpen={openSearch} onClose={closeSearch} />
        </div>
    );
}
