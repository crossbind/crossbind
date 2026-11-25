import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GUIDE_SECTIONS } from '../src/guide/nav.js';

const ROOT = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8');
const DISTRIBUTE = GUIDE_SECTIONS.find(({ label }) => label === 'Distribute').pages;
const textOf = (page) => JSON.stringify([page.lede, page.blocks]);
const VARIABLE = /CROSSBIND_[A-Z0-9_]+/g;
const PUBLISHERS = { 'app-store': 'app-store', 'google-play': 'google-play', 'github-releases': 'github' };

// A package's own packages stay unopened: their links may lead back to the folder itself.
const sourcesUnder = (directory) => readdirSync(new URL(directory, ROOT), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const file = `${directory}${entry.name}`;
    if (entry.isDirectory()) return sourcesUnder(`${file}/`);
    return /(\.m?js|\.cmake|CMakeLists\.txt)$/.test(entry.name) ? [file] : [];
});

test('every workflow and store listing on the Distribute pages is the one app.md gives', () => {
    const fenced = [...read('docs/api/app.md').matchAll(/^```[a-z]*\n([\s\S]*?)\n```$/gm)].map(([, code]) => code);
    const blocks = DISTRIBUTE.flatMap(({ blocks }) => blocks).filter(({ type, file }) => type === 'code' && /^(\.github\/workflows|store)\//.test(file));
    assert.ok(blocks.length > 0);
    for (const { file, code } of blocks) assert.ok(fenced.includes(code), `${file} is not the one app.md gives`);
});

test('every CROSSBIND_ name the Distribute pages use is one the code of crossbind or of an extension has', () => {
    const sources = [...sourcesUnder('core/crossbind/src/'), ...sourcesUnder('extensions/')].map(read).join('\n');
    const known = new Set(sources.match(VARIABLE));
    for (const page of DISTRIBUTE) {
        for (const [name] of textOf(page).matchAll(VARIABLE)) assert.ok(known.has(name), `${page.slug}: no code has ${name}`);
    }
});

test("each store's page names every option its publisher takes, and its release", async () => {
    for (const [slug, name] of Object.entries(PUBLISHERS)) {
        const { default: extension } = await import(new URL(`extensions/${name}/crossbind.extension.js`, ROOT));
        const page = DISTRIBUTE.find((candidate) => candidate.slug === slug);
        for (const option of Object.keys(extension().publisher.options ?? {})) {
            assert.ok(textOf(page).includes(`--${option}`), `${slug} does not name --${option}`);
        }
        assert.ok(textOf(page).includes(`crossbind app release ${name}`), `${slug} does not name crossbind app release ${name}`);
    }
});
