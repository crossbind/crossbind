import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import GUIDE_PAGE, { ANATOMY, REACH } from '../src/guide/pages/extensions.js';
import CATALOG, { EXTENSION_GROUPS, EXTENSION_PAGES } from '../src/pages/extensions.js';
import { findSitePage } from '../src/site-pages.js';

const ROOT = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8');
const CONTRACT = read('docs/api/extensions.md');
const NATIVE_API = read('core/app-host/cpp/include/crossbind/extension.h');
const manifestOf = (name) => JSON.parse(read(`extensions/${name}/package.json`));
const dependenciesOf = (folder) => Object.keys(JSON.parse(read(`${folder}/package.json`)).dependencies);
// What an app has by having the host, and what every project has by having crossbind.
const broughtDependencies = [...dependenciesOf('core/app-host'), ...dependenciesOf('core/crossbind')];
const PACKAGES = readdirSync(new URL('extensions/', ROOT));
const ROWS = EXTENSION_GROUPS.flatMap((group) => group.items);

test('the catalog and the guide page are pages of the site, each linking to the other', () => {
    assert.equal(findSitePage(CATALOG.href), CATALOG);
    assert.ok(findSitePage('/guide/extensions/'));
    assert.ok(CATALOG.blocks.some(({ text }) => text?.includes('(/guide/extensions/)')));
    assert.match(GUIDE_PAGE.lede, /\(\/extensions\/\)/);
});

test('the Ecosystem menu links to the catalog', () => {
    assert.match(read('landing/src/components/EcosystemMenu.jsx'), /label: 'Extensions', href: EXTENSIONS_URL/);
    assert.match(read('landing/src/components/Nav.jsx'), /ECOSYSTEM_PREFIXES = \[[^\]]*'\/extensions'/);
});

test("every package of the repository has one row, which opens the extension's own page, with its package's source", () => {
    assert.deepEqual(ROWS.map(({ id }) => id).toSorted(), PACKAGES.toSorted());
    for (const { id, href } of ROWS) {
        const page = findSitePage(href);
        assert.ok(EXTENSION_PAGES.includes(page), `${id}: ${href} is no extension's page`);
        assert.equal(page.title, id);
        assert.deepEqual(page.links.find(({ label }) => label === 'Source').href, manifestOf(id).homepage);
        assert.ok(page.blocks.some(({ type }) => type === 'h2'), `${id}'s page has no section`);
    }
});

test('a row is one line of what the extension is, as a library\'s is', () => {
    for (const { id, summary } of ROWS) {
        assert.ok(summary.length <= 110, `${id} is too long for its row`);
        assert.doesNotMatch(summary, /\.$/, id);
    }
});

test('a row says to add its extension exactly where neither the host nor crossbind brings it', () => {
    for (const { id, isAdded, shown } of ROWS) {
        assert.equal(isAdded, !broughtDependencies.includes(manifestOf(id).name), id);
        assert.equal(shown.includes('`crossbind add`'), isAdded, id);
    }
});

test("a row's summary is its package's description, which npm shows", () => {
    for (const { id, summary } of ROWS) {
        const description = manifestOf(id).description.replace(/^crossbind (app )?extension: /, '').replace(/\.$/, '');
        assert.equal(description.slice(1), summary.slice(1), id);
        assert.equal(description[0].toLowerCase(), summary[0].toLowerCase(), id);
    }
});

test("every row's package has the keyword of its group, by which npm finds those of one kind", () => {
    const keywords = {
        publishing: 'publishing', installers: 'installer', system: 'system', launches: 'launch', 'page-behavior': 'page', 'package-sources': 'package-source',
    };
    for (const group of EXTENSION_GROUPS) {
        for (const { id } of group.items) assert.ok(manifestOf(id).keywords.includes(keywords[group.id]), `${id} has no keyword ${keywords[group.id]}`);
    }
});

test('publishing comes first and the installers next, as what ships an app', () => {
    assert.deepEqual(EXTENSION_GROUPS.slice(0, 2).map(({ id }) => id), ['publishing', 'installers']);
});

test('the code of an extension in the guide is the code of the example, line by line', () => {
    for (const { source, code } of ANATOMY) {
        const lines = new Set(read(source).split('\n').map((line) => line.trim()));
        for (const line of code.split('\n').map((text) => text.trim()).filter(Boolean)) {
            assert.ok(lines.has(line), `${source} has no line: ${line}`);
        }
    }
});

test('every name of what an extension reaches is one the contract has', () => {
    const names = REACH.flatMap(([, through]) => [...through.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
    assert.ok(names.length > 30);
    for (const name of names) {
        const bare = name.replace(/\(\)$/, '').replace(/^registry\./, '').replace(/^app\.ios\./, '');
        assert.ok(CONTRACT.includes(bare) || NATIVE_API.includes(bare), `${name} is neither in extensions.md nor in extension.h`);
    }
});

test('what the pages say of roles, of when one enters and of app.without is what the packages do', () => {
    const packageOf = (name) => read(`extensions/${name}/crossbind.extension.js`);
    assert.match(packageOf('menu'), /holds: \['menu', 'notification', 'tray'\]/);
    assert.match(packageOf('updater'), /reads: \['updater'\]/);
    assert.match(packageOf('google-play'), /isDefault: true/);
    assert.match(packageOf('app-store'), /isDefault: true/);
    for (const name of EXTENSION_GROUPS.find((group) => group.id === 'launches').items.map(({ id }) => id)) {
        assert.match(packageOf(name), /fromApp/, name);
    }
    for (const name of EXTENSION_GROUPS.find((group) => group.id === 'package-sources').items.map(({ id }) => id)) {
        assert.match(packageOf(name), /packageSource: \{/, name);
    }
});
