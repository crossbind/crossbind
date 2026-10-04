import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { hostAddonTarget, packument, readTarballManifest, tarballEntry } from '../../lib/node-registry.mjs';

function tarball(manifest) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-registry-'));
    fs.mkdirSync(path.join(work, 'package'));
    fs.writeFileSync(path.join(work, 'package', 'README.md'), 'readme');
    fs.writeFileSync(path.join(work, 'package', 'package.json'), JSON.stringify(manifest));
    execFileSync('tar', ['-czf', path.join(work, 'package.tgz'), '-C', work, 'package']);
    return path.join(work, 'package.tgz');
}

const addon = { name: '@crossbind/port-zlib-node-linuxmusl-x64', version: '2.0.0-beta.63', os: ['linux'], cpu: ['x64'], libc: ['musl'] };

test('reads the manifest a package tarball carries without a tar program', () => {
    const file = tarball(addon);

    assert.deepEqual(readTarballManifest(file), addon);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('a packument keeps the platform fields npm picks an addon by and points at the tarball through the asking host', () => {
    const file = tarball(addon);
    const entry = tarballEntry(file);

    const document = packument(entry, '127.0.0.1:4873');

    assert.deepEqual(document['dist-tags'], { latest: addon.version });
    const version = document.versions[addon.version];
    assert.deepEqual([version.os, version.cpu, version.libc], [['linux'], ['x64'], ['musl']]);
    assert.equal(version.dist.tarball, 'http://127.0.0.1:4873/-/tarballs/package.tgz');
    assert.match(version.dist.integrity, /^sha512-/);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('the addon a host installs is named by its platform, with musl Linux apart from glibc', () => {
    assert.equal(hostAddonTarget({ header: { glibcVersionRuntime: '2.39' } }, 'linux', 'x64'), 'linux-x64');
    assert.equal(hostAddonTarget({ header: {} }, 'linux', 'arm64'), 'linuxmusl-arm64');
    assert.equal(hostAddonTarget({ header: {} }, 'darwin', 'arm64'), 'darwin-arm64');
    assert.equal(hostAddonTarget({ header: {} }, 'win32', 'x64'), 'win32-x64');
});
