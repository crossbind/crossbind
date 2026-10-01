import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeFilter, renderPnpmWorkspace } from '../scripts/build-templates.js';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PKG_DIR, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'src/manifest.json'), 'utf8'));
const entryOf = (key) => MANIFEST.find((entry) => entry.key === key);

test('a workspace-only file stays out of its own template only', () => {
    const cli = entryOf('mobile-reactnative-cli');
    const vite = entryOf('web-react-vite');
    assert.equal(makeFilter(cli)(path.join(REPO_ROOT, cli.source, 'eslint.config.mjs')), false);
    assert.equal(makeFilter(cli)(path.join(REPO_ROOT, cli.source, '.eslintrc.js')), true);
    assert.equal(makeFilter(vite)(path.join(REPO_ROOT, vite.source, 'eslint.config.js')), true);
});

test('every workspace-only file exists in its sample', () => {
    for (const entry of MANIFEST) {
        for (const file of entry.workspaceOnly ?? []) {
            assert.ok(fs.existsSync(path.join(REPO_ROOT, entry.source, file)), `${entry.key} lists a missing ${file}`);
        }
    }
});

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
