import { hydrate, render } from 'preact';
import { StrictMode } from 'react';
// Self-hosted: fonts.gstatic.com intermittently 404s the Geist woff2, which drops the page to a
// system font and shifts the layout.
import './fonts.css';
import App from './App.jsx';
import { BRAND, SITE, SITE_DESCRIPTION, SITE_TITLE } from './data.js';
import { findSitePage, SITE_ROUTES } from './site-pages.js';
import './styles.css';

const tree = (url) => (
    <StrictMode>
        <App url={url} />
    </StrictMode>
);

// This module is also imported by the prerender step, which runs in Node with no DOM.
if (typeof document !== 'undefined') {
    const root = document.getElementById('root');
    // The build bakes markup into index.html, so attach to it rather than replace it.
    // The dev server has no prerendered output, hence the fallback.
    if (root.firstChild) {
        hydrate(tree(), root);
    } else {
        render(tree(), root);
    }
}

// Per-route <head>. These tags are deliberately absent from index.html: every page needs its own
// title, description and canonical, and a template copy would duplicate itself onto all sixteen.
// The constants that never vary (og:image, og:type, twitter:card, theme-color) stay in the
// template. index.html's <title> is the dev-server fallback and mirrors SITE_TITLE.
function headFor(page) {
    const url = SITE + (page ? page.href : '/');
    const title = page ? `${page.title} · ${BRAND}` : SITE_TITLE;
    const description = page ? page.description : SITE_DESCRIPTION;

    return {
        title,
        elements: new Set([
            { type: 'meta', props: { name: 'description', content: description } },
            { type: 'link', props: { rel: 'canonical', href: url } },
            { type: 'meta', props: { property: 'og:title', content: title } },
            { type: 'meta', props: { property: 'og:description', content: description } },
            { type: 'meta', props: { property: 'og:url', content: url } },
            { type: 'meta', props: { name: 'twitter:title', content: title } },
            { type: 'meta', props: { name: 'twitter:description', content: description } },
        ]),
    };
}

export async function prerender(data) {
    const { default: renderToString } = await import('preact-render-to-string');
    const url = data?.url || '/';

    return {
        html: renderToString(tree(url)),
        // Queues every page of the site for prerendering; already-rendered routes are skipped.
        links: new Set(SITE_ROUTES),
        head: headFor(findSitePage(url)),
    };
}
