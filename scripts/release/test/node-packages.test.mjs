import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
    binaryIdentity,
    bridgeStateDigest,
    changedBridgeState,
    lgplRows,
    missingDists,
    nodePackageLicense,
    nodePackageProblems,
    nodeProjectPaths,
    packBridgeState,
    restoreBridgeState,
    setManifestLicense,
    unpackDists,
    variantTarballs,
    writeNodePackageLicense,
} from '../node-packages.mjs';

const row = (name, license, extra = {}) => ({
    name,
    license,
    licenseText: `${name} license text`,
    sourceUrl: `https://example.org/${name}.tar.gz`,
    sha256: 'a'.repeat(64),
    ...extra,
});
const gdalRows = [
    row('gdal', 'MIT'),
    row('geos', 'LGPL-2.1-only'),
    row('iconv', 'LGPL-2.1-or-later'),
    row('spatialite', 'MPL-1.1 OR GPL-2.0-or-later OR LGPL-2.1-or-later'),
    row('zstd', 'BSD-3-Clause OR GPL-2.0-only'),
    row('llvm-runtimes', 'Apache-2.0 WITH LLVM-exception', { licenseText: null }),
];
const addon = {
    name: '@crossbind/port-gdal-node-linux-x64',
    version: '2.0.0-beta.63',
    repository: 'https://github.com/crossbind/crossbind.git',
    projectPath: 'ports/gdal/node',
    addonFile: 'gdal-node.linux-x64.node',
};

test('the LGPL rows are the libraries the LGPL may cover, not every copyleft alternative', () => {
    assert.deepEqual(
        lgplRows(gdalRows).map((entry) => entry.name),
        ['geos', 'iconv', 'spatialite'],
    );
});

test('an addon linking LGPL libraries carries the source tag and the steps to relink it', () => {
    const { expression, text } = nodePackageLicense({ ...addon, rows: gdalRows });

    assert.match(text, /^@crossbind\/port-gdal-node-linux-x64 ships a Node-API addon/);
    assert.ok(text.includes(`    ${expression}\n`));
    assert.match(expression, /\bLGPL-2\.1-only\b/);
    assert.ok(text.includes('geos, iconv and spatialite'));
    assert.ok(text.includes('https://github.com/crossbind/crossbind/tree/@crossbind/port-gdal-node-linux-x64@2.0.0-beta.63'));
    assert.ok(text.includes('crossbind.overrides.js'));
    assert.ok(text.includes('pnpm --dir ports/gdal/node build'));
    assert.ok(text.includes('Replace gdal-node.linux-x64.node in this package'));
    for (const entry of gdalRows) assert.ok(text.includes(`## ${entry.name} — ${entry.license}`), entry.name);
    assert.ok(text.indexOf('Relinking') < text.indexOf('## gdal'));
});

test('an addon without LGPL libraries and the package of the bindings carry no relink steps', () => {
    const permissive = [row('zlib', 'Zlib'), row('crossbind', 'MIT')];

    assert.doesNotMatch(nodePackageLicense({ ...addon, rows: permissive }).text, /Relinking/);
    const bindings = nodePackageLicense({ ...addon, name: '@crossbind/port-gdal-node', addonFile: null, rows: gdalRows });
    assert.doesNotMatch(bindings.text, /Relinking/);
    assert.match(bindings.text, /^@crossbind\/port-gdal-node ships the JavaScript bindings/);
});

test('refuses a component whose text is missing, except a runtime its exception covers', () => {
    const missing = [row('giflib', 'MIT', { licenseText: '=== COPYING ===\n\n(missing: build the package once)' })];

    assert.throws(() => nodePackageLicense({ ...addon, rows: missing }), /giflib/);
    assert.throws(
        () => nodePackageLicense({ ...addon, rows: [row('mingw-w64-runtime', 'LicenseRef-MinGW-w64-runtime', { licenseText: null })] }),
        /mingw-w64-runtime/,
    );
    assert.doesNotThrow(() =>
        nodePackageLicense({ ...addon, rows: [row('llvm-runtimes', 'Apache-2.0 WITH LLVM-exception', { licenseText: null })] }),
    );
});

test('writes LICENSE, the SBOM and the derived license field of a package', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-node-license-'));
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        `${JSON.stringify({ name: addon.name, version: addon.version, license: 'MIT', os: ['linux'] }, null, 4)}\n`,
    );

    const expression = writeNodePackageLicense(dir, { ...addon, rows: gdalRows });

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.equal(manifest.license, expression);
    assert.deepEqual(Object.keys(manifest), ['name', 'version', 'license', 'os']);
    assert.ok(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8').includes(expression));
    const sbom = JSON.parse(fs.readFileSync(path.join(dir, 'sbom.cdx.json'), 'utf8'));
    assert.equal(sbom.metadata.component.name, addon.name);
    assert.deepEqual(sbom.components.map((component) => component.name).sort(), gdalRows.map((entry) => entry.name).sort());
    fs.rmSync(dir, { recursive: true, force: true });
});

test('leaves package.json untouched when its license is already the derived one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-node-license-'));
    const file = path.join(dir, 'package.json');
    fs.writeFileSync(file, '{"name":"x","license":"MIT AND Zlib"}');

    setManifestLicense(dir, 'MIT AND Zlib');

    assert.equal(fs.readFileSync(file, 'utf8'), '{"name":"x","license":"MIT AND Zlib"}');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the bridges the node runner generated reach the macOS runner under its own checkout path', () => {
    // crossbind records physical paths, as process.cwd() reports them.
    const linuxRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-linux-checkout-')));
    const macRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-mac-checkout-')));
    const state = path.join(linuxRoot, 'ports/zlib/node/.crossbind');
    const header = `${linuxRoot}/ports/zlib/linux/dist/prebuilt/linux-x64-mt-release/include/zlib.h`;
    fs.mkdirSync(path.join(state, 'build/bridge'), { recursive: true });
    fs.mkdirSync(path.join(state, 'build/interface'), { recursive: true });
    fs.writeFileSync(path.join(state, 'cache.json'), JSON.stringify({ hashes: { [header]: 'h' } }));
    fs.writeFileSync(path.join(state, 'build/bridge/zlib.i.cpp'), '#include "zlib.h"\n');
    fs.writeFileSync(path.join(state, 'build/bridge/zlib.i.cpp.source'), `${header}\n`);
    fs.writeFileSync(path.join(state, 'build/interface/zlib.i'), '%include "zlib.h"\n');
    const packed = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridges-'));

    packBridgeState({ root: linuxRoot, projectPaths: ['ports/zlib/node'], outputDir: packed });
    restoreBridgeState({ root: macRoot, inputDir: packed });

    const restored = path.join(macRoot, 'ports/zlib/node/.crossbind');
    const macHeader = header.replace(linuxRoot, macRoot);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restored, 'cache.json'), 'utf8')), { hashes: { [macHeader]: 'h' } });
    assert.equal(fs.readFileSync(path.join(restored, 'build/bridge/zlib.i.cpp.source'), 'utf8'), `${macHeader}\n`);
    assert.equal(fs.readFileSync(path.join(restored, 'build/bridge/zlib.i.cpp'), 'utf8'), '#include "zlib.h"\n');
    assert.equal(fs.readFileSync(path.join(restored, 'build/interface/zlib.i'), 'utf8'), '%include "zlib.h"\n');
    for (const dir of [linuxRoot, macRoot, packed]) fs.rmSync(dir, { recursive: true, force: true });
});

test('restoring the bridges keeps every byte that is not the checkout path', () => {
    const linuxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-linux-checkout-'));
    const macRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-mac-checkout-'));
    const bridges = path.join(linuxRoot, 'ports/zlib/node/.crossbind/build/bridge');
    fs.mkdirSync(bridges, { recursive: true });
    const latin1 = Buffer.concat([Buffer.from('// caf'), Buffer.from([0xe9]), Buffer.from('\n')]);
    fs.writeFileSync(path.join(bridges, 'zlib.i.cpp'), latin1);
    fs.writeFileSync(
        path.join(bridges, 'zlib.i.cpp.source'),
        Buffer.concat([Buffer.from(`${fs.realpathSync(linuxRoot)}/zlib.h `), Buffer.from([0xe9])]),
    );
    const packed = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridges-'));

    packBridgeState({ root: linuxRoot, projectPaths: ['ports/zlib/node'], outputDir: packed });
    restoreBridgeState({ root: macRoot, inputDir: packed });

    const restored = path.join(macRoot, 'ports/zlib/node/.crossbind/build/bridge');
    assert.deepEqual(fs.readFileSync(path.join(restored, 'zlib.i.cpp')), latin1);
    assert.deepEqual(
        fs.readFileSync(path.join(restored, 'zlib.i.cpp.source')),
        Buffer.concat([Buffer.from(`${fs.realpathSync(macRoot)}/zlib.h `), Buffer.from([0xe9])]),
    );
    for (const dir of [linuxRoot, macRoot, packed]) fs.rmSync(dir, { recursive: true, force: true });
});

test('a cache key the restore could not move to the new checkout stops it', () => {
    const linuxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-linux-checkout-'));
    const macRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-mac-checkout-'));
    const state = path.join(linuxRoot, 'ports/zlib/node/.crossbind');
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'cache.json'), JSON.stringify({ hashes: { '/elsewhere/zlib.h': 'h' } }));
    const packed = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridges-'));
    packBridgeState({ root: linuxRoot, projectPaths: ['ports/zlib/node'], outputDir: packed });

    assert.throws(() => restoreBridgeState({ root: macRoot, inputDir: packed }), /\/elsewhere\/zlib\.h/);
    for (const dir of [linuxRoot, macRoot, packed]) fs.rmSync(dir, { recursive: true, force: true });
});

test('tells which bridge files a build changed, so a bridge the macOS runner regenerated or dropped is caught', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridge-digest-'));
    const bridges = path.join(root, 'ports/zlib/node/.crossbind/build/bridge');
    fs.mkdirSync(bridges, { recursive: true });
    fs.writeFileSync(path.join(bridges, 'zlib.i.cpp'), 'bridge');
    fs.writeFileSync(path.join(bridges, 'zlib.i.cpp.deps'), 'zconf.i.cpp\n');
    const before = bridgeStateDigest(root, ['ports/zlib/node']);

    assert.deepEqual(changedBridgeState(before, bridgeStateDigest(root, ['ports/zlib/node'])), []);
    fs.writeFileSync(path.join(bridges, 'zlib.i.cpp.deps'), '');
    fs.writeFileSync(path.join(bridges, 'zconf.i.cpp'), 'regenerated');
    assert.deepEqual(changedBridgeState(before, bridgeStateDigest(root, ['ports/zlib/node'])).sort(), [
        'ports/zlib/node/.crossbind/build/bridge/zconf.i.cpp',
        'ports/zlib/node/.crossbind/build/bridge/zlib.i.cpp.deps',
    ]);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a package the node runner links comes from the dist of the tarball another runner packed', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-unpack-dists-'));
    fs.mkdirSync(path.join(work, 'staging/package/dist/prebuilt/linux-x64-mt-release/lib'), { recursive: true });
    fs.writeFileSync(path.join(work, 'staging/package/dist/prebuilt/linux-x64-mt-release/lib/libz.a'), 'archive');
    fs.writeFileSync(path.join(work, 'staging/package/package.json'), '{}');
    execFileSync('tar', ['-czf', path.join(work, 'port-zlib-linux.tgz'), '-C', path.join(work, 'staging'), 'package']);
    const stale = path.join(work, 'root/ports/zlib/linux/dist/stale.txt');
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, 'old');

    unpackDists({ root: path.join(work, 'root'), tarballs: [{ file: path.join(work, 'port-zlib-linux.tgz'), path: 'ports/zlib/linux' }] });

    assert.equal(fs.readFileSync(path.join(work, 'root/ports/zlib/linux/dist/prebuilt/linux-x64-mt-release/lib/libz.a'), 'utf8'), 'archive');
    assert.equal(fs.existsSync(stale), false);
    fs.rmSync(work, { recursive: true, force: true });
});

const workspace = {
    '@crossbind/port-zlib-node': { path: 'ports/zlib/node', buildKind: 'node' },
    '@crossbind/port-zlib-node-linux-x64': { path: 'ports/zlib/node-linux-x64', buildKind: 'node' },
    '@crossbind/port-geos-node-darwin-arm64': { path: 'ports/geos/node-darwin-arm64', buildKind: 'node-macos' },
    '@crossbind/port-zlib-linux': { path: 'ports/zlib/linux', buildKind: 'linux-native' },
    '@crossbind/port-zlib-darwin': { path: 'ports/zlib/darwin', buildKind: 'macos' },
    '@crossbind/port-zlib-win32': { path: 'ports/zlib/win32', buildKind: 'win32-native' },
    '@crossbind/port-zlib-wasm': { path: 'ports/zlib/wasm', buildKind: 'wasm' },
};

test('names the platform packages of a family that arrived without a dist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-missing-dists-'));
    fs.mkdirSync(path.join(root, 'ports/zlib/linux/dist'), { recursive: true });

    assert.deepEqual(missingDists(root, ['ports/zlib/node'], ['linux', 'win32']), ['ports/zlib/win32']);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a runner builds each ready-made Node package once, from the package of its bindings', () => {
    assert.deepEqual(
        nodeProjectPaths(['@crossbind/port-zlib-node', '@crossbind/port-zlib-node-linux-x64', '@crossbind/port-zlib-linux'], workspace),
        ['ports/zlib/node'],
    );
    assert.deepEqual(nodeProjectPaths(['@crossbind/port-geos-node-darwin-arm64'], workspace), ['ports/geos/node']);
});

test('picks the tarballs of the platform packages a runner links, from every build manifest it received', () => {
    const inputs = [
        { directory: '/in/linux-native', artifacts: [{ package: '@crossbind/port-zlib-linux', filename: 'zlib-linux.tgz' }] },
        { directory: '/in/win32-native', artifacts: [{ package: '@crossbind/port-zlib-win32', filename: 'zlib-win32.tgz' }] },
        { directory: '/in/wasm', artifacts: [{ package: '@crossbind/port-zlib-wasm', filename: 'zlib-wasm.tgz' }] },
        { directory: '/in/macos', artifacts: [{ package: '@crossbind/port-zlib-darwin', filename: 'zlib-darwin.tgz' }] },
    ];

    assert.deepEqual(variantTarballs(inputs, workspace, ['linux', 'win32']), [
        { file: path.join('/in/linux-native', 'tarballs', 'zlib-linux.tgz'), path: 'ports/zlib/linux' },
        { file: path.join('/in/win32-native', 'tarballs', 'zlib-win32.tgz'), path: 'ports/zlib/win32' },
    ]);
});

const elf = (machine) => {
    const buffer = Buffer.alloc(64);
    buffer.writeUInt32BE(0x7f454c46, 0);
    buffer.writeUInt16LE(machine, 18);
    return buffer;
};
const macho = (cputype) => {
    const buffer = Buffer.alloc(32);
    buffer.writeUInt32LE(0xfeedfacf, 0);
    buffer.writeUInt32LE(cputype, 4);
    return buffer;
};
const pe = (machine) => {
    const buffer = Buffer.alloc(256);
    buffer.write('MZ', 0, 'latin1');
    buffer.writeUInt32LE(0x80, 0x3c);
    buffer.write('PE\0\0', 0x80, 'latin1');
    buffer.writeUInt16LE(machine, 0x84);
    return buffer;
};

test('reads the format and architecture of an addon from its header', () => {
    assert.deepEqual(binaryIdentity(elf(0x3e)), { format: 'elf', arch: 'x64' });
    assert.deepEqual(binaryIdentity(elf(0xb7)), { format: 'elf', arch: 'arm64' });
    assert.deepEqual(binaryIdentity(macho(0x01000007)), { format: 'macho', arch: 'x64' });
    assert.deepEqual(binaryIdentity(macho(0x0100000c)), { format: 'macho', arch: 'arm64' });
    assert.deepEqual(binaryIdentity(pe(0x8664)), { format: 'pe', arch: 'x64' });
    assert.deepEqual(binaryIdentity(pe(0xaa64)), { format: 'pe', arch: 'arm64' });
    assert.equal(binaryIdentity(Buffer.from('not a binary')).format, 'unknown');
});

function packageDir(manifest, files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-node-package-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), content);
    }
    return dir;
}
const license = 'MIT AND Zlib';
const licenseFiles = (name) => ({
    LICENSE: `${name} ships a Node-API addon\n\n    ${license}\n\n## zlib — Zlib\n\nzlib text\n`,
    'sbom.cdx.json': JSON.stringify({ metadata: { component: { name } }, components: [] }),
});
const addonManifest = { name: '@crossbind/port-zlib-node-linux-x64', license, os: ['linux'], cpu: ['x64'], main: 'zlib-node.linux-x64.node' };

test('packs an addon package whose addon matches the platform it declares', () => {
    const dir = packageDir(addonManifest, { 'zlib-node.linux-x64.node': elf(0x3e), ...licenseFiles(addonManifest.name) });

    assert.deepEqual(nodePackageProblems(dir), []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('refuses a hollow addon package, a wrong addon and incomplete license files', () => {
    const hollow = packageDir(addonManifest, licenseFiles(addonManifest.name));
    const wrongArch = packageDir(addonManifest, { 'zlib-node.linux-x64.node': elf(0xb7), ...licenseFiles(addonManifest.name) });
    const wrongFormat = packageDir(addonManifest, { 'zlib-node.linux-x64.node': macho(0x01000007), ...licenseFiles(addonManifest.name) });
    const missingText = packageDir(addonManifest, {
        'zlib-node.linux-x64.node': elf(0x3e),
        ...licenseFiles(addonManifest.name),
        LICENSE: `    ${license}\n\n(missing: build the package once)\n`,
    });
    const noLicense = packageDir(addonManifest, { 'zlib-node.linux-x64.node': elf(0x3e) });

    assert.match(nodePackageProblems(hollow).join('\n'), /zlib-node\.linux-x64\.node is missing/);
    assert.match(nodePackageProblems(wrongArch).join('\n'), /arm64.*x64|x64.*arm64/);
    assert.match(nodePackageProblems(wrongFormat).join('\n'), /macho/);
    assert.match(nodePackageProblems(missingText).join('\n'), /missing/);
    assert.match(nodePackageProblems(noLicense).join('\n'), /LICENSE[\s\S]*sbom\.cdx\.json/);
    for (const dir of [hollow, wrongArch, wrongFormat, missingText, noLicense]) fs.rmSync(dir, { recursive: true, force: true });
});

test('a bindings package needs each entry with its types and the loader it requires', () => {
    const manifest = { name: '@crossbind/port-zlib-node', license, optionalDependencies: { '@crossbind/port-zlib-node-linux-x64': '*' } };
    const entry = "'use strict';\nconst initNative = require('./zlib-node.native.cjs');\n";
    const complete = packageDir(manifest, {
        'dist/zlib.h.cjs': entry,
        'dist/zlib.h.d.cts': 'export {};',
        'dist/zlib-node.native.cjs': '',
        ...licenseFiles(manifest.name),
    });
    const empty = packageDir(manifest, licenseFiles(manifest.name));
    const untyped = packageDir(manifest, { 'dist/zlib.h.cjs': entry, 'dist/zlib-node.native.cjs': '', ...licenseFiles(manifest.name) });
    const noLoader = packageDir(manifest, { 'dist/zlib.h.cjs': entry, 'dist/zlib.h.d.cts': 'export {};', ...licenseFiles(manifest.name) });

    assert.deepEqual(nodePackageProblems(complete), []);
    assert.match(nodePackageProblems(empty).join('\n'), /no header entries/);
    assert.match(nodePackageProblems(untyped).join('\n'), /zlib\.h\.d\.cts/);
    assert.match(nodePackageProblems(noLoader).join('\n'), /zlib-node\.native\.cjs/);
    for (const dir of [complete, empty, untyped, noLoader]) fs.rmSync(dir, { recursive: true, force: true });
});
