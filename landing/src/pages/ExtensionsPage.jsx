import { RowsPage, SummaryRows } from '../ports/LibrariesPage.jsx';
import { EXTENSION_GROUPS } from './extensions.js';

// /extensions/ (pages/extensions.js), as /ports/ is laid out: one row per extension, grouped by what it does, with its name
// and what it is. How to use or write one is the guide's.
export default function ExtensionsPage({ tokens, page }) {
    return (
        <RowsPage tokens={tokens} page={page}>
            <SummaryRows tokens={tokens} groups={EXTENSION_GROUPS} />
        </RowsPage>
    );
}
