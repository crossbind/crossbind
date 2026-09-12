import { Pill } from '../components/ui.jsx';
import { CHANNEL_LABEL, formatPublishedAt } from './format.js';

function MetaLink({
    tokens, href, external, children,
}) {
    return (
        <a
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noreferrer' : undefined}
            className="tap-target"
            style={{ color: tokens.accentText, textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
            {children}
            {external ? ' ↗' : ''}
        </a>
    );
}

export default function ReleaseMeta({ tokens, release }) {
    const channel = CHANNEL_LABEL[release.channel];
    return (
        <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '8px 16px',
            margin: '-6px 0 22px',
            fontSize: 13.5,
            color: tokens.textDim,
        }}
        >
            <Pill tokens={tokens}>{release.prerelease ? `${channel} · prerelease` : channel}</Pill>
            <span>{`Published ${formatPublishedAt(release.publishedAt)}`}</span>
            <MetaLink tokens={tokens} href={release.npmUrl} external>npm</MetaLink>
            <MetaLink tokens={tokens} href={release.githubReleaseUrl} external>GitHub Release</MetaLink>
        </div>
    );
}
