import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { parseSourceImport, sourceImportOfHeader, sourceOfImport } from '../src/utils/packageSourceImport.js';
import { writeSourceManifest } from '../src/utils/packageSourceStage.js';
import { dependenciesKey } from '../src/utils/packageSources.js';
import { getFilledConfig } from '../src/state/loadConfig.js';
import refreshPackageSources from '../src/state/refreshPackageSources.js';

const HEADERS = ['h', 'hpp', 'hxx', 'hh'];

const h = vi.hoisted(() => ({ config: null }));
vi.mock('../src/state/index.js', () => ({ default: { get config() { return h.config; }, targets: [] } }));

describe("a package source's import specifiers", () => {
    test('names a package and a header under its include directory', () => {
        expect(parseSourceImport('conan', 'conan:zlib/zlib.h', HEADERS)).toEqual({ name: 'zlib', header: 'zlib.h' });
        expect(parseSourceImport('conan', 'conan:libxml2/libxml/parser.h', HEADERS)).toEqual({ name: 'libxml2', header: 'libxml/parser.h' });
        expect(parseSourceImport('vcpkg', 'vcpkg:fmt/fmt/core.h', HEADERS)).toEqual({ name: 'fmt', header: 'fmt/core.h' });
    });

    test('refuses a package with no header, naming the form to write', () => {
        expect(() => parseSourceImport('conan', 'conan:zlib', HEADERS)).toThrow(/conan:zlib\/<header>/);
    });

    test('refuses a name that is no package name, naming the source', () => {
        for (const bad of ['conan:ZLib/zlib.h', 'conan:/zlib.h', 'conan:z lib/zlib.h']) {
            expect(() => parseSourceImport('conan', bad, HEADERS), bad).toThrow(/is not a conan package name; write conan:<package>\/<header>\./);
        }
    });

    test('refuses a header path that could leave the include directory', () => {
        for (const bad of ['conan:zlib/../x.h', 'conan:zlib/./zlib.h', 'conan:zlib//zlib.h', 'conan:zlib/.hidden.h', 'conan:zlib/a\\b.h']) {
            expect(() => parseSourceImport('conan', bad, HEADERS), bad).toThrow(/header path/);
        }
    });

    test('refuses a file that is not a header', () => {
        expect(() => parseSourceImport('conan', 'conan:zlib/zlib.c', HEADERS)).toThrow(/a conan: import names a header \(\.h, \.hpp/);
        expect(() => parseSourceImport('conan', 'conan:zlib/README', HEADERS)).toThrow(/\.h, \.hpp/);
    });

    test("a specifier's scheme names its source, among those the project has", () => {
        const config = { packageSources: [{ name: 'conan' }, { name: 'vcpkg' }] };

        expect(sourceOfImport(config, 'vcpkg:fmt/fmt/core.h')).toBe(config.packageSources[1]);
        expect(sourceOfImport(config, 'conan:zlib/zlib.h')).toBe(config.packageSources[0]);
        expect(sourceOfImport(config, 'cargo:uuid')).toBeUndefined();
        expect(sourceOfImport(config, './conan:zlib.h')).toBeUndefined();
    });

    test('maps a staged header back to the import that names it', () => {
        const cache = '/app/.crossbind';
        const sources = ['conan', 'vcpkg'];
        const staged = (source, rest) => `${cache}/${source}/packages/${rest}`;

        expect(sourceImportOfHeader(staged('conan', 'libxml2/dist/prebuilt/wasm-wasm32-st-release/include/libxml/parser.h'), cache, sources))
            .toEqual({ source: 'conan', name: 'libxml2', header: 'libxml/parser.h' });
        expect(sourceImportOfHeader(staged('vcpkg', 'fmt/dist/prebuilt/wasm-wasm32-st-release/include/fmt/core.h'), cache, sources))
            .toEqual({ source: 'vcpkg', name: 'fmt', header: 'fmt/core.h' });
        expect(sourceImportOfHeader('/app/src/native/zlib.h', cache, sources)).toBeNull();
        expect(sourceImportOfHeader(`${cache}/conan/types/zlib/dist/prebuilt/wasm-wasm32-st-release/include/zlib.h`, cache, sources)).toBeNull();
        // A folder of that name is no stage where the project has no such source.
        expect(sourceImportOfHeader(staged('conan', 'zlib/dist/prebuilt/wasm-wasm32-st-release/include/zlib.h'), cache, ['vcpkg'])).toBeNull();
        // The import becomes a module name in the generated types.
        expect(sourceImportOfHeader(staged('conan', "zlib/dist/prebuilt/wasm-wasm32-st-release/include/x'; declare const y: any; '.h"), cache, sources))
            .toBeNull();
    });
});

describe("getDependFilePath for a package source's imports", () => {
    const TARGET = { platform: 'wasm', path: 'wasm-wasm32-st-release', releasePath: 'wasm-wasm32-st-release' };
    let work;
    const stage = () => upath.join(work, 'app', '.crossbind', 'conan');
    const header = () => upath.join(stage(), 'packages', 'zlib', 'dist', 'prebuilt', TARGET.path, 'include', 'zlib.h');
    const loadConfig = () => getFilledConfig({ paths: { project: upath.join(work, 'app') }, packages: { conan: { zlib: '1.3.2' } } });

    function stageZlib(config) {
        fs.mkdirSync(upath.dirname(header()), { recursive: true });
        fs.writeFileSync(header(), '');
        fs.writeFileSync(upath.join(stage(), 'packages', 'zlib', 'dist', 'prebuilt', 'CMakeLists.txt'), '');
        writeSourceManifest(stage(), TARGET.path, {
            key: dependenciesKey(config.packages.conan),
            packages: [{
                name: 'zlib', version: '1.3.2', ref: 'zlib/1.3.2', license: 'Zlib', libs: ['z'], requires: [],
            }],
        });
    }

    beforeEach(() => {
        work = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-source-import-')));
        fs.mkdirSync(upath.join(work, 'app'), { recursive: true });
        fs.writeFileSync(upath.join(work, 'app', 'package.json'), JSON.stringify({ name: 'source-import-app', version: '0.0.0' }));
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('a declared package resolves to its header staged for the target', async () => {
        h.config = loadConfig();
        stageZlib(h.config);
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');

        expect(getDependFilePath('conan:zlib/zlib.h', TARGET)).toBe(header());
    });

    test('an undeclared package is refused with the key to add', async () => {
        h.config = loadConfig();
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');

        expect(() => getDependFilePath('conan:libpng/png.h', TARGET)).toThrow("crossbind: 'conan:libpng/png.h' is not declared - add 'libpng' to packages.conan in crossbind.config.");
    });

    test('a declared package that is not staged yet says when crossbind installs it', async () => {
        h.config = loadConfig();
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');

        expect(() => getDependFilePath('conan:zlib/zlib.h', TARGET)).toThrow(/declared in packages\.conan but not installed; crossbind installs conan packages when a build starts/);
    });

    test('packages staged after state loaded are picked up, as a Metro server needs', async () => {
        h.config = loadConfig();
        // What state does when it loads, before any build staged a package.
        refreshPackageSources(h.config);
        stageZlib(h.config);
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');

        expect(getDependFilePath('conan:zlib/zlib.h', TARGET)).toBe(header());
    });

    test('a header the package does not have lists where it looked', async () => {
        h.config = loadConfig();
        stageZlib(h.config);
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');

        expect(() => getDependFilePath('conan:zlib/zconf.h', TARGET)).toThrow(/has no zconf\.h[\s\S]*prebuilt\/wasm-wasm32-st-release\/include\/zconf\.h/);
    });

    test('a scheme no source of the project has is no import of one', async () => {
        h.config = loadConfig();
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');

        expect(getDependFilePath('vcpkg:fmt/fmt/core.h', TARGET)).toBeNull();
    });
});
