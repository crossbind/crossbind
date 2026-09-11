import { useCallback, useState } from 'react';
import Nav from './components/Nav.jsx';
import Guide from './guide/Guide.jsx';
import { findGuidePage } from './guide/nav.js';
import Search from './guide/Search.jsx';
import Closing from './sections/Closing.jsx';
import Features from './sections/Features.jsx';
import Hero from './sections/Hero.jsx';
import Scaffolder from './sections/Scaffolder.jsx';
import Showcase from './sections/Showcase.jsx';
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

export default function App({ url }) {
    const [theme, toggleTheme] = useTheme();
    const [searchOpen, setSearchOpen] = useState(false);
    const tokens = resolveTokens(theme);
    const page = findGuidePage(currentPath(url));

    const openSearch = useCallback(() => setSearchOpen(true), []);
    const closeSearch = useCallback(() => setSearchOpen(false), []);

    return (
        <div style={{
            background: tokens.bgGrad,
            color: tokens.text,
            fontFamily: tokens.sans,
            minHeight: '100vh',
        }}
        >
            <a href="#content" className="skip-link tap-target">Skip to content</a>
            <Nav tokens={tokens} onToggleTheme={toggleTheme} onOpenSearch={openSearch} />
            {page ? <Guide tokens={tokens} page={page} /> : (
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
