import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectProject } from '../skills/crossbind/scripts/inspect-project.mjs';

function fixture({ pkg = {}, files = {} }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-inspector-'));
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    for (const [name, content] of Object.entries(files)) {
        const target = path.join(root, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return root;
}

test('detects Vite, pnpm, native sources and existing crossbind packages', (t) => {
    const root = fixture({
        pkg: {
            dependencies: {
                crossbind: '^2.0.0',
                vite: '^7.0.0',
                '@crossbind/plugin-vite': '^2.0.0',
                '@crossbind/port-gdal': '^2.0.0',
            },
        },
        files: {
            'pnpm-lock.yaml': 'lockfileVersion: 9\n',
            'vite.config.js': 'export default {}\n',
            'crossbind.config.js': 'export default {}\n',
            'src/native/demo.cpp': 'int demo() { return 1; }\n',
        },
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = inspectProject(root);
    assert.equal(result.framework, 'vite');
    assert.equal(result.confidence, 'high');
    assert.equal(result.packageManager.name, 'pnpm');
    assert.deepEqual(result.nativeSources, ['src/native']);
    assert.equal(result.existingCrossbind.installed, true);
    assert.deepEqual(result.existingCrossbind.plugins, ['@crossbind/plugin-vite']);
    assert.deepEqual(result.existingCrossbind.ports, ['@crossbind/port-gdal']);
    assert.equal(result.constraints.coopCoepRequiredForMt, true);
});

test('detects Expo before React Native CLI', (t) => {
    const root = fixture({
        pkg: { dependencies: { expo: '^55', 'react-native': '^0.84' } },
        files: { 'app.json': '{}\n', 'metro.config.js': 'module.exports = {}\n' },
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = inspectProject(root);
    assert.equal(result.framework, 'react-native-expo');
    assert.deepEqual(result.targets, ['react-native']);
    assert.equal(result.constraints.coopCoepRequiredForMt, false);
});

test('applies edge runtime constraints', (t) => {
    const root = fixture({
        pkg: { devDependencies: { wrangler: '^5' } },
        files: { 'wrangler.jsonc': '{}\n' },
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = inspectProject(root);
    assert.equal(result.framework, 'cloudflare-worker');
    assert.equal(result.constraints.threadingSupported, false);
    assert.equal(result.constraints.workerModeSupported, false);
    assert.equal(result.constraints.opfsSupported, false);
});

test('requires runtime selection for a Cloudflare Vite application', (t) => {
    const root = fixture({
        pkg: {
            devDependencies: {
                '@cloudflare/vite-plugin': '^1',
                vite: '^8',
                wrangler: '^5',
            },
        },
        files: {
            'vite.config.ts': 'export default {}\n',
            'wrangler.jsonc': '{}\n',
        },
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = inspectProject(root);
    assert.equal(result.framework, 'cloudflare-vite');
    assert.equal(result.confidence, 'low');
    assert.deepEqual(result.targets, ['browser', 'edge']);
    assert.deepEqual(result.conflicts, ['vite', 'cloudflare-worker']);
    assert.equal(result.recommendedReference, 'integration/README.md');
    assert.equal(result.constraints.requiresRuntimeSelection, true);
    assert.equal(result.constraints.threadingSupported, null);
    assert.equal(result.constraints.coopCoepRequiredForMt, null);
    assert.equal(result.constraints.workerModeSupported, null);
    assert.equal(result.constraints.opfsSupported, null);
});

test('skips Ruby bundle contents while retaining other vendored native sources', (t) => {
    const root = fixture({
        files: {
            'vendor/bundle/gems/native.cpp': 'int ignored() { return 0; }\n',
            'vendor/library/native.cpp': 'int included() { return 1; }\n',
        },
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = inspectProject(root);
    assert.deepEqual(result.nativeSources, ['vendor/library']);
});

test('returns a usable unknown result', (t) => {
    const root = fixture({ pkg: { private: true } });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const result = inspectProject(root);
    assert.equal(result.framework, 'unknown');
    assert.equal(result.confidence, 'low');
    assert.equal(result.recommendedReference, 'integration/README.md');
});

test('rejects a missing project directory', () => {
    assert.throws(() => inspectProject('/definitely/missing/crossbind-project'), /does not exist/);
});
