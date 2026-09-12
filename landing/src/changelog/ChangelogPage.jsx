import Article from '../guide/Article.jsx';
import { RELEASE } from '../release.js';

// /changelog/: a page of its own, reached from the version menu in the navbar. The entries are the
// page's blocks (CHANGELOG.md, converted at build time); the rail on the right lists the versions
// and marks the one the site resolved.

function VersionRail({ tokens, versions }) {
    return (
        <nav className="changelog-rail" aria-label="Versions">
            <div style={{ fontFamily: tokens.mono, fontSize: 10.5, letterSpacing: 1.2, color: tokens.textMuted, marginBottom: 12 }}>VERSIONS</div>
            {versions.map((version) => {
                const current = version === RELEASE.version;
                return (
                    <a
                        key={version}
                        href={`#${version}`}
                        className="tap-target"
                        aria-current={current ? 'true' : undefined}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '4px 0',
                            fontSize: 13,
                            fontFamily: tokens.mono,
                            color: current ? tokens.text : tokens.textDim,
                            fontWeight: current ? 600 : 400,
                        }}
                    >
                        {`v${version}`}
                        {current ? <span style={{ fontSize: 10, letterSpacing: 1, color: tokens.accentText }}>CURRENT</span> : null}
                    </a>
                );
            })}
        </nav>
    );
}

export default function ChangelogPage({ tokens, page }) {
    const versions = page.blocks.filter((block) => block.type === 'h2' && block.id).map((block) => block.id);
    return (
        <main id="content">
            <section style={{ padding: '52px var(--content-x) 8px' }}>
                <div style={{ maxWidth: 880 }}>
                    <h1
                        style={{
                            fontSize: 'clamp(36px, 5vw, 54px)',
                            fontWeight: 600,
                            letterSpacing: -2,
                            lineHeight: 1.02,
                            margin: '0 0 16px',
                            color: tokens.text,
                        }}
                    >
                        {page.title}
                    </h1>
                    <p style={{ fontSize: 17, lineHeight: 1.65, color: tokens.textDim, margin: 0 }}>{page.lede}</p>
                </div>
            </section>
            <section className="changelog-layout" style={{ padding: '0 var(--content-x) 80px' }}>
                <div style={{ maxWidth: 760, minWidth: 0 }}>
                    <Article tokens={tokens} blocks={page.blocks} />
                </div>
                <VersionRail tokens={tokens} versions={versions} />
            </section>
        </main>
    );
}
