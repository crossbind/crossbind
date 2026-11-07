import { PACKAGES_URL } from '../data.js';
import Article from '../guide/Article.jsx';
import { DetailPage, Fact } from '../ports/PortPage.jsx';

// /packages/<name>/ (pages/packages.js): a package's releases, or a library's packages', newest first.
export default function PackagePage({ tokens, page }) {
    return (
        <DetailPage
            tokens={tokens}
            page={page}
            back={{ href: PACKAGES_URL, label: 'All packages' }}
            facts={<Fact tokens={tokens} label="Version" value={page.version} />}
        >
            <Article tokens={tokens} blocks={page.blocks} />
        </DetailPage>
    );
}
