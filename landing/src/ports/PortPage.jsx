import LibraryApps from '../apps/LibraryApps.jsx';
import Article from '../guide/Article.jsx';
import { inline } from '../guide/inline.jsx';
import { PORTS_INDEX_HREF } from './pages.js';

// /ports/<name>/: what the library is, how to install it on each platform, its live apps, its
// examples and its command-line tools, in that order.

// A fact with a page of its own, like the license, links it the way the row's other links do.
export function Fact({ tokens, label, value, href }) {
    const shown = <code style={{ fontFamily: tokens.mono, fontSize: 12.5, color: href ? tokens.accentText : tokens.text }}>{value}</code>;
    return (
        <span>
            {`${label} `}
            {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="tap-target" style={{ gap: 4, color: tokens.accentText }}>
                    {shown}
                    ↗
                </a>
            ) : shown}
        </span>
    );
}

// The page of one entry of a catalog, as /extensions/<name>/ has it too: the way back, its title, its lede, its facts
// with its links, then what the page holds.
export function DetailPage({ tokens, page, back, facts, children }) {
    return (
        <main id="content">
            <section style={{ padding: '40px var(--content-x) 80px' }}>
                <div style={{ maxWidth: 1040 }}>
                    <a href={back.href} className="tap-target" style={{ fontSize: 13.5, color: tokens.textDim }}>
                        {`← ${back.label}`}
                    </a>
                    <h1
                        style={{
                            fontSize: 'clamp(36px, 5vw, 54px)',
                            fontWeight: 600,
                            letterSpacing: -2,
                            lineHeight: 1.02,
                            margin: '18px 0 14px',
                            color: tokens.text,
                        }}
                    >
                        {page.title}
                    </h1>
                    {page.lede ? (
                        <p style={{ fontSize: 17, lineHeight: 1.65, color: tokens.textDim, margin: '0 0 14px', maxWidth: 760 }}>{inline(page.lede, tokens)}</p>
                    ) : null}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 20px', fontSize: 13.5, color: tokens.textMuted }}>
                        {facts}
                        {page.links.map((link) => (
                            <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="tap-target" style={{ color: tokens.accentText }}>
                                {`${link.label} ↗`}
                            </a>
                        ))}
                    </div>
                    {children}
                </div>
            </section>
        </main>
    );
}

export default function PortPage({ tokens, page }) {
    const { port } = page;
    const apps = page.blocks.findIndex((block) => block.type === 'apps');
    const before = apps === -1 ? page.blocks : page.blocks.slice(0, apps);
    const after = apps === -1 ? [] : page.blocks.slice(apps + 1);
    const facts = (
        <>
            <Fact tokens={tokens} label="Version" value={port.nativeVersion} />
            <Fact tokens={tokens} label="License" value={port.license} href={port.licenseUrl} />
        </>
    );
    return (
        <DetailPage tokens={tokens} page={page} back={{ href: PORTS_INDEX_HREF, label: 'All libraries' }} facts={facts}>
            <Article tokens={tokens} blocks={before} />
            {apps === -1 ? null : <LibraryApps tokens={tokens} family={port.family} name={port.name} />}
            <Article tokens={tokens} blocks={after} />
        </DetailPage>
    );
}
