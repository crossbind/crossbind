import { useEffect, useRef, useState } from 'react';
import { formatPublishedAt } from '../changelog/format.js';
import { CHANGELOG_PAGE } from '../changelog/page.js';
import { V1_DOCS_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';
import { RELEASE } from '../release.js';

// The navbar's version, as a menu: the trigger shows the resolved version, the menu holds where
// that release lives. Entries are built from the snapshot, so nothing here can point at a version
// that is not published. Older docs and a migration guide join this list once they exist.
const ITEMS = [
    { label: 'Changelog', href: CHANGELOG_PAGE.href, path: CHANGELOG_PAGE.path },
    { label: 'Migration from v1', href: guideHref('migration'), path: guideHref('migration') },
    { label: 'cpp.js v1 docs', href: V1_DOCS_URL, external: true },
    { label: 'Release on GitHub', href: RELEASE.githubReleaseUrl, external: true },
    { label: 'Package on npm', href: RELEASE.npmUrl, external: true },
];

const trimSlash = (value) => value.replace(/\/+$/, '');

function Chevron({ open }) {
    return (
        <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

export default function VersionMenu({ tokens, path }) {
    const [open, setOpen] = useState(false);
    const root = useRef(null);
    const here = trimSlash(path);
    const onChangelog = here === trimSlash(CHANGELOG_PAGE.href);

    // Closes on Escape and on any click that lands outside the menu. Listening from mount rather
    // than while open keeps a click right after opening from slipping in before the effect runs.
    useEffect(() => {
        const onKey = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };
        const onClick = (event) => {
            if (!root.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onClick);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onClick);
        };
    }, []);

    return (
        <div ref={root} className="version-menu" style={{ position: 'relative', marginLeft: 8 }}>
            <button
                type="button"
                className="tap-target nav-link version-btn"
                onClick={() => setOpen((current) => !current)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls="version-menu"
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 9px 3px 10px',
                    borderRadius: 999,
                    fontFamily: tokens.mono,
                    fontSize: 11.5,
                    letterSpacing: 0.3,
                    whiteSpace: 'nowrap',
                    background: tokens.pillBg,
                    border: `1px solid ${open || onChangelog ? tokens.borderStrong : tokens.pillBorder}`,
                    color: open || onChangelog ? tokens.text : tokens.textDim,
                    cursor: 'pointer',
                }}
            >
                {`v${RELEASE.version}`}
                <Chevron open={open} />
            </button>
            <div
                id="version-menu"
                role="menu"
                aria-label={`crossbind ${RELEASE.version}`}
                hidden={!open}
                style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: 0,
                    minWidth: 268,
                    padding: 6,
                    borderRadius: 12,
                    background: tokens.panelRaised,
                    border: `1px solid ${tokens.borderStrong}`,
                    boxShadow: tokens.isLight ? '0 12px 32px rgba(0,0,0,0.12)' : '0 16px 40px rgba(0,0,0,0.45)',
                    zIndex: 6,
                }}
            >
                <div style={{ padding: '8px 10px 9px', borderBottom: `1px solid ${tokens.border}`, marginBottom: 4 }}>
                    <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted }}>
                        {`${RELEASE.channel.toUpperCase()} CHANNEL · NPM TAG ${RELEASE.distTag}`}
                    </div>
                    <div style={{ fontSize: 12.5, color: tokens.textDim, marginTop: 4 }}>{`Published ${formatPublishedAt(RELEASE.publishedAt)}`}</div>
                </div>
                {ITEMS.map((item) => {
                    const current = Boolean(item.path) && here === trimSlash(item.path);
                    return (
                        <a
                            key={item.label}
                            role="menuitem"
                            href={item.href}
                            target={item.external ? '_blank' : undefined}
                            rel={item.external ? 'noreferrer' : undefined}
                            aria-current={current ? 'page' : undefined}
                            className="version-item"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 14,
                                padding: '8px 10px',
                                borderRadius: 8,
                                fontSize: 13.5,
                                color: current ? tokens.text : tokens.textDim,
                                fontWeight: current ? 600 : 400,
                                background: current ? tokens.pillBg : 'transparent',
                            }}
                        >
                            {item.label}
                            <span style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.textMuted }}>{item.external ? '↗' : ''}</span>
                        </a>
                    );
                })}
            </div>
        </div>
    );
}
