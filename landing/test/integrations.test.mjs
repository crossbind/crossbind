import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import INTEGRATIONS_PAGE, { INTEGRATION_GROUPS } from '../src/pages/integrations.js';
import { findSitePage } from '../src/site-pages.js';

const ITEMS = INTEGRATION_GROUPS.flatMap((group) => group.items);
const headingIds = (page) => new Set(page.blocks.filter((block) => block.type === 'h2').map((block) => block.id));
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('the page is a page of the site', () => {
    assert.equal(findSitePage(INTEGRATIONS_PAGE.href), INTEGRATIONS_PAGE);
});

test('every row opens a page of the site, at a heading that page has', () => {
    for (const item of ITEMS) {
        const [path, anchor] = item.href.split('#');
        const page = findSitePage(path);
        assert.ok(page, `${item.id}: ${path} is not a page of the site`);
        if (anchor) assert.ok(headingIds(page).has(anchor), `${item.id}: ${path} has no #${anchor}`);
    }
});

test("a row is one line of what the tool is, as an extension's is, with no link in it, because the whole row is the link", () => {
    for (const { id, summary } of ITEMS) {
        assert.ok(summary.length <= 110, `${id} is too long for its row`);
        assert.doesNotMatch(summary, /\.$/, id);
        assert.doesNotMatch(summary, /\]\(/, id);
    }
});

test('the page draws its rows as /extensions/ does', () => {
    for (const page of ['IntegrationsPage', 'ExtensionsPage']) assert.match(read(`landing/src/pages/${page}.jsx`), /<SummaryRows /, page);
});

test('no two rows share an id, and every group of the page has an anchor of its own', () => {
    assert.equal(new Set(ITEMS.map((item) => item.id)).size, ITEMS.length);
    const anchors = INTEGRATIONS_PAGE.blocks.filter((block) => block.type === 'h2').map((block) => block.id);
    assert.equal(new Set(anchors).size, anchors.length);
    for (const group of INTEGRATION_GROUPS) assert.ok(anchors.includes(group.id), group.id);
});
