import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertDemosMatchSnapshot, DEMOS } from '../build-example-demos.mjs';

const snapshot = { version: '2.0.0-beta.56' };
const manifestFor = (version) => ({
    builtAt: '2026-09-11T15:28:51.897Z',
    distTag: 'beta',
    demos: DEMOS.map((demo) => ({ id: demo.id, href: `/examples/${demo.id}/`, crossbind: version })),
});

test('a manifest with every demo at the snapshot version passes', () => {
    const manifest = manifestFor(snapshot.version);
    assert.equal(assertDemosMatchSnapshot(manifest, snapshot), manifest);
});

test('a missing manifest asks for the demo build', () => {
    assert.throws(() => assertDemosMatchSnapshot(null, snapshot), /no live demos manifest/);
    assert.throws(() => assertDemosMatchSnapshot({ demos: 'x' }, snapshot), /no live demos manifest/);
});

test('a partial demo build is refused by name', () => {
    const manifest = manifestFor(snapshot.version);
    const partial = { ...manifest, demos: manifest.demos.filter((demo) => demo.id !== 'web-vanilla') };
    assert.throws(() => assertDemosMatchSnapshot(partial, snapshot), /missing: web-vanilla;/);
});

test('demos built from another crossbind version are refused as stale', () => {
    assert.throws(
        () => assertDemosMatchSnapshot(manifestFor('2.0.0-beta.55'), snapshot),
        /web-react-vite@2\.0\.0-beta\.55.* resolved 2\.0\.0-beta\.56/,
    );
});

test('with a dist root, every demo page has to be in the build', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-demos-'));
    for (const demo of DEMOS.slice(0, -1)) {
        fs.mkdirSync(path.join(dist, 'examples', demo.id), { recursive: true });
        fs.writeFileSync(path.join(dist, 'examples', demo.id, 'index.html'), '<!doctype html>');
    }
    assert.throws(
        () => assertDemosMatchSnapshot(manifestFor(snapshot.version), snapshot, { distRoot: dist }),
        new RegExp(`not in the build: ${DEMOS.at(-1).id}`),
    );
});
