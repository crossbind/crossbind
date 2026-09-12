import { useState } from 'react';
import { AGENT_URL, BRAND, EXAMPLES_URL, LIBRARIES_URL, REPO_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';
import Logo from './Logo.jsx';
import VersionMenu from './VersionMenu.jsx';

// The primary items, in order. Examples only joins once three examples are proof-complete
// (see data.js EXAMPLES_URL); Why has no entry on purpose, it lives in the docs and README.
const LINKS = [
    { id: 'docs', label: 'Docs', href: guideHref(), prefix: '/guide' },
    { id: 'libraries', label: 'Libraries', href: LIBRARIES_URL, prefix: '/ports' },
    ...(EXAMPLES_URL ? [{ id: 'examples', label: 'Examples', href: EXAMPLES_URL, prefix: '/examples' }] : []),
];

// Agent setup is deliberately not here: it is a site page (/agent/), reachable from the hero,
// the footer and the guide sidebar, and the navbar never links straight into a GitHub blob.
void AGENT_URL;

function GitHubMark() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
    );
}

function ThemeIcon({ isLight }) {
    if (isLight) {
        return (
            <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
        );
    }
    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
    );
}

function SearchIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
        </svg>
    );
}

function MenuIcon({ open }) {
    if (open) {
        return (
            <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
            >
                <path d="M6 6l12 12M18 6L6 18" />
            </svg>
        );
    }
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
    );
}

// The search, theme and menu controls are the same 32px square; shared so they cannot drift apart.
const iconButton = (tokens) => ({
    background: tokens.panel,
    border: `1px solid ${tokens.border}`,
    color: tokens.textDim,
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
    padding: 0,
});

const isUnder = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

export default function Nav({ tokens, path = '/', onToggleTheme, onOpenSearch }) {
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <header
            style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                rowGap: 12,
                padding: 'var(--nav-y) var(--content-x)',
                fontFamily: tokens.sans,
                color: tokens.text,
                position: 'sticky',
                top: 0,
                zIndex: 5,
                background: tokens.navBg,
                backdropFilter: 'blur(20px)',
                borderBottom: `1px solid ${tokens.border}`,
            }}
        >
            <a
                href="/"
                className="tap-target"
                style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 16, color: tokens.text }}
            >
                <Logo tokens={tokens} size={26} />
                {BRAND}
            </a>

            {/* Below 950px this row folds into the menu the button at the right opens, badge included. */}
            <nav
                id="site-nav"
                className="nav-links"
                aria-label="Site"
                data-open={menuOpen ? 'true' : 'false'}
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginLeft: 'var(--nav-gap)' }}
            >
                {LINKS.map((link) => {
                    const active = isUnder(path, link.prefix);
                    return (
                        <a
                            key={link.id}
                            href={link.href}
                            className="tap-target nav-link"
                            aria-current={active ? 'page' : undefined}
                            style={{
                                padding: '7px 14px',
                                borderRadius: 8,
                                fontSize: 14,
                                color: active ? tokens.text : tokens.textDim,
                                background: active ? tokens.pillBg : 'transparent',
                                fontWeight: active ? 600 : 400,
                            }}
                        >
                            {link.label}
                        </a>
                    );
                })}
                {/* Resolved at build time from the configured npm channel (src/release.js), so it can
                    only show a version that is really published. */}
                <VersionMenu tokens={tokens} path={path} />
            </nav>

            <div style={{ flex: 1 }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
                <button
                    type="button"
                    className="tap-target"
                    onClick={onOpenSearch}
                    aria-label="Search the site"
                    title="Search (⌘K)"
                    style={iconButton(tokens)}
                >
                    <SearchIcon />
                </button>
                <button
                    type="button"
                    className="tap-target"
                    onClick={onToggleTheme}
                    aria-label={tokens.isLight ? 'Switch to dark mode' : 'Switch to light mode'}
                    style={iconButton(tokens)}
                >
                    <ThemeIcon isLight={tokens.isLight} />
                </button>
                <button
                    type="button"
                    className="tap-target nav-menu-btn"
                    onClick={() => setMenuOpen((current) => !current)}
                    aria-expanded={menuOpen}
                    aria-controls="site-nav"
                    aria-label={menuOpen ? 'Close the menu' : 'Open the menu'}
                    style={{ ...iconButton(tokens), display: 'none' }}
                >
                    <MenuIcon open={menuOpen} />
                </button>
                {/* Deliberately not a second "Read the quick start": the hero already owns that call, and
                    repeating it on the same screen splits one click two ways. */}
                <a
                    href={REPO_URL}
                    className="tap-target"
                    style={{
                        background: tokens.pillBg,
                        border: `1px solid ${tokens.borderStrong}`,
                        color: tokens.text,
                        padding: '8px 14px',
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 13,
                        gap: 8,
                    }}
                >
                    <GitHubMark />
                    GitHub
                </a>
            </div>
        </header>
    );
}
