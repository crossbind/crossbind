import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMOS } from '../../scripts/site/build-example-demos.mjs';
import { searchGuide } from '../src/guide/search.js';
import { TUTORIAL_PAGES, TUTORIAL_SECTIONS } from '../src/pages/tutorial.js';
import { SITE_ROUTES } from '../src/site-pages.js';
import { contentsColumns, positionOf, tutorialSections } from '../src/tutorial/sections.js';

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

const step = (part, name) => ({ part, title: name, href: `/tutorial/${name}/`, path: `/tutorial/${name}` });

test('the contents list every step once, in reading order', () => {
    assert.deepEqual(TUTORIAL_SECTIONS.flatMap((section) => section.pages.map((page) => page.href)), TUTORIAL_PAGES.map((page) => page.href));
});

test('a part of the tutorial is one section of the contents', () => {
    const labels = TUTORIAL_SECTIONS.map((section) => section.label);
    assert.deepEqual(labels, [...new Set(labels)]);
    for (const page of TUTORIAL_PAGES) assert.ok(page.part, page.href);
});

test('consecutive steps of one part make a section, numbered by section and place', () => {
    const sections = tutorialSections([step('Start', 'a'), step('C++', 'b'), step('C++', 'c'), step('Rust', 'd')]);
    assert.deepEqual(sections.map((section) => [section.number, section.label]), [['1', 'Start'], ['2', 'C++'], ['3', 'Rust']]);
    assert.deepEqual(sections[1].pages, [
        { number: '2.1', title: 'b', href: '/tutorial/b/', path: '/tutorial/b' },
        { number: '2.2', title: 'c', href: '/tutorial/c/', path: '/tutorial/c' },
    ]);
});

test('a step knows its section and its place in it', () => {
    const sections = tutorialSections([step('Start', 'a'), step('C++', 'b'), step('C++', 'c')]);
    assert.deepEqual(positionOf(sections, '/tutorial/c'), { section: 'C++', step: 2, steps: 2 });
    assert.equal(positionOf(sections, '/tutorial/missing'), null);
});

test('the folded contents split into columns of about the same height, in reading order', () => {
    const sections = tutorialSections([
        ...['a', 'b', 'c', 'd'].map((name) => step('Start', name)),
        ...['e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'].map((name) => step('C++', name)),
        ...['n', 'o'].map((name) => step('Rust', name)),
        ...['p', 'q', 'r', 's', 't'].map((name) => step('Libraries', name)),
        ...['u', 'v', 'w'].map((name) => step('Runtime', name)),
    ]);
    assert.deepEqual(contentsColumns(sections, 2).map((column) => column.map((section) => section.label)), [['Start', 'C++'], ['Rust', 'Libraries', 'Runtime']]);
    assert.deepEqual(contentsColumns(sections, 1), [sections]);
    assert.deepEqual(contentsColumns(sections.slice(0, 1), 2), [sections.slice(0, 1), []]);
});
