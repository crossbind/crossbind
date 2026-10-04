import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { parseConanImport, conanImportOfHeader } from '../src/utils/conanImport.js';
import { writeConanManifest } from '../src/utils/conanStage.js';
import { conanDependenciesKey } from '../src/utils/conanDependencies.js';
import { getFilledConfig } from '../src/state/loadConfig.js';
import refreshConanDependencies from '../src/state/refreshConanDependencies.js';

const HEADERS = ['h', 'hpp', 'hxx', 'hh'];

const h = vi.hoisted(() => ({ config: null }));
vi.mock('../src/state/index.js', () => ({ default: { get config() { return h.config; }, targets: [] } }));

describe('conan import specifiers', () => {
    test('names a package and a header under its include directory', () => {
        expect(parseConanImport('conan:zlib/zlib.h', HEADERS)).toEqual({ name: 'zlib', header: 'zlib.h' });
        expect(parseConanImport('conan:libxml2/libxml/parser.h', HEADERS)).toEqual({ name: 'libxml2', header: 'libxml/parser.h' });
    });

    test('refuses a package with no header, naming the form to write', () => {
        expect(() => parseConanImport('conan:zlib', HEADERS)).toThrow(/conan:zlib\/<header>/);
    });

    test('refuses a name Conan would not accept', () => {
        for (const bad of ['conan:ZLib/zlib.h', 'conan:/zlib.h', 'conan:z lib/zlib.h']) {
            expect(() => parseConanImport(bad, HEADERS), bad).toThrow(/Conan package name/);
        }
    });

    test('refuses a header path that could leave the include directory', () => {
        for (const bad of ['conan:zlib/../x.h', 'conan:zlib/./zlib.h', 'conan:zlib//zlib.h', 'conan:zlib/.hidden.h', 'conan:zlib/a\\b.h']) {
            expect(() => parseConanImport(bad, HEADERS), bad).toThrow(/header path/);
        }
    });

    test('refuses a file that is not a header', () => {
        expect(() => parseConanImport('conan:zlib/zlib.c', HEADERS)).toThrow(/\.h, \.hpp/);
        expect(() => parseConanImport('conan:zlib/README', HEADERS)).toThrow(/\.h, \.hpp/);
    });

    test('maps a staged header back to the import that names it', () => {
        const cache = '/app/.crossbind';
        expect(conanImportOfHeader(`${cache}/conan/packages/libxml2/dist/prebuilt/wasm-wasm32-st-release/include/libxml/parser.h`, cache))
            .toEqual({ name: 'libxml2', header: 'libxml/parser.h' });
        expect(conanImportOfHeader('/app/src/native/zlib.h', cache)).toBeNull();
        expect(conanImportOfHeader(`${cache}/conan/types/zlib/dist/prebuilt/wasm-wasm32-st-release/include/zlib.h`, cache)).toBeNull();
        // The import becomes a module name in the generated types.
        expect(conanImportOfHeader(`${cache}/conan/packages/zlib/dist/prebuilt/wasm-wasm32-st-release/include/x'; declare const y: any; '.h`, cache))
            .toBeNull();
    });
});

describe('getDependFilePath for conan imports', () => {
    const TARGET = { platform: 'wasm', path: 'wasm-wasm32-st-release', releasePath: 'wasm-wasm32-st-release' };
    let work;
    const stage = () => upath.join(work, 'app', '.crossbind', 'conan');
    const header = () => upath.join(stage(), 'packages', 'zlib', 'dist', 'prebuilt', TARGET.path, 'include', 'zlib.h');
    const loadConfig = () => getFilledConfig({ paths: { project: upath.join(work, 'app') }, conanDependencies: { zlib: '1.3.2' } });

    function stageZlib(config) {
        fs.mkdirSync(upath.dirname(header()), { recursive: true });
        fs.writeFileSync(header(), '');
        fs.writeFileSync(upath.join(stage(), 'packages', 'zlib', 'dist', 'prebuilt', 'CMakeLists.txt'), '');
        writeConanManifest(stage(), TARGET.path, {
            key: conanDependenciesKey(config.conanDependencies),
            packages: [{
                name: 'zlib', version: '1.3.2', ref: 'zlib/1.3.2', license: 'Zlib', libs: ['z'], requires: [],
            }],
        });
    }

    beforeEach(() => {
        work = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conan-import-')));
        fs.mkdirSync(upath.join(work, 'app'), { recursive: true });
        fs.writeFileSync(upath.join(work, 'app', 'package.json'), JSON.stringify({ name: 'conan-import-app', version: '0.0.0' }));
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

        expect(() => getDependFilePath('conan:libpng/png.h', TARGET)).toThrow(/add 'libpng' to conanDependencies/);
    });

    test('a declared package that is not staged yet says when crossbind installs it', async () => {
        h.config = loadConfig();
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');

        expect(() => getDependFilePath('conan:zlib/zlib.h', TARGET)).toThrow(/installs Conan packages when a build starts/);
    });

    test('packages staged after state loaded are picked up, as a Metro server needs', async () => {
        h.config = loadConfig();
        // What state does when it loads, before any build staged a package.
        refreshConanDependencies(h.config);
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
});
