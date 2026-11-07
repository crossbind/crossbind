import { CHANGELOG_PAGE } from '../changelog/page.js';
import { PACKAGES_URL, V1_DOCS_URL } from '../data.js';
import { guideHref } from '../guide/nav.js';
import { RELEASE } from '../release.js';
import { NavMenu } from './menu.jsx';

const ITEMS = [
    { label: 'Changelog', href: CHANGELOG_PAGE.href, path: CHANGELOG_PAGE.path },
    { label: 'All packages', href: PACKAGES_URL, path: PACKAGES_URL },
    { label: 'Migration from v1', href: guideHref('migration'), path: guideHref('migration') },
    { label: 'cpp.js v1 docs', href: V1_DOCS_URL, external: true },
];

const trimSlash = (value) => value.replace(/\/+$/, '');

// It ends the link row at the right, so its panel hangs from the trigger's right edge.
export default function VersionMenu({ tokens, path }) {
    const here = trimSlash(path);
    const isReleasePage = here === trimSlash(CHANGELOG_PAGE.href) || `${here}/`.startsWith(PACKAGES_URL);
    const items = ITEMS.map((item) => ({ ...item, current: Boolean(item.path) && here === trimSlash(item.path) }));

    return (
        <NavMenu
            tokens={tokens}
            label={`v${RELEASE.version}`}
            active={isReleasePage}
            items={items}
            className="version-menu"
            style={{ marginLeft: 'auto', marginRight: 8 }}
            panelStyle={{ left: 'auto', right: 0 }}
        />
    );
}
