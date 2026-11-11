import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    PACKAGES, bindingOf, configSource, packagesFor,
} from '../compiler/packages.js';
import { getFilledConfig } from '../../../core/crossbind/src/state/loadConfig.js';

test('every package has a unique id, a source and one way to be used', () => {
    const ids = PACKAGES.map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length);
    PACKAGES.forEach((pkg) => {
        assert.match(pkg.id, /^(port|crate|conan):[a-z0-9_-]+$/, pkg.id);
        assert.equal(pkg.id, `${pkg.source}:${pkg.name}`);
        assert.ok(Boolean(pkg.use.import) !== Boolean(pkg.use.include), `${pkg.id} is imported from JavaScript or included from C++`);
        assert.ok(pkg.version && pkg.summary, pkg.id);
    });
});

test('every port names the tarballs the image packs, its own among them, each pinned by integrity', () => {
    PACKAGES.filter(({ source }) => source === 'port').forEach((pkg) => {
        assert.ok(pkg.tarballs.some(({ name }) => name === pkg.package), pkg.id);
        pkg.tarballs.forEach(({ name, integrity }) => assert.match(integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, name));
    });
});

test('looks packages up by id and refuses one the image does not carry', () => {
    assert.deepEqual(packagesFor(['crate:uuid', 'port:sqlite3']).map(({ id }) => id), ['crate:uuid', 'port:sqlite3']);
    assert.throws(() => packagesFor(['port:gdal']), /port:gdal/);
});

test('the config declares the chosen packages only: ports through their own config, crates and Conan pinned', () => {
    assert.equal(configSource(['port:sqlite3', 'crate:uuid', 'conan:zlib']), [
        "import sqlite3 from '@crossbind/port-sqlite3-wasm/crossbind.config.js';",
        '',
        'export default {',
        "    general: { name: 'playground' },",
        '    dependencies: [sqlite3],',
        '    packages: {',
        '        cargo: {',
        '            uuid: \'{ version = "=1.28.0", features = ["v4"] }\',',
        '        },',
        '        conan: {',
        "            zlib: '1.3.2',",
        '        },',
        '    },',
        '    paths: { config: import.meta.url },',
        '};',
        '',
    ].join('\n'));
});

test('the config of a project without packages declares none', () => {
    assert.equal(configSource([]), "export default {\n    general: { name: 'playground' },\n    paths: { config: import.meta.url },\n};\n");
});

// The image's crossbind is this repository's, so the config a compile writes is one this loader takes.
test('crossbind reads the crates and the Conan packages of the config as it is written', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playground-config-'));
    try {
        const file = path.join(dir, 'crossbind.config.mjs');
        fs.writeFileSync(file, configSource(['crate:uuid', 'conan:zlib']));

        const config = getFilledConfig((await import(pathToFileURL(file).href)).default);

        assert.deepEqual(Object.keys(config.packages.cargo), ['uuid']);
        assert.deepEqual(Object.keys(config.packages.conan), ['zlib']);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('every port imports its config under a name JavaScript accepts', () => {
    PACKAGES.filter(({ source }) => source === 'port').forEach(({ name }) => assert.match(bindingOf(name), /^[A-Za-z_$][\w$]*$/, name));
});
