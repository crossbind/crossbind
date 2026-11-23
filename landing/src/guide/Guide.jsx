import { Fragment, useEffect, useRef, useState } from 'react';
import { Chevron } from '../components/menu.jsx';
import PrevNext from '../components/PrevNext.jsx';
import { SideHeading, SideLink } from '../components/side.jsx';
import Article from './Article.jsx';
import { inline } from '../../../tooling/learn/src/inline.jsx';
import { getNeighbours, GUIDE_SECTIONS } from './nav.js';

// The doc shell: gdal3.js's three-column layout - grouped sidebar, article, "on this page" -
// rebuilt on this site's tokens so the theme toggle keeps working. The grid columns and every
// breakpoint live in styles.css, because an inline style cannot carry a media query.

// A link to a page outside /guide/ is active on that page and everything under it.
const isUnder = (path, href) => {
    const prefix = href.replace(/\/$/, '');
    return path === prefix || path.startsWith(`${prefix}/`);
};

// A heading counts as current once it is in the top band of the viewport.
const SPY_MARGIN = '-15% 0px -70% 0px';

function useActiveHeading(headings) {
    const [active, setActive] = useState('');
    const ids = headings.map((heading) => heading.id).join(',');

    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined' || !ids) return undefined;
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) setActive(entry.target.id);
                });
            },
            { rootMargin: SPY_MARGIN },
        );
        ids.split(',').forEach((id) => {
            const el = document.getElementById(id);
            if (el) observer.observe(el);
        });
        return () => observer.disconnect();
    }, [ids]);

    return active;
}

// Scrolls the sidebar itself, never the window, so an anchor jump stays where it landed.
function useCurrentInView(ref, path) {
    useEffect(() => {
        const side = ref.current;
        const current = side?.querySelector('[aria-current="page"]');
        if (!current) return;
        const hidden = current.offsetTop < side.scrollTop || current.offsetTop + current.offsetHeight > side.scrollTop + side.clientHeight;
        if (hidden) side.scrollTop = current.offsetTop - side.clientHeight / 2;
    }, [ref, path]);
}

function Sidebar({ tokens, page, open }) {
    const ref = useRef(null);
    useCurrentInView(ref, page.path);
    return (
        <aside ref={ref} id="guide-menu" className="doc-side" data-open={open ? 'true' : 'false'} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {GUIDE_SECTIONS.map((section) => (
                <Fragment key={section.label}>
                    <SideHeading tokens={tokens}>{section.label}</SideHeading>
                    {section.pages.map((item) => (
                        <SideLink key={item.path} tokens={tokens} href={item.href} label={item.title} active={item.path === page.path} />
                    ))}
                    {section.links.map((link) => (
                        <SideLink key={link.href} tokens={tokens} href={link.href} label={link.title} active={isUnder(page.path, link.href)} />
                    ))}
                </Fragment>
            ))}
        </aside>
    );
}

function Toc({ tokens, headings, active }) {
    if (headings.length === 0) return null;
    return (
        <aside className="doc-toc" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <SideHeading tokens={tokens}>On this page</SideHeading>
            {headings.map((heading) => (
                <SideLink key={heading.id} tokens={tokens} href={`#${heading.id}`} label={heading.text} active={heading.id === active} current="location" />
            ))}
        </aside>
    );
}

export default function Guide({ tokens, page }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const headings = page.blocks.filter((block) => block.type === 'h2' && block.id);
    const active = useActiveHeading(headings);

    return (
        <div className="doc-grid" style={{ padding: '32px var(--content-x) 80px' }}>
            <button
                type="button"
                className="doc-menu-btn tap-target"
                onClick={() => setMenuOpen((current) => !current)}
                aria-expanded={menuOpen}
                aria-controls="guide-menu"
                aria-label={`Guide menu, ${page.title}`}
                style={{
                    display: 'none',
                    alignItems: 'center',
                    background: tokens.pillBg,
                    border: `1px solid ${tokens.borderStrong}`,
                    color: tokens.text,
                    borderRadius: 8,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginBottom: 4,
                }}
            >
                Guide
                <span style={{ display: 'inline-flex', marginLeft: 8, transition: 'transform 0.15s', transform: menuOpen ? 'rotate(180deg)' : 'none' }}>
                    <Chevron />
                </span>
            </button>

            <Sidebar tokens={tokens} page={page} open={menuOpen} />

            <main id="content" className="doc-main">
                <h1
                    style={{
                        fontSize: 'clamp(30px, 4.5vw, 44px)',
                        fontWeight: 600,
                        letterSpacing: -1.5,
                        lineHeight: 1.1,
                        margin: '0 0 14px',
                        color: tokens.text,
                    }}
                >
                    {page.title}
                </h1>

                <p style={{ fontSize: 16.5, lineHeight: 1.65, color: tokens.textDim, margin: '0 0 34px' }}>{inline(page.lede, tokens)}</p>

                <Article tokens={tokens} blocks={page.blocks} />
                <PrevNext tokens={tokens} label="Guide pages" {...getNeighbours(page)} />
            </main>

            <Toc tokens={tokens} headings={headings} active={active} />
        </div>
    );
}
