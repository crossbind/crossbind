import { RowsPage, SummaryRows } from '../ports/LibrariesPage.jsx';
import { INTEGRATION_GROUPS } from './integrations.js';

// /integrations/ (pages/integrations.js), as /extensions/ is laid out: one row per tool, grouped by its kind, with its name
// and what it is, each opening the section of the guide that sets it up.
export default function IntegrationsPage({ tokens, page }) {
    return (
        <RowsPage tokens={tokens} page={page}>
            <SummaryRows tokens={tokens} groups={INTEGRATION_GROUPS} />
        </RowsPage>
    );
}
