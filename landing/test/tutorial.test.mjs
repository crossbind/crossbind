import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMOS } from '../../scripts/site/build-example-demos.mjs';
import { searchGuide } from '../src/guide/search.js';
import { TUTORIAL_PAGES, TUTORIAL_SECTIONS } from '../src/pages/tutorial.js';
import { SITE_ROUTES } from '../src/site-pages.js';

test('every tutorial step is a page of the site, so it is prerendered and in the sitemap', () => {
    for (const page of TUTORIAL_PAGES) assert.ok(SITE_ROUTES.includes(page.href), page.href);
});

test('every tutorial step runs a sample that the demo build prebuilds', () => {
    const prebuilt = new Set(DEMOS.filter((demo) => demo.kind === 'sample').map((demo) => demo.id));
    for (const page of TUTORIAL_PAGES) assert.ok(prebuilt.has(`sample-${page.sample}`), page.sample);
});

test('searching for the tutorial and a step\'s topic finds that step', () => {
    for (const page of TUTORIAL_PAGES) {
        assert.ok(searchGuide(`tutorial ${page.title}`).some((entry) => entry.href === page.href), page.href);
    }
});

test('the contents list every step once, in reading order', () => {
    assert.deepEqual(TUTORIAL_SECTIONS.flatMap((section) => section.pages.map((page) => page.href)), TUTORIAL_PAGES.map((page) => page.href));
});

test('a part of the tutorial is one section of the contents', () => {
    const labels = TUTORIAL_SECTIONS.map((section) => section.label);
    assert.deepEqual(labels, [...new Set(labels)]);
    for (const page of TUTORIAL_PAGES) assert.ok(page.part, page.href);
});
