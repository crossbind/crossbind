import {
    AGENT_URL, CHANGELOG_URL, REPO_URL, SHOWCASE_URL,
} from '../data.js';
import { guideHref } from '../guide/nav.js';

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
                crossbind · MIT ·
                {' '}
                {/* Below 375px this line wraps; nowrap forces the break onto the separator
                    instead of orphaning the name from the year. */}
                <span style={{ whiteSpace: 'nowrap' }}>Copyright © 2026 Buğra Sarı</span>
            </span>
            {/* Also the mobile navigation: the header drops its link row below 860px. */}
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
                <a href={guideHref()} className="tap-target" style={{ color: tokens.textDim }}>Guide</a>
                <a href={SHOWCASE_URL} className="tap-target" style={{ color: tokens.textDim }}>Showcase</a>
                <a href={AGENT_URL} className="tap-target" style={{ color: tokens.textDim }}>AI Agent</a>
                <a href={CHANGELOG_URL} className="tap-target" style={{ color: tokens.textDim }}>Changelog</a>
                <a href={REPO_URL} className="tap-target" style={{ color: tokens.textDim }}>GitHub</a>
            </span>
        </footer>
    );
}
