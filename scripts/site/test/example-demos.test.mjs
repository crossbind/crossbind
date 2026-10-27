import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    assertDemosMatchSnapshot,
    DEMOS,
    demoFingerprint,
    mismatchReport,
    RECORD_NAME,
    REPOSITORY_ROOT,
    patchBundles,
    removeDroppedDemos,
    reusableEntry,
    sampleSourceHash,
    treeHash,
} from '../build-example-demos.mjs';

const snapshot = { version: '2.0.0-beta.56' };
const sourcesOf = (demo) => (demo.kind === 'sample' ? { sources: sampleSourceHash(demo.id.replace(/^sample-/, '')) } : {});
const manifestFor = (version) => ({
    builtAt: '2026-09-11T15:28:51.897Z',
    distTag: 'beta',
    demos: DEMOS.map((demo) => ({ id: demo.id, href: `/examples/${demo.id}/`, crossbind: version, ...sourcesOf(demo) })),
});

test('a library page that misses its count reports its FAIL lines and its result line', () => {
    const shown = [
        'ok   example "Parse a URL": ["https://example.com/"]',
        'FAIL app dates seconds: [1,2] (expected [1,3])',
        'ok   app dates iso: ["2070-01-01T00:00:01Z"]',
        'curl 8.23.0 => 10/11 checks passed',
    ].join('\n');
    assert.equal(mismatchReport(shown), 'FAIL app dates seconds: [1,2] (expected [1,3])\ncurl 8.23.0 => 10/11 checks passed');
});

test('a page with neither FAIL nor result lines reports how it starts', () => {
    assert.equal(mismatchReport('compiling ...\n  still   compiling'), 'compiling ... still compiling');
});

test('base-aware demo bundles build without needing a compatibility patch', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-demo-base-'));
    try {
        const file = path.join(out, 'app.js');
        const source = 'import("/examples/web-vue-vite/crossbind.js");';
        fs.writeFileSync(file, source);
        assert.equal(patchBundles(out, 'web-vue-vite'), 0);
        assert.equal(fs.readFileSync(file, 'utf8'), source);
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
});

test('legacy demo bundles still resolve their loader and runtime from the demo subpath', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-demo-legacy-'));
    try {
        const file = path.join(out, 'app.js');
        fs.writeFileSync(file, 'import(`/crossbind.js`);window.Crossbind.initNative({...e,useWorker:true});');
        assert.equal(patchBundles(out, 'web-react-vite'), 1);
        const result = fs.readFileSync(file, 'utf8');
        assert.match(result, /import\(`\/examples\/web-react-vite\/crossbind.js`\)/);
        assert.match(result, /path:'\/examples\/web-react-vite'/);
        assert.equal(patchBundles(out, 'web-react-vite'), 0);
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
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

test('playground samples are built from this repository, so their crossbind may be ahead of the published one', () => {
    const manifest = manifestFor(snapshot.version);
    const ahead = {
        ...manifest,
        demos: manifest.demos.map((demo) => (demo.id.startsWith('sample-') ? { ...demo, crossbind: '2.0.0-beta.57' } : demo)),
    };
    assert.doesNotThrow(() => assertDemosMatchSnapshot(ahead, snapshot));
});

test('a playground sample whose project changed after its build is refused by name', () => {
    const manifest = manifestFor(snapshot.version);
    const changed = {
        ...manifest,
        demos: manifest.demos.map((demo) => (demo.id === 'sample-numbers' ? { ...demo, sources: 'an older build' } : demo)),
    };
    assert.throws(() => assertDemosMatchSnapshot(changed, snapshot), /samples changed after their modules were built: sample-numbers;/);
});

test('every playground sample is prebuilt, and nothing else is', () => {
    const samplesDir = path.join(REPOSITORY_ROOT, 'landing', 'src', 'playground', 'samples');
    const samples = fs.readdirSync(samplesDir).filter((name) => fs.existsSync(path.join(samplesDir, name, 'main.js')));
    const built = DEMOS.filter((demo) => demo.kind === 'sample').map((demo) => demo.id.replace(/^sample-/, ''));
    assert.deepEqual(built.toSorted(), samples.toSorted());
});

test('every JavaScript-only module under landing/demos is built, from its own directory', () => {
    const demosDir = path.join(REPOSITORY_ROOT, 'landing', 'demos');
    const directDirs = fs
        .readdirSync(demosDir)
        .filter((name) => name.startsWith('lib-') && fs.existsSync(path.join(demosDir, name, 'direct', 'index.html')))
        .map((name) => `${name}/direct`);
    const built = DEMOS.filter((demo) => demo.source).map((demo) => demo.source);
    assert.deepEqual(built.toSorted(), directDirs.toSorted());
    for (const demo of DEMOS.filter((entry) => entry.source)) {
        assert.equal(demo.id, demo.source.replace('/', '-'));
        assert.equal(demo.kind, 'source');
        assert.match(demo.expect, /^=> \d+\/\d+ checks passed$/);
    }
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

test('a tree hash follows the content of the files a checkout holds and skips what git ignores', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-tree-hash-'));
    try {
        execFileSync('git', ['init', '--quiet'], { cwd: root });
        fs.mkdirSync(path.join(root, 'demo', 'node_modules'), { recursive: true });
        fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
        fs.writeFileSync(path.join(root, 'demo', 'index.html'), 'one');
        const before = treeHash(['demo'], root);
        fs.writeFileSync(path.join(root, 'demo', 'node_modules', 'installed.js'), 'ignored');
        assert.equal(treeHash(['demo'], root), before);
        fs.writeFileSync(path.join(root, 'demo', 'index.html'), 'two');
        assert.notEqual(treeHash(['demo'], root), before);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a demo fingerprint moves with what the demo is built from, and nothing else', () => {
    const inputs = { distTag: 'beta', builder: 'builder', samples: 'samples' };
    const byId = (id) => DEMOS.find((demo) => demo.id === id);
    const [lib, template, sample] = ['lib-zstd', 'web-vanilla', 'sample-hello'].map(byId);
    assert.equal(demoFingerprint(lib, inputs), demoFingerprint(lib, inputs));
    assert.notEqual(demoFingerprint(lib, inputs), demoFingerprint(byId('lib-zstd-direct'), inputs));
    assert.notEqual(demoFingerprint(lib, inputs), demoFingerprint(lib, { ...inputs, builder: 'changed' }));
    assert.notEqual(demoFingerprint(template, inputs), demoFingerprint(template, { ...inputs, distTag: 'next' }));
    assert.equal(demoFingerprint(lib, inputs), demoFingerprint(lib, { ...inputs, samples: 'changed' }));
    assert.notEqual(demoFingerprint(sample, inputs), demoFingerprint(sample, { ...inputs, samples: 'changed' }));
});

test('a demo is kept while its record names the same inputs, and the same crossbind for one installed from npm', () => {
    const lib = DEMOS.find((demo) => demo.kind === 'source');
    const sample = DEMOS.find((demo) => demo.kind === 'sample');
    const record = { fingerprint: 'f', demo: { id: lib.id, crossbind: '2.0.0-beta.64' } };
    assert.equal(reusableEntry(lib, record, { fingerprint: 'f', version: '2.0.0-beta.64' }), record.demo);
    assert.equal(reusableEntry(lib, record, { fingerprint: 'g', version: '2.0.0-beta.64' }), null);
    assert.equal(reusableEntry(lib, record, { fingerprint: 'f', version: '2.0.0-beta.65' }), null);
    assert.equal(reusableEntry(lib, null, { fingerprint: 'f', version: '2.0.0-beta.64' }), null);
    const built = { fingerprint: 'f', demo: { id: sample.id, crossbind: '2.0.0-beta.63' } };
    assert.equal(reusableEntry(sample, built, { fingerprint: 'f', version: '2.0.0-beta.64' }), built.demo);
});

test('a demo the builder no longer lists is removed, and nothing it did not build', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-demos-dropped-'));
    try {
        assert.doesNotThrow(() => removeDroppedDemos(path.join(root, 'none yet')));
        for (const [dir, file] of [
            ['lib-zstd', RECORD_NAME],
            ['lib-gone', RECORD_NAME],
            ['apps', 'lib-zstd-light.webp'],
        ]) {
            fs.mkdirSync(path.join(root, dir));
            fs.writeFileSync(path.join(root, dir, file), '{}');
        }
        removeDroppedDemos(root);
        assert.deepEqual(fs.readdirSync(root).toSorted(), ['apps', 'lib-zstd']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
