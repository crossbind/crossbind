import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { inspectProject } from '../skills/crossbind/scripts/inspect-project.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tooling', 'create-app', 'src', 'manifest.json'), 'utf8'));

// The reference a project made from each create-crossbind template should be sent to.
const EXPECTED_REFERENCE = {
    'web-vanilla': 'integration/vanilla.md',
    'web-react-rspack': 'integration/webpack-rspack.md',
    'web-react-vite': 'integration/vite.md',
    'web-vue-vite': 'integration/vite.md',
    'web-svelte-vite': 'integration/vite.md',
    'mobile-reactnative-cli': 'integration/react-native-cli.md',
    'mobile-reactnative-expo': 'integration/react-native-expo.md',
    'desktop-app': 'integration/desktop-app.md',
    'desktop-electron': 'integration/nodejs.md',
    'backend-nodejs-wasm': 'integration/nodejs.md',
    'backend-nodejs-native': 'integration/nodejs.md',
    'backend-nodejs-standalone': 'integration/nodejs.md',
    'cloud-cloudflare-worker': 'integration/cloudflare-worker.md',
    'native-executable': 'api/native.md',
    'lib-prebuilt': 'port.md',
    'lib-source': 'port.md',
    'lib-cmake': 'port.md',
    'app-extension': 'extension.md',
};

// Templates the inspector sends elsewhere today. Each runs as a todo, so the gap shows without failing the run, and
// leaves this list with the change that closes it.
const KNOWN_GAPS = new Set([
    'backend-nodejs-standalone', 'native-executable', 'lib-prebuilt', 'lib-source', 'lib-cmake', 'app-extension',
]);

function recommended(template) {
    return inspectProject(path.join(ROOT, template.source)).recommendedReference;
}

test('every template has an expected reference, which the bundle carries', () => {
    assert.deepEqual(Object.keys(EXPECTED_REFERENCE).sort(), TEMPLATES.map((template) => template.key).sort());
    for (const reference of new Set(Object.values(EXPECTED_REFERENCE))) {
        assert.ok(fs.existsSync(path.join(ROOT, 'agents', 'skills', 'crossbind', 'references', reference)), `missing reference ${reference}`);
    }
});

for (const template of TEMPLATES) {
    const expected = EXPECTED_REFERENCE[template.key];
    const todo = KNOWN_GAPS.has(template.key) ? 'the inspector does not know this kind of project yet' : false;
    test(`sends the ${template.key} template to ${expected}`, { todo }, () => {
        assert.equal(recommended(template), expected);
    });
}

test('each known gap is still open', () => {
    for (const template of TEMPLATES.filter(({ key }) => KNOWN_GAPS.has(key))) {
        assert.notEqual(recommended(template), EXPECTED_REFERENCE[template.key], `${template.key} is fixed: take it out of KNOWN_GAPS`);
    }
});
