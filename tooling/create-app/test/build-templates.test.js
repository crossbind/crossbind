import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderPnpmWorkspace } from '../scripts/build-templates.js';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'src/manifest.json'), 'utf8'));

test('templates that need dependency build scripts ship a pnpm allowBuilds file', () => {
    const cloud = MANIFEST.find((entry) => entry.key === 'cloud-cloudflare-worker');
    assert.deepEqual(cloud.allowBuilds, ['esbuild', 'workerd']);
    const rendered = renderPnpmWorkspace(cloud.allowBuilds);
    assert.match(rendered, /^allowBuilds:\n {2}esbuild: true\n {2}workerd: true\n$/m);
    assert.doesNotMatch(rendered, /packages:/);
});

test('templates without build-script needs declare nothing', () => {
    for (const entry of MANIFEST) {
        if (entry.key === 'cloud-cloudflare-worker') continue;
        assert.equal(entry.allowBuilds, undefined, `${entry.key} should not list allowBuilds`);
    }
});
