import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentsColumns, positionOf, tutorialSections } from '../src/sections.js';
import { tutorialSteps } from '../src/tutorial.js';

const step = (part, name) => ({ part, title: name, href: `/tutorial/${name}/`, path: `/tutorial/${name}` });

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

const LINKS = Object.freeze({
    lesson: (sample) => `lesson:${sample}`,
    guide: (slug) => `guide:${slug}`,
    libraries: 'libraries:',
    playground: 'playground:',
    createCommand: 'the-create-command',
});
const textOf = (step) => JSON.stringify([step.lede, step.blocks]);

test("a lesson's links go where its caller places them, so no address of the site's is written into a lesson", () => {
    const steps = tutorialSteps(LINKS);
    const links = steps.flatMap((step) => [...textOf(step).matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]));
    assert.ok(links.length > 0);
    for (const link of links) assert.match(link, /^(?:lesson|guide|libraries|playground):/, link);
    assert.ok(steps.some((step) => textOf(step).includes(LINKS.createCommand)));
});
