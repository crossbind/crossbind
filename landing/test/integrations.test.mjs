import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import INTEGRATIONS_PAGE, { INTEGRATION_GROUPS } from '../src/pages/integrations.js';
import { findSitePage } from '../src/site-pages.js';

const ITEMS = INTEGRATION_GROUPS.flatMap((group) => group.items);
const headingIds = (page) => new Set(page.blocks.filter((block) => block.type === 'h2').map((block) => block.id));

// The packages under a directory of the repository, as their manifests name them.
const ROOT = new URL('../../', import.meta.url);
const manifests = (dir) => readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => new URL(`${dir}/${entry.name}/package.json`, ROOT))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')))
    .filter((manifest) => !manifest.private);
const PLUGINS = manifests('plugins').map((manifest) => manifest.name);
const PUBLISHED = new Set([...PLUGINS, ...manifests('core').map((manifest) => manifest.name)]);

test('the page is a page of the site', () => {
    assert.equal(findSitePage(INTEGRATIONS_PAGE.href), INTEGRATIONS_PAGE);
});

test('every card opens a page of the site, at a heading that page has', () => {
    for (const item of ITEMS) {
        const [path, anchor] = item.href.split('#');
        const page = findSitePage(path);
        assert.ok(page, `${item.id}: ${path} is not a page of the site`);
        if (anchor) assert.ok(headingIds(page).has(anchor), `${item.id}: ${path} has no #${anchor}`);
    }
});

test('every package a card names is one this repository publishes', () => {
    for (const item of ITEMS) {
        for (const name of item.packages) assert.ok(PUBLISHED.has(name), `${item.id}: ${name} is not a package of this repository`);
    }
});

test('every plugin the repository publishes is on the page', () => {
    const named = new Set(ITEMS.flatMap((item) => item.packages));
    assert.ok(PLUGINS.length > 0);
    for (const name of PLUGINS) assert.ok(named.has(name), `no card names ${name}`);
});

test('a card says what it is without a link, because the whole card is the link', () => {
    for (const item of ITEMS) assert.doesNotMatch(item.summary, /\]\(/, item.id);
});

test('no two cards share an id, and every section of the page has an anchor of its own', () => {
    assert.equal(new Set(ITEMS.map((item) => item.id)).size, ITEMS.length);
    const anchors = INTEGRATIONS_PAGE.blocks.filter((block) => block.type === 'h2').map((block) => block.id);
    assert.equal(new Set(anchors).size, anchors.length);
    for (const group of INTEGRATION_GROUPS) assert.ok(anchors.includes(group.id), group.id);
});
