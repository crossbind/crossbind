import { test } from 'node:test';
import assert from 'node:assert/strict';
import TEMPLATE_MANIFEST from '../../tooling/create-app/src/manifest.json' with { type: 'json' };
import { APP_LIST } from '../src/apps/appList.js';
import EXAMPLES_PAGE, { APP_GROUPS, DEFAULT_TEMPLATE, groupApps, TEMPLATE_GROUPS } from '../src/pages/examples.js';
import { RELEASE } from '../src/release.js';

const TEMPLATES = TEMPLATE_GROUPS.flatMap((group) => group.templates);
// The words a shell passes on: a quoted run is one word.
const words = (command) => [...command.matchAll(/"([^"]*)"|(\S+)/g)].map(([, quoted, plain]) => quoted ?? plain);

test('the page offers every create-crossbind template once, and opens on one of them', () => {
    assert.deepEqual(TEMPLATES.map((template) => template.key).sort(), TEMPLATE_MANIFEST.map((template) => template.key).sort());
    assert.ok(TEMPLATES.some((template) => template.key === DEFAULT_TEMPLATE));
});

test('each command picks its template the way create-crossbind reads its arguments', () => {
    for (const template of TEMPLATES) {
        const [npm, create, creator, separator, dir, group, first, second, ...rest] = words(template.command);
        assert.deepEqual([npm, create, creator, separator, rest], ['npm', 'create', `crossbind${RELEASE.distTagSuffix}`, '--', []], template.command);
        // <dir> <group> <framework|variant> [<variant>], as create-crossbind's usage puts it.
        const picked = TEMPLATE_MANIFEST.filter((entry) => entry.group === group
            && (entry.framework ?? entry.label) === first
            && (second === undefined || entry.label === second));
        assert.deepEqual(picked.map((entry) => entry.key), [template.key], template.command);
        assert.equal(dir, { lib: 'my-lib', extension: 'my-extension' }[picked[0].kind] ?? 'my-app', template.command);
        assert.ok(template.source.endsWith(`/${picked[0].source}`), template.source);
    }
});

test('every library app is in exactly one category', () => {
    const grouped = groupApps(APP_LIST).flatMap((group) => group.apps.map((app) => app.id));
    assert.deepEqual([...grouped].sort(), APP_LIST.map((app) => app.id).sort());
});

test('a template is named once outside its tab, even where its group has no other', () => {
    const titles = TEMPLATES.map((template) => template.title);
    assert.ok(titles.includes('Executable'), titles.join(', '));
    assert.ok(titles.includes('Web · React · Vite'), titles.join(', '));
});

test('every section of the page has an anchor of its own', () => {
    const anchors = EXAMPLES_PAGE.blocks.filter((block) => block.type === 'h2').map((block) => block.id);
    assert.equal(new Set(anchors).size, anchors.length);
    assert.equal(anchors.length, APP_GROUPS.length + 1);
});
