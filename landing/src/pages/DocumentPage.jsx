import Article from '../guide/Article.jsx';
import { inline } from '../../../tooling/learn/src/inline.jsx';

// Privacy and License stand alone, so they get one column: the sidebar and the rails belong to the guide.
export default function DocumentPage({ tokens, page }) {
    return (
        <main id="content" style={{ padding: '32px var(--content-x) 80px' }}>
            <div style={{ maxWidth: 760 }}>
                <h1 style={{ fontSize: 'clamp(30px, 4.5vw, 44px)', fontWeight: 600, letterSpacing: -1.5, lineHeight: 1.1, margin: '0 0 14px', color: tokens.text }}>{page.title}</h1>
                <p style={{ fontSize: 16.5, lineHeight: 1.65, color: tokens.textDim, margin: '0 0 34px' }}>{inline(page.lede, tokens)}</p>
                <Article tokens={tokens} blocks={page.blocks} />
            </div>
        </main>
    );
}
