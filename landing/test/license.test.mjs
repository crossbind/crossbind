import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import LICENSE_PAGE from '../src/pages/license.js';
import TERMS_PAGE from '../src/pages/terms.js';
import { SITE_ROUTES } from '../src/site-pages.js';

const LICENSE = readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ').trim();

test('is a page of the site', () => {
    assert.ok(SITE_ROUTES.includes(LICENSE_PAGE.href));
});

test('shows the repository LICENSE word for word', () => {
    const shown = flat(LICENSE_PAGE.blocks.map((block) => block.text).join(' '));
    for (const paragraph of LICENSE.trim().split(/\n\s*\n/).slice(1)) assert.ok(shown.includes(flat(paragraph)), paragraph.slice(0, 40));
});

test('the footer and the terms page link the license page, not GitHub', () => {
    const footer = readFileSync(new URL('../src/sections/Closing.jsx', import.meta.url), 'utf8');
    assert.ok(footer.includes('LICENSE_PAGE.href'));
    assert.ok(JSON.stringify(TERMS_PAGE).includes(`](${LICENSE_PAGE.href})`));
});
