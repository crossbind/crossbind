import { CHANGELOG_PAGE } from '../changelog/page.js';
import {
    AGENT_URL, DISCUSSIONS_URL, LIBRARIES_URL, LICENSE_URL, LLMS_URL, REPO_URL,
} from '../data.js';
import { guideHref } from '../guide/nav.js';

// Order agreed for the footer; internal targets are site pages, the rest were checked against
// the repository (Discussions is enabled, the licence file is MIT). No commercial-support entry:
// nothing paid is offered.
const LINKS = [
    { label: 'Docs', href: guideHref() },
    { label: 'Libraries', href: LIBRARIES_URL },
    { label: 'Changelog', href: CHANGELOG_PAGE.href },
    { label: 'Agent setup', href: AGENT_URL },
    { label: 'llms.txt', href: LLMS_URL },
    { label: 'GitHub', href: REPO_URL, external: true },
    { label: 'Discussions', href: DISCUSSIONS_URL, external: true },
    { label: 'MIT', href: LICENSE_URL, external: true },
];

export default function Closing({ tokens }) {
    return (
        <footer style={{
            padding: '40px var(--content-x)',
            borderTop: `1px solid ${tokens.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            color: tokens.textMuted,
            fontSize: 12,
        }}
        >
            <span>
                {/* Keeps the name with the year; the line breaks at "and" instead. */}
                <span style={{ whiteSpace: 'nowrap' }}>© 2026 Buğra Sarı</span>
                {' and crossbind contributors'}
            </span>
            <nav aria-label="Footer" style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
                {LINKS.map((link) => (
                    <a
                        key={link.href}
                        href={link.href}
                        className="tap-target"
                        target={link.external ? '_blank' : undefined}
                        rel={link.external ? 'noreferrer' : undefined}
                        style={{ color: tokens.textDim }}
                    >
                        {link.label}
                    </a>
                ))}
            </nav>
        </footer>
    );
}
