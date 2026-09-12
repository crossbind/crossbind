import { Fragment, useEffect, useState } from 'react';
import Article from './Article.jsx';
import { inline } from './inline.jsx';
import { getNeighbours, GUIDE_EXTERNAL_LINKS, GUIDE_HOME, GUIDE_SECTIONS } from './nav.js';

// The doc shell: gdal3.js's three-column layout - grouped sidebar, article, "on this page" -
// rebuilt on this site's tokens so the theme toggle keeps working. The grid columns and every
// breakpoint live in styles.css, because an inline style cannot carry a media query.

// A section link is active for its index and everything under it, e.g. /ports/gdal under /ports/.
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

function SideLink({ tokens, href, label, active, external }) {
    return (
        <a
            href={href}
            className="tap-target"
            target={external ? '_blank' : undefined}
            rel={external ? 'noreferrer' : undefined}
            style={{
                fontSize: 13,
                lineHeight: 1.5,
                padding: '3px 0 3px 10px',
                marginLeft: -12,
                borderLeft: `2px solid ${active ? tokens.accentText : 'transparent'}`,
                color: active ? tokens.text : tokens.textDim,
            }}
        >
            {label}
            {external ? ' ↗' : ''}
        </a>
    );
}

function SideHeading({ tokens, children }) {
    return (
        <div
            style={{
                fontFamily: tokens.mono,
                fontSize: 10.5,
                letterSpacing: 1.5,
                color: tokens.textMuted,
                margin: '18px 0 6px',
            }}
        >
            {children.toUpperCase()}
        </div>
    );
}

function Sidebar({ tokens, page, open }) {
    return (
        <aside className="doc-side" data-open={open ? 'true' : 'false'} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <SideLink tokens={tokens} href={GUIDE_HOME.href} label="All guides" active={page.path === GUIDE_HOME.path} />
            {GUIDE_SECTIONS.map((section) => (
                <Fragment key={section.label}>
                    <SideHeading tokens={tokens}>{section.label}</SideHeading>
                    {section.pages.map((item) => (
                        <SideLink key={item.path} tokens={tokens} href={item.href} label={item.title} active={item.path === page.path} />
                    ))}
                </Fragment>
            ))}
            <SideHeading tokens={tokens}>More</SideHeading>
            {GUIDE_EXTERNAL_LINKS.map((link) => (
                <SideLink
                    key={link.href}
                    tokens={tokens}
                    href={link.href}
                    label={link.label}
                    external={link.external}
                    active={isUnder(page.path, link.href)}
                />
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
                <SideLink key={heading.id} tokens={tokens} href={`#${heading.id}`} label={heading.text} active={heading.id === active} />
            ))}
        </aside>
    );
}

function PrevNext({ tokens, page }) {
    const { prev, next } = getNeighbours(page);
    // Reference pages sit outside the reading order.
    if (!prev && !next) return null;
    const label = {
        fontFamily: tokens.mono,
        fontSize: 10,
        letterSpacing: 1.2,
        color: tokens.textMuted,
        display: 'block',
        marginBottom: 4,
    };

    return (
        <nav
            aria-label="Guide pages"
            style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 14,
                marginTop: 52,
                paddingTop: 20,
                borderTop: `1px solid ${tokens.border}`,
                fontSize: 13.5,
            }}
        >
            {prev ? (
                <a href={prev.href} className="tap-target" style={{ color: tokens.textDim, display: 'block' }}>
                    <span style={label}>← PREV</span>
                    {prev.title}
                </a>
            ) : (
                <span />
            )}
            {next ? (
                <a href={next.href} className="tap-target" style={{ color: tokens.accentText, display: 'block', textAlign: 'right' }}>
                    <span style={label}>NEXT →</span>
                    {next.title}
                </a>
            ) : (
                <span />
            )}
        </nav>
    );
}

export default function Guide({ tokens, page }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const headings = page.blocks.filter((block) => block.type === 'h2' && block.id);
    const active = useActiveHeading(headings);
    // Pages outside the guide bring their own eyebrow; guide breadcrumbs are shouted.
    const eyebrow = page.eyebrow ?? {
        head: `GUIDE · ${page.section || 'INDEX'}`.toUpperCase(),
        tail: page.section ? ` · ${page.title.toUpperCase()}` : '',
    };

    return (
        <div className="doc-grid" style={{ padding: '32px var(--content-x) 80px' }}>
            <button
                type="button"
                className="doc-menu-btn tap-target"
                onClick={() => setMenuOpen((current) => !current)}
                aria-expanded={menuOpen}
                style={{
                    display: 'none',
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
                {menuOpen ? 'Hide guide menu' : 'Guide menu'}
            </button>

            <Sidebar tokens={tokens} page={page} open={menuOpen} />

            <main id="content" className="doc-main">
                <div style={{ fontFamily: tokens.mono, fontSize: 11, letterSpacing: 1.5, color: tokens.textMuted, marginBottom: 14 }}>
                    {eyebrow.head}
                    {eyebrow.tail ? <span style={{ color: tokens.accentText }}>{eyebrow.tail}</span> : null}
                </div>

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
                <PrevNext tokens={tokens} page={page} />
            </main>

            <Toc tokens={tokens} headings={headings} active={active} />
        </div>
    );
}
