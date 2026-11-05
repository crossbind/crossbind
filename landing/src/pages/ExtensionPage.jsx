import Article from '../guide/Article.jsx';
import { DetailPage, Fact } from '../ports/PortPage.jsx';
import { EXTENSIONS_URL } from '../data.js';

// /extensions/<name>/ (pages/extensions.js): one extension's README, as its library's page is a library's, with its
// package and its links above it.
export default function ExtensionPage({ tokens, page }) {
    return (
        <DetailPage
            tokens={tokens}
            page={page}
            back={{ href: EXTENSIONS_URL, label: 'All extensions' }}
            facts={<Fact tokens={tokens} label="Package" value={page.extension.package} />}
        >
            {/* A README opens with a paragraph, where a library's page opens with a heading, which keeps its own room. */}
            <div style={{ marginTop: 26 }}>
                <Article tokens={tokens} blocks={page.blocks} />
            </div>
        </DetailPage>
    );
}
