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
    mergeStagedMulti,
    missingDists,
    nodePackageProblems,
    packBridgeState,
    restoreBridgeState,
    stageNodeOutputs,
    unpackDists,
    variantTarballs,
} from '../node-packages.mjs';

test('the bridges the node runner generated reach the macOS runner under its own checkout path', () => {
    // crossbind records physical paths, as process.cwd() reports them.
    const linuxRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-linux-checkout-')));
    const macRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-mac-checkout-')));
    const state = path.join(linuxRoot, 'ports/zlib/standalone-napi/.crossbind');
    const header = `${linuxRoot}/ports/zlib/linux/dist/prebuilt/linux-x64-mt-release/include/zlib.h`;
    fs.mkdirSync(path.join(state, 'build/bridge'), { recursive: true });
    fs.mkdirSync(path.join(state, 'build/interface'), { recursive: true });
    fs.writeFileSync(path.join(state, 'cache.json'), JSON.stringify({ hashes: { [header]: 'h' } }));
    fs.writeFileSync(path.join(state, 'build/bridge/zlib.i.cpp'), '#include "zlib.h"\n');
    fs.writeFileSync(path.join(state, 'build/bridge/zlib.i.cpp.source'), `${header}\n`);
    fs.writeFileSync(path.join(state, 'build/interface/zlib.i'), '%include "zlib.h"\n');
    const packed = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridges-'));

    packBridgeState({ root: linuxRoot, projectPaths: ['ports/zlib/standalone-napi'], outputDir: packed });
    restoreBridgeState({ root: macRoot, inputDir: packed });

    const restored = path.join(macRoot, 'ports/zlib/standalone-napi/.crossbind');
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
    const bridges = path.join(linuxRoot, 'ports/zlib/standalone-napi/.crossbind/build/bridge');
    fs.mkdirSync(bridges, { recursive: true });
    const latin1 = Buffer.concat([Buffer.from('// caf'), Buffer.from([0xe9]), Buffer.from('\n')]);
    fs.writeFileSync(path.join(bridges, 'zlib.i.cpp'), latin1);
    fs.writeFileSync(
        path.join(bridges, 'zlib.i.cpp.source'),
        Buffer.concat([Buffer.from(`${fs.realpathSync(linuxRoot)}/zlib.h `), Buffer.from([0xe9])]),
    );
    const packed = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridges-'));

    packBridgeState({ root: linuxRoot, projectPaths: ['ports/zlib/standalone-napi'], outputDir: packed });
    restoreBridgeState({ root: macRoot, inputDir: packed });

    const restored = path.join(macRoot, 'ports/zlib/standalone-napi/.crossbind/build/bridge');
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
    const state = path.join(linuxRoot, 'ports/zlib/standalone-napi/.crossbind');
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'cache.json'), JSON.stringify({ hashes: { '/elsewhere/zlib.h': 'h' } }));
    const packed = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridges-'));
    packBridgeState({ root: linuxRoot, projectPaths: ['ports/zlib/standalone-napi'], outputDir: packed });

    assert.throws(() => restoreBridgeState({ root: macRoot, inputDir: packed }), /\/elsewhere\/zlib\.h/);
    for (const dir of [linuxRoot, macRoot, packed]) fs.rmSync(dir, { recursive: true, force: true });
});

test('tells which bridge files a build changed, so a bridge the macOS runner regenerated or dropped is caught', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridge-digest-'));
    const bridges = path.join(root, 'ports/zlib/standalone-napi/.crossbind/build/bridge');
    fs.mkdirSync(bridges, { recursive: true });
    fs.writeFileSync(path.join(bridges, 'zlib.i.cpp'), 'bridge');
    fs.writeFileSync(path.join(bridges, 'zlib.i.cpp.deps'), 'zconf.i.cpp\n');
    const before = bridgeStateDigest(root, ['ports/zlib/standalone-napi']);

    assert.deepEqual(changedBridgeState(before, bridgeStateDigest(root, ['ports/zlib/standalone-napi'])), []);
    fs.writeFileSync(path.join(bridges, 'zlib.i.cpp.deps'), '');
    fs.writeFileSync(path.join(bridges, 'zconf.i.cpp'), 'regenerated');
    assert.deepEqual(changedBridgeState(before, bridgeStateDigest(root, ['ports/zlib/standalone-napi'])).sort(), [
        'ports/zlib/standalone-napi/.crossbind/build/bridge/zconf.i.cpp',
        'ports/zlib/standalone-napi/.crossbind/build/bridge/zlib.i.cpp.deps',
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
    '@crossbind/port-zlib-standalone-napi': {
        path: 'ports/zlib/standalone-napi',
        buildKind: 'node',
        runtimeLocalDependencies: ['@crossbind/port-zlib-standalone-napi-linux-x64'],
    },
    '@crossbind/port-zlib-standalone-napi-linux-x64': {
        path: 'ports/zlib/standalone-napi-linux-x64',
        buildKind: 'node',
        runtimeLocalDependencies: [],
    },
    '@crossbind/port-geos-standalone-napi': {
        path: 'ports/geos/standalone-napi',
        buildKind: 'node',
        runtimeLocalDependencies: ['@crossbind/port-geos-standalone-napi-darwin-arm64'],
    },
    '@crossbind/port-geos-standalone-napi-darwin-arm64': {
        path: 'ports/geos/standalone-napi-darwin-arm64',
        buildKind: 'node-macos',
        runtimeLocalDependencies: [],
    },
    '@crossbind/example-lib-prebuilt-matrix': { path: 'examples/lib-prebuilt-matrix', buildKind: 'multi-platform', runtimeLocalDependencies: [] },
    '@crossbind/port-zlib-linux': { path: 'ports/zlib/linux', buildKind: 'linux-native' },
    '@crossbind/port-zlib-darwin': { path: 'ports/zlib/darwin', buildKind: 'macos' },
    '@crossbind/port-zlib-win32': { path: 'ports/zlib/win32', buildKind: 'win32-native' },
    '@crossbind/port-zlib-wasm': { path: 'ports/zlib/wasm', buildKind: 'wasm' },
};
const pathOf = (name) => workspace[name]?.path;

function prebuilt(root, packagePath, ...targets) {
    targets.forEach((target) => fs.mkdirSync(path.join(root, packagePath, 'dist/prebuilt', target, 'lib'), { recursive: true }));
}

test('names the platforms a family needs that no package it links brought a dist for', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-missing-dists-'));
    fs.mkdirSync(path.join(root, 'ports/zlib/standalone-napi'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'ports/zlib/standalone-napi/package.json'),
        JSON.stringify({ devDependencies: { '@crossbind/port-zlib-linux': '*', '@crossbind/port-zlib-win32': '*', crossbind: '*' } }),
    );
    prebuilt(root, 'ports/zlib/linux', 'linux-x64-mt-release', 'linux-arm64-mt-release');

    assert.deepEqual(missingDists(root, ['ports/zlib/standalone-napi'], ['linux', 'win32'], pathOf), ['ports/zlib/standalone-napi: win32']);
    fs.rmSync(root, { recursive: true, force: true });
});

test('merges what other runners staged of a multi-platform package, with one host list for every platform', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-staged-multi-'));
    // Each runner's CMake names only the hosts it built.
    const stage = (runner, targets) => {
        const dist = path.join(work, 'in', runner, 'multi', runner, 'examples/lib-prebuilt-matrix/dist/prebuilt');
        targets.forEach((target) => {
            fs.mkdirSync(path.join(dist, target, 'lib'), { recursive: true });
            fs.writeFileSync(path.join(dist, target, 'lib/libmatrix.a'), `${target} archive`);
        });
        fs.writeFileSync(path.join(dist, 'CMakeLists.txt'), `set(MY_LIST "${targets.join(';')}")\nset(FIXTURE true)\n`);
        return { directory: path.join(work, 'in', runner), runner, artifacts: [], stagedMultiPlatform: ['@crossbind/example-lib-prebuilt-matrix'] };
    };
    const inputs = [stage('linux-native', ['linux-x64-mt-release', 'linuxmusl-x64-mt-release']), stage('win32-native', ['win32-x64-mt-release'])];

    mergeStagedMulti({ root: path.join(work, 'root'), inputs, workspace });

    const dist = path.join(work, 'root/examples/lib-prebuilt-matrix/dist/prebuilt');
    assert.equal(fs.readFileSync(path.join(dist, 'linux-x64-mt-release/lib/libmatrix.a'), 'utf8'), 'linux-x64-mt-release archive');
    assert.equal(fs.readFileSync(path.join(dist, 'win32-x64-mt-release/lib/libmatrix.a'), 'utf8'), 'win32-x64-mt-release archive');
    assert.equal(
        fs.readFileSync(path.join(dist, 'CMakeLists.txt'), 'utf8'),
        'set(MY_LIST "linux-x64-mt-release;linuxmusl-x64-mt-release;win32-x64-mt-release")\nset(FIXTURE true)\n',
    );
    fs.rmSync(work, { recursive: true, force: true });
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
const addonManifest = {
    name: '@crossbind/port-zlib-standalone-napi-linux-x64',
    license,
    os: ['linux'],
    cpu: ['x64'],
    main: 'zlib-standalone-napi.linux-x64.node',
};

test('packs an addon package whose addon matches the platform it declares', () => {
    const dir = packageDir(addonManifest, { 'zlib-standalone-napi.linux-x64.node': elf(0x3e), ...licenseFiles(addonManifest.name) });

    assert.deepEqual(nodePackageProblems(dir), []);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('refuses a hollow addon package, a wrong addon and incomplete license files', () => {
    const hollow = packageDir(addonManifest, licenseFiles(addonManifest.name));
    const wrongArch = packageDir(addonManifest, { 'zlib-standalone-napi.linux-x64.node': elf(0xb7), ...licenseFiles(addonManifest.name) });
    const wrongFormat = packageDir(addonManifest, { 'zlib-standalone-napi.linux-x64.node': macho(0x01000007), ...licenseFiles(addonManifest.name) });
    const missingText = packageDir(addonManifest, {
        'zlib-standalone-napi.linux-x64.node': elf(0x3e),
        ...licenseFiles(addonManifest.name),
        LICENSE: `    ${license}\n\n(missing: build the package once)\n`,
    });
    const noLicense = packageDir(addonManifest, { 'zlib-standalone-napi.linux-x64.node': elf(0x3e) });

    assert.match(nodePackageProblems(hollow).join('\n'), /zlib-standalone-napi\.linux-x64\.node is missing/);
    assert.match(nodePackageProblems(wrongArch).join('\n'), /arm64.*x64|x64.*arm64/);
    assert.match(nodePackageProblems(wrongFormat).join('\n'), /macho/);
    assert.match(nodePackageProblems(missingText).join('\n'), /missing/);
    assert.match(nodePackageProblems(noLicense).join('\n'), /LICENSE[\s\S]*sbom\.cdx\.json/);
    for (const dir of [hollow, wrongArch, wrongFormat, missingText, noLicense]) fs.rmSync(dir, { recursive: true, force: true });
});

test('a bindings package needs its entry with the types and the loader it boots', () => {
    const manifest = {
        name: '@crossbind/port-zlib-standalone-napi',
        license,
        optionalDependencies: { '@crossbind/port-zlib-standalone-napi-linux-x64': '*' },
    };
    const entry =
        "import { createRequire } from 'node:module';\nconst boot = createRequire(import.meta.url)('../zlib-standalone-napi.native.cjs');\n";
    const complete = packageDir(manifest, {
        'dist/node/napi.mjs': entry,
        'dist/node/napi.d.mts': 'export {};',
        'dist/zlib-standalone-napi.native.cjs': '',
        ...licenseFiles(manifest.name),
    });
    const empty = packageDir(manifest, licenseFiles(manifest.name));
    const untyped = packageDir(manifest, { 'dist/node/napi.mjs': entry, 'dist/zlib-standalone-napi.native.cjs': '', ...licenseFiles(manifest.name) });
    const noLoader = packageDir(manifest, { 'dist/node/napi.mjs': entry, 'dist/node/napi.d.mts': 'export {};', ...licenseFiles(manifest.name) });

    assert.deepEqual(nodePackageProblems(complete), []);
    assert.match(nodePackageProblems(empty).join('\n'), /dist\/node\/napi\.mjs is missing/);
    assert.match(nodePackageProblems(untyped).join('\n'), /napi\.d\.mts/);
    assert.match(nodePackageProblems(noLoader).join('\n'), /zlib-standalone-napi\.native\.cjs/);
    for (const dir of [complete, empty, untyped, noLoader]) fs.rmSync(dir, { recursive: true, force: true });
});

test('a node runner stages the addons it built of the multi-platform library, and one runner their loader and entry', () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-stage-node-'));
    const packageRoot = path.join(work, 'examples/lib-prebuilt-matrix');
    const files = [
        'm.linux-x64.node',
        'm.win32-x64.node',
        'm.native.cjs',
        'node/napi.mjs',
        'node/napi.d.mts',
        'node/wasm.mjs',
        'prebuilt/linux-x64-mt-release/lib/libm.a',
    ];
    files.forEach((file) => {
        fs.mkdirSync(path.dirname(path.join(packageRoot, 'dist', file)), { recursive: true });
        fs.writeFileSync(path.join(packageRoot, 'dist', file), file);
    });
    const staged = (runner) =>
        fs
            .readdirSync(path.join(work, runner, 'dist'), { recursive: true })
            .filter((file) => path.extname(file))
            .sort();

    stageNodeOutputs({ packageRoot, stagingRoot: path.join(work, 'node'), withEntry: true });
    stageNodeOutputs({ packageRoot, stagingRoot: path.join(work, 'node-macos'), withEntry: false });

    assert.deepEqual(staged('node'), [
        'm.linux-x64.node',
        'm.native.cjs',
        'm.win32-x64.node',
        path.join('node', 'napi.d.mts'),
        path.join('node', 'napi.mjs'),
    ]);
    assert.deepEqual(staged('node-macos'), ['m.linux-x64.node', 'm.win32-x64.node']);
    fs.rmSync(path.join(packageRoot, 'dist', 'm.linux-x64.node'));
    fs.rmSync(path.join(packageRoot, 'dist', 'm.win32-x64.node'));
    assert.throws(() => stageNodeOutputs({ packageRoot, stagingRoot: path.join(work, 'empty'), withEntry: true }), /no addon/);
    fs.rmSync(work, { recursive: true, force: true });
});
