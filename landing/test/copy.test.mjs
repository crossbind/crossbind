import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HERO_TERMINAL, SITE_TITLE } from '../src/data.js';
import { GUIDE_PAGES } from '../src/guide/nav.js';
import { markdownPages } from '../src/llms/index.js';
import { SUMMARY } from '../src/llms/overview.js';

// The site's copy reads as written by hand: periods, commas, colons and parentheses, no em dash. The pages under
// /api/ are docs/api word for word and keep their own style.
const EM_DASH = '—';

test('no page of the site uses an em dash', () => {
    for (const page of markdownPages().filter((entry) => !entry.path.startsWith('/api/'))) {
        const at = page.markdown.indexOf(EM_DASH);
        assert.equal(at, -1, `${page.path}: …${page.markdown.slice(Math.max(0, at - 40), at + 40)}…`);
    }
});

const blocksOf = (blocks) => blocks.flatMap((block) => [block, ...blocksOf(block.blocks ?? []), ...(block.tabs ?? []).flatMap((tab) => blocksOf(tab.blocks))]);
const GUIDE_BLOCKS = GUIDE_PAGES.flatMap((page) => blocksOf(page.blocks).map((block) => ({ page: page.slug || 'introduction', block })));

// The guide's column is under 600 px wide, so a table with long cells wraps them into narrow strips; a name with a
// description reads as entries instead, at the column's full width.
const MAX_TABLE_COLUMNS = 3;
const MAX_TABLE_CELL = 100;

test('a guide table is short: at most three columns, and no long cell', () => {
    for (const { page, block } of GUIDE_BLOCKS.filter(({ block }) => block.type === 'table')) {
        assert.ok(block.head.length <= MAX_TABLE_COLUMNS, `${page}: ${block.head.join(' | ')}`);
        for (const cell of [...block.head, ...block.rows.flat()]) assert.ok(cell.length <= MAX_TABLE_CELL, `${page}: ${cell}`);
    }
});

// inline() reads `code` and **bold** one at a time, so code inside bold would show its backticks.
const INLINE_TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;
const textsOf = (block) => {
    switch (block.type) {
        case 'p':
        case 'callout':
            return [block.text];
        case 'ul':
        case 'ol':
            return block.items;
        case 'table':
            return [...block.head, ...block.rows.flat()];
        case 'entries':
            return block.items.flatMap((item) => [item.name, item.text, item.default ?? '']);
        default:
            return [];
    }
};

test('no bold text in the guide holds code', () => {
    for (const { page, block } of GUIDE_BLOCKS) {
        for (const text of textsOf(block)) {
            const bold = String(text).split(INLINE_TOKEN).find((part) => part.startsWith('**') && part.includes('`'));
            assert.equal(bold, undefined, `${page}: ${bold}`);
        }
    }
});

test('the not-found page is titled like every other page', () => {
    const html = readFileSync(new URL('../public/404.html', import.meta.url), 'utf8');
    assert.match(html, /<title>Not found · crossbind<\/title>/);
});

test('the hero headline, the page title, the share image text and the README say the same thing', () => {
    const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
    const page = read('../index.html');
    // "JS apps" and "as needed" stay together, so a narrow screen never leaves a lone word on a line.
    assert.match(read('../src/sections/Hero.jsx'), /Build and ship JS&nbsp;apps\.\s*<br \/>\s*<span[^>]*>Add C\+\+ and Rust as&nbsp;needed\.<\/span>/);
    assert.equal(SITE_TITLE, 'crossbind · build and ship JS apps, add C++ and Rust as needed');
    assert.ok(page.includes(`<title>${SITE_TITLE}</title>`));
    assert.ok(page.includes('<meta property="og:image:alt" content="crossbind: build and ship JS apps, add C++ and Rust as needed" />'));
    assert.ok(read('../../core/crossbind/README.md').includes('<strong>Build and ship JS apps. Add C++ and Rust as needed.</strong>'));
});

test('the hero terminal types only commands docs/api documents, each under the kind of project it is for', () => {
    const api = new URL('../../docs/api/', import.meta.url);
    const docs = readdirSync(api).filter((name) => name.endsWith('.md')).map((name) => readFileSync(new URL(name, api), 'utf8')).join('\n');
    assert.ok(HERO_TERMINAL?.length > 0);
    HERO_TERMINAL.forEach(({ comment, command }) => {
        assert.match(comment, /^For \w+ projects$/);
        assert.ok(docs.includes(`\`${command.replace(/^npx /, '')}\``), command);
    });
});

test('the code window links the playground as "Try in Playground", and as "Try" alone on a phone', () => {
    assert.match(readFileSync(new URL('../src/sections/Hero.jsx', import.meta.url), 'utf8'), /aria-label="Try in Playground"[^>]*>[\s\S]*?className="hero-try-rest"/);
    assert.match(readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8'), /\.hero-try-rest \{\s*display: none;\s*\}/);
});

test('the summary agents read names the apps the headline promises', () => {
    assert.match(SUMMARY, /builds a web page and the native code it imports into an app for macOS, Linux, Windows, iOS and Android\./);
});
