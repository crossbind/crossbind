import { test } from 'node:test';
import assert from 'node:assert/strict';
import APPS, { extensionBlocks } from '../src/guide/pages/apps.js';

const CLIPBOARD = { name: '@crossbind/extension-clipboard', summary: "The system clipboard's text.", version: '2.0.0-beta.69' };
const UNPUBLISHED = { name: '@crossbind/extension-share', summary: 'The share sheet.', version: null };
const textOf = (blocks) => blocks.map((block) => block.text ?? '').join('\n');

test("the Apps guide lists crossbind's own extensions npm serves, each linked to its npm page", () => {
    const list = extensionBlocks([CLIPBOARD, UNPUBLISHED]).find((block) => block.type === 'ul');

    assert.deepEqual(list.items, [
        "[@crossbind/extension-clipboard](https://www.npmjs.com/package/@crossbind/extension-clipboard): The system clipboard's text.",
    ]);
});

test('with none of its own on npm, the Apps guide still says how to add one, find others and write one', () => {
    const blocks = extensionBlocks([UNPUBLISHED]);

    assert.equal(blocks.some((block) => block.type === 'ul'), false);
    assert.match(textOf(blocks), /`crossbind add <package>`/);
    assert.match(textOf(blocks), /\(https:\/\/www\.npmjs\.com\/search\?q=keywords%3Acrossbind-extension\), crossbind's own as well, and crossbind has not reviewed the ones others publish/);
    assert.match(textOf(blocks), /create crossbind\S* -- my-extension Extension`/);
});

test('the Apps guide has the extensions after what the app does for the page', () => {
    const headings = APPS.blocks.filter((block) => block.type === 'h2').map((block) => block.id);

    assert.equal(headings[headings.indexOf('functions') + 1], 'extensions');
});
