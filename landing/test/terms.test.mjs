import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import PRIVACY_PAGE from '../src/pages/privacy.js';
import TERMS_PAGE from '../src/pages/terms.js';
import { SITE_ROUTES } from '../src/site-pages.js';

test('is a page of the site', () => {
    assert.ok(SITE_ROUTES.includes(TERMS_PAGE.href));
});

test('the footer links it, and it links the privacy page', () => {
    const footer = readFileSync(new URL('../src/sections/Closing.jsx', import.meta.url), 'utf8');
    assert.ok(footer.includes('TERMS_PAGE.href'));
    assert.ok(JSON.stringify(TERMS_PAGE).includes(`](${PRIVACY_PAGE.href})`));
});
