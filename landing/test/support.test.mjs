import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISCUSSIONS_URL, ISSUES_URL, REPORT_VULNERABILITY_URL, SECURITY_EMAIL, SUPPORT_EMAIL } from '../src/data.js';
import SUPPORT_PAGE from '../src/pages/support.js';
import { SITE_ROUTES } from '../src/site-pages.js';

test('is a page of the site', () => {
    assert.ok(SITE_ROUTES.includes(SUPPORT_PAGE.href));
});

test('the footer links it', () => {
    const footer = readFileSync(new URL('../src/sections/Closing.jsx', import.meta.url), 'utf8');
    assert.ok(footer.includes('SUPPORT_PAGE.href'));
});

test('sends questions, bugs, vulnerabilities and the rest each to its place', () => {
    const page = JSON.stringify(SUPPORT_PAGE);
    for (const target of [DISCUSSIONS_URL, ISSUES_URL, REPORT_VULNERABILITY_URL, `mailto:${SECURITY_EMAIL}`, `mailto:${SUPPORT_EMAIL}`]) {
        assert.ok(page.includes(`](${target})`), target);
    }
});

test("the repository's security policy names the same two private ways", () => {
    const policy = readFileSync(new URL('../../SECURITY.md', import.meta.url), 'utf8');
    assert.ok(policy.includes(REPORT_VULNERABILITY_URL));
    assert.ok(policy.includes(SECURITY_EMAIL));
});
