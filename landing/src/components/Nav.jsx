import Logo from './Logo.jsx';
import { AGENT_URL, BRAND, REPO_URL, SHOWCASE_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';

const LINKS = [
    { id: 'guide', label: 'Guide', href: guideHref() },
    { id: 'showcase', label: 'Showcase', href: SHOWCASE_URL },
    { id: 'agent', label: 'AI Agent', href: AGENT_URL },
    { id: 'community', label: 'Community', href: '#community' },
];

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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
        );
    }
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
    );
}

// The search and theme controls are the same 32px square; shared so they cannot drift apart.
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

function SearchIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
        </svg>
    );
}

export default function Nav({ tokens, onToggleTheme, onOpenSearch }) {
    return (
        <header style={{
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
            <a href="/" className="tap-target" style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 600, fontSize: 16, color: tokens.text }}>
                <Logo tokens={tokens} size={26} />
                {BRAND}
            </a>

            <nav className="nav-links" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginLeft: 'var(--nav-gap)' }}>
                {LINKS.map((link) => (
                    <a
                        key={link.id}
                        href={link.href}
                        style={{ padding: '7px 14px', borderRadius: 8, fontSize: 14, color: tokens.textDim }}
                    >
                        {link.label}
                    </a>
                ))}
            </nav>

            <div style={{ flex: 1 }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                    type="button"
                    className="tap-target"
                    onClick={onOpenSearch}
                    aria-label="Search the guide"
                    title="Search the guide (⌘K)"
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
