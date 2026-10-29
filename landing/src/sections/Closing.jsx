import { AUTHOR_URL } from '../data.js';
import LICENSE_PAGE from '../pages/license.js';
import PRIVACY_PAGE from '../pages/privacy.js';
import TERMS_PAGE from '../pages/terms.js';

// Docs, Libraries, the changelog (version menu) and GitHub sit in the navbar on every page, so the
// footer keeps only what the navbar lacks.
const LINKS = [
    { label: 'MIT License', href: LICENSE_PAGE.href },
    { label: 'Privacy', href: PRIVACY_PAGE.href },
    { label: 'Terms', href: TERMS_PAGE.href },
];

export default function Closing({ tokens }) {
    return (
        <footer style={{
            padding: '40px var(--content-x)',
            borderTop: `1px solid ${tokens.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            color: tokens.textMuted,
            fontSize: 12,
        }}
        >
            <span>
                {/* Keeps the name with the year; the line breaks at "and" instead. */}
                <span style={{ whiteSpace: 'nowrap' }}>
                    {'© 2026 '}
                    <a href={AUTHOR_URL} style={{ color: tokens.textDim }}>Buğra Sarı</a>
                </span>
                {' and crossbind contributors'}
            </span>
            <nav aria-label="Footer" style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
                {LINKS.map((link) => (
                    <a
                        key={link.href}
                        href={link.href}
                        className="tap-target"
                        style={{ color: tokens.textDim }}
                    >
                        {link.label}
                    </a>
                ))}
            </nav>
        </footer>
    );
}
