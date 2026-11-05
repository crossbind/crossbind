import { inline } from '../guide/inline.jsx';
import { RowGroup, RowsPage } from '../ports/LibrariesPage.jsx';
import { EXTENSION_GROUPS } from './extensions.js';

// /extensions/ (pages/extensions.js), as /ports/ is laid out: one row per extension, grouped by what it does, with its name
// and what it is. How to use or write one is the guide's.
export default function ExtensionsPage({ tokens, page }) {
    return (
        <RowsPage tokens={tokens} page={page}>
            {EXTENSION_GROUPS.map((group) => (
                <RowGroup key={group.id} tokens={tokens} id={group.id} label={group.label}>
                    {group.items.map((item) => (
                        <li key={item.id} style={{ borderTop: `1px solid ${tokens.border}` }}>
                            <a href={item.href} className="lib-row extension-row" style={{ color: tokens.textDim, fontSize: 14, lineHeight: 1.5 }}>
                                <span className="lib-name" style={{ color: tokens.text, fontWeight: 600, fontSize: 15 }}>{item.name}</span>
                                <span className="lib-summary">{inline(item.shown, tokens)}</span>
                            </a>
                        </li>
                    ))}
                </RowGroup>
            ))}
        </RowsPage>
    );
}
