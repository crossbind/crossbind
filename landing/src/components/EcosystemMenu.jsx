import { INTEGRATIONS_URL, LIBRARIES_URL } from '../data.js';
import { normalizePath } from '../guide/nav.js';
import { isUnder, NavMenu } from './menu.jsx';

const ITEMS = [
    { label: 'Libraries', href: LIBRARIES_URL },
    { label: 'Integrations', href: INTEGRATIONS_URL },
];

export default function EcosystemMenu({ tokens, path, active }) {
    const here = normalizePath(path);
    const items = ITEMS.map((item) => ({ ...item, current: isUnder(here, normalizePath(item.href)) }));

    return <NavMenu tokens={tokens} label="Ecosystem" active={active} items={items} />;
}
