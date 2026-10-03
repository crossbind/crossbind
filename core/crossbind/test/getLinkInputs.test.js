import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { state, appRustLibs } = vi.hoisted(() => ({ state: { config: {} }, appRustLibs: { current: [] } }));

vi.mock('../src/actions/getDependLibs.js', () => ({ default: () => ['/deps/libz.a'] }));
vi.mock('../src/utils/appRustCrates.js', () => ({ default: () => appRustLibs.current }));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: getLinkInputs } = await import('../src/actions/getLinkInputs.js');

const target = { buildType: 'release', path: 'darwin-arm64-mt-release' };
const keepFlag = (name) => `KEEP:${name}`;

describe('getLinkInputs', () => {
    let work;

    const cargoDep = (name, libRs) => {
        const project = `${work}/${name}`;
        fs.mkdirSync(`${project}/crate/src`, { recursive: true });
        fs.writeFileSync(`${project}/crate/src/lib.rs`, libRs);
        return { export: { type: 'cargo', libName: [name] }, paths: { project } };
    };

    const withDepends = (depends) => {
        state.config.dependencyParameters = { getCmakeDepends: () => depends };
    };

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-linkinputs-'));
        state.config = {
            export: {},
            general: { name: 'demo' },
            paths: { build: work, output: `${work}/out`, cache: `${work}/cache` },
            cargoDependencies: {},
        };
        withDepends([]);
        appRustLibs.current = [];
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('ends with the project archive and its bridge, and wraps nothing else by default', () => {
        const inputs = getLinkInputs(target, { keepFlag });

        expect(inputs.libs).toEqual([
            '/deps/libz.a',
            `${work}/Source-Release/darwin-arm64-mt-release/libdemo.a`,
            `${work}/Bridge-Release/darwin-arm64-mt-release/libdemo.a`,
        ]);
        expect(inputs.wholeArchiveAll).toBe(false);
        expect([...inputs.wholeArchiveNames]).toEqual([]);
        expect(inputs.rustKeepFlags).toEqual([]);
        expect(inputs.hasRust).toBe(false);
    });

    // A native executable binds nothing, so there is no bridge archive to link.
    test('can end with the project archive alone', () => {
        const inputs = getLinkInputs(target, { keepFlag, withBridge: false });

        expect(inputs.libs).toEqual([
            '/deps/libz.a',
            `${work}/Source-Release/darwin-arm64-mt-release/libdemo.a`,
        ]);
    });

    test('links the installed project archive when the build tree was cleaned', () => {
        const installed = `${work}/out/prebuilt/darwin-arm64-mt-release/lib/libdemo.a`;
        fs.mkdirSync(path.dirname(installed), { recursive: true });
        fs.writeFileSync(installed, '');

        expect(getLinkInputs(target, { keepFlag }).libs[1]).toBe(installed);
    });

    test('keeps what the project and its dependencies ask to keep whole', () => {
        state.config.export.wholeArchive = true;
        withDepends([{ export: { wholeArchive: true, libName: ['gdal', 'proj'] }, paths: {} }]);

        const inputs = getLinkInputs(target, { keepFlag });

        expect(inputs.wholeArchiveAll).toBe(true);
        expect([...inputs.wholeArchiveNames]).toEqual(['gdal', 'proj']);
    });

    test('pins generated cargo bridges by symbol and loads hand-written ones whole', () => {
        withDepends([
            cargoDep('generated', 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n'),
            cargoDep('manual', 'embind_rs::bindings! {}\n'),
        ]);

        const inputs = getLinkInputs(target, { keepFlag });

        expect(inputs.rustKeepFlags).toEqual(['KEEP:generated']);
        expect([...inputs.wholeArchiveNames]).toEqual(['manual']);
        expect(inputs.hasRust).toBe(true);
    });

    test('loads the app super-crate whole, ahead of the project archive', () => {
        appRustLibs.current = [`${work}/cache/libcrossbind_app_super.a`];

        const inputs = getLinkInputs(target, { keepFlag });

        expect(inputs.libs[1]).toBe(`${work}/cache/libcrossbind_app_super.a`);
        expect(inputs.appRustLibs).toEqual([`${work}/cache/libcrossbind_app_super.a`]);
        expect([...inputs.wholeArchiveNames]).toEqual(['crossbind_app_super']);
        expect(inputs.hasRust).toBe(true);
    });
});
