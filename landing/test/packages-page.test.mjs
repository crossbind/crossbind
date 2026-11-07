import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { discoverPublishablePackages } from '../../scripts/release/workspace-release.mjs';
import catalog from '../generated/packages-catalog.js';
import { CHANGELOG_PAGE } from '../src/changelog/page.js';
import { REPO_URL } from '../src/data.js';
import { renderLlmsIndex } from '../src/llms/index.js';
import PACKAGES_PAGE, { changeText, groupOf, PACKAGE_GROUPS, PACKAGE_PAGES, packagesLabel, versionSpan } from '../src/pages/packages.js';
import { searchGuide } from '../src/guide/search.js';
import { findSitePage, SITE_PAGES } from '../src/site-pages.js';

const ROOT = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8');
const rowsOf = (group) => group.families?.flatMap((family) => family.packages) ?? group.items;
const ROWS = PACKAGE_GROUPS.flatMap(rowsOf);
const LIBRARIES = PACKAGE_GROUPS.find(({ id }) => id === 'libraries').families;
const groupOfPackage = (name) => PACKAGE_GROUPS.find((group) => rowsOf(group).some((row) => row.name === name))?.id;
const pageOf = (slug) => PACKAGE_PAGES.find((page) => page.slug === slug);
const IN_CHANGELOG = new Set(CHANGELOG_PAGE.blocks.filter(({ type }) => type === 'h2').map(({ id }) => id));

test('the page is a page of the site, and the version menu links to it after the changelog', () => {
    assert.equal(PACKAGES_PAGE.href, '/packages/');
    assert.equal(findSitePage(PACKAGES_PAGE.href), PACKAGES_PAGE);
    assert.match(read('landing/src/components/VersionMenu.jsx'), /label: 'Changelog'[^\n]*\n\s*\{ label: 'All packages', href: PACKAGES_URL/);
});

test('every package the release train publishes has one row, with the version npm serves on the dist-tag', () => {
    const published = discoverPublishablePackages(fileURLToPath(ROOT)).map(({ name }) => name);
    const versions = new Map(catalog.packages.map(({ name, version }) => [name, version]));

    assert.deepEqual(ROWS.map(({ name }) => name).toSorted(), published.toSorted());
    for (const row of ROWS) assert.equal(row.version, versions.get(row.name), row.name);
});

test('the groups come in the agreed order, each package in the group of its folder', () => {
    assert.deepEqual(
        PACKAGE_GROUPS.map(({ id }) => id),
        ['cli', 'plugins', 'libraries', 'apps', 'extensions', 'bindings', 'examples'],
    );
    assert.deepEqual(
        rowsOf(PACKAGE_GROUPS[0]).map(({ name }) => name),
        ['crossbind', 'create-crossbind'],
    );
    assert.equal(groupOfPackage('@crossbind/plugin-react-native'), 'plugins');
    assert.equal(groupOfPackage('@crossbind/port-gdal-wasm'), 'libraries');
    assert.equal(groupOfPackage('@crossbind/core-store-kit'), 'apps');
    assert.equal(groupOfPackage('@crossbind/extension-dialog'), 'extensions');
    assert.equal(groupOfPackage('@crossbind/core-embind-napi'), 'bindings');
    assert.equal(groupOfPackage('@crossbind/typescript-config'), 'examples');
});

test('a folder joins a group by its whole name, or by being under one the group ends with a star', () => {
    assert.equal(groupOf('core/crossbind'), 'cli');
    assert.equal(groupOf('core/crossbind-next'), null);
    assert.equal(groupOf('core/embind-jsi'), 'bindings');
    assert.equal(groupOf('ports/gdal/wasm'), 'libraries');
    assert.equal(groupOf('tooling/typescript-config'), 'examples');
});

test("a library's row counts its packages, and those npm does not serve yet where only some are missing", () => {
    const library = (...versions) => ({ packages: versions.map((version) => ({ version })) });

    assert.equal(packagesLabel(library('2.0.0-beta.67', '2.0.0-beta.67')), '2 packages');
    assert.equal(packagesLabel(library('2.0.0-beta.67', null, null)), '3 packages, 2 not published yet');
    assert.equal(packagesLabel(library(null, null)), '2 packages');
});

test("a library's packages fold under its name, whose row shows the versions they are on", () => {
    const gdal = LIBRARIES.find(({ id }) => id === 'gdal');

    assert.equal(gdal.name, 'GDAL');
    assert.equal(gdal.packages[0].name, '@crossbind/port-gdal');
    assert.ok(gdal.packages.every(({ name }) => name.startsWith('@crossbind/port-gdal')));
    assert.equal(gdal.version, versionSpan(gdal.packages.map(({ version }) => version)));
});

test('packages on one version show it, and on several the oldest and the newest', () => {
    assert.equal(versionSpan(['2.0.0-beta.67', '2.0.0-beta.67']), '2.0.0-beta.67');
    assert.equal(versionSpan(['2.0.0-beta.68', null, '2.0.0-beta.67']), '2.0.0-beta.67–68');
    assert.equal(versionSpan(['2.0.0-beta.10', '2.0.0-beta.9']), '2.0.0-beta.9–10');
    assert.equal(versionSpan(['2.0.0', '2.0.0-rc.1']), '2.0.0-rc.1 – 2.0.0');
    assert.equal(versionSpan(['2.0.1', '2.0.0']), '2.0.0 – 2.0.1');
    assert.equal(versionSpan([null, null]), null);
});

test("a published package's row opens its page, beside npm's page of its version and its folder on GitHub at its tag", () => {
    const published = Object.fromEntries(catalog.packages.map((item) => [item.name, item]));
    for (const row of ROWS.filter(({ version }) => version)) {
        const { path } = published[row.name];
        assert.equal(row.npm, `https://www.npmjs.com/package/${row.name}/v/${row.version}`, row.name);
        assert.equal(row.github, `${REPO_URL}/tree/${row.name}@${row.version}/${path}`, row.name);
        assert.ok(findSitePage(row.href.split('#')[0]), `${row.name}: ${row.href} is no page of the site`);
    }
    for (const row of ROWS.filter(({ version }) => !version)) assert.deepEqual([row.href, row.npm, row.github], [null, null, null], row.name);
});

test("a library's packages all open the library's page, which holds its releases alone", () => {
    for (const library of LIBRARIES.filter(({ version }) => version)) {
        const page = pageOf(`port-${library.id}`);
        for (const row of library.packages.filter(({ version }) => version)) assert.equal(row.href, page.href, row.name);
        assert.deepEqual(
            page.blocks.filter(({ type }) => type === 'h2').map(({ id }) => id),
            catalog.histories[`ports/${library.id}`].map(({ version }) => version),
        );
    }
});

test('a package page holds its releases newest first, each with its day and the notes of its train where the changelog has them', () => {
    const page = pageOf('plugin-vite');
    const history = catalog.histories['plugins/vite'];

    assert.equal(findSitePage(page.href), page);
    assert.deepEqual(
        page.blocks.filter(({ type }) => type === 'h2').map(({ id }) => id),
        history.map(({ version }) => version),
    );
    for (const release of history) {
        const line = page.blocks[page.blocks.findIndex(({ id }) => id === release.version) + 1];
        assert.match(line.text, /^\d{1,2} [A-Z][a-z]+ 20\d\d/, release.version);
        assert.equal(line.text.includes(`[Release notes](/changelog/#${release.version})`), IN_CHANGELOG.has(release.version), release.version);
    }
});

test("a release lists the changes to the package's own code, says so where there were none, and the first one says nothing", () => {
    const page = pageOf('plugin-vite');
    const history = catalog.histories['plugins/vite'];
    const after = (version) => page.blocks[page.blocks.findIndex(({ id }) => id === version) + 2];

    for (const release of history.filter(({ changes }) => changes?.length)) {
        assert.equal(after(release.version).type, 'ul', release.version);
        assert.equal(after(release.version).items.length, release.changes.length, release.version);
    }
    for (const release of history.filter(({ changes }) => changes?.length === 0)) assert.match(after(release.version).text, /No change of its own/);
    assert.notEqual(after(history.at(-1).version)?.type, 'ul');
});

test('a change reads as its subject without its type and scope, as written, a breaking one says so', () => {
    assert.equal(changeText('feat(crossbind): app dev on a physical iphone'), 'app dev on a physical iphone');
    assert.equal(changeText('feat(crossbind): macOS apps'), 'macOS apps');
    assert.equal(changeText('feat(crossbind)!: bind only the imported functions'), '**Breaking:** bind only the imported functions');
    assert.equal(changeText('docs: fix the package readmes'), 'fix the package readmes');
    assert.equal(changeText('Merge the docs'), 'Merge the docs');
});

test('search and llms.txt read every package with its version, under the headings the page has', () => {
    const items = PACKAGES_PAGE.blocks.flatMap((block) => block.items ?? []);

    assert.deepEqual(
        PACKAGES_PAGE.blocks.filter(({ type }) => type === 'h2').map(({ id }) => id),
        PACKAGE_GROUPS.map(({ id }) => id),
    );
    assert.equal(items.length, ROWS.length);
    ROWS.forEach((row, index) => {
        assert.ok(items[index].includes(row.name), row.name);
        assert.ok(items[index].includes(row.version ?? 'not published yet'), row.name);
    });
    assert.match(renderLlmsIndex(), /\n## Packages\n\n- \[Packages\]\(https:\/\/crossbind\.dev\/packages\.md\)/);
    assert.match(renderLlmsIndex(), /\(https:\/\/crossbind\.dev\/packages\/plugin-vite\.md\)/);
});

test("a page of releases is named as one, so the tab, search and llms.txt tell it from the library's own page", () => {
    const others = SITE_PAGES.filter((page) => !PACKAGE_PAGES.includes(page)).map(({ title }) => title);
    for (const page of PACKAGE_PAGES) {
        assert.match(page.title, /^Releases of /);
        assert.ok(!others.includes(page.title), page.title);
    }
});

test("search finds a library before its releases, and a version's notes rather than every package's release of it", () => {
    const hrefs = (query) => searchGuide(query).map(({ href }) => href);
    const curl = hrefs('curl');

    assert.ok(curl.includes('/ports/curl/'));
    assert.ok(!curl.includes('/packages/port-curl/') || curl.indexOf('/ports/curl/') < curl.indexOf('/packages/port-curl/'));
    assert.deepEqual(
        hrefs('2.0.0-beta.68').filter((href) => /^\/packages\/[^/]+\/#/.test(href)),
        [],
    );
});
