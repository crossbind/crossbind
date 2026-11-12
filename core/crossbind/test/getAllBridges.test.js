import {
    describe, test, expect, beforeEach, afterEach, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// state resolves the project config at import time; the tests need its paths and what it declares of its sources.
const holder = { build: '', cache: '', packages: {} };
vi.mock('../src/state/index.js', () => ({
    default: {
        config: {
            paths: { get build() { return holder.build; }, get cache() { return holder.cache; } },
            get packages() { return holder.packages; },
        },
    },
}));

let work;

async function importFresh() {
    vi.resetModules();
    const { default: getAllBridges } = await import('../src/actions/getAllBridges.js');
    return getAllBridges;
}

function addBridge(stem, { source } = {}) {
    const bridge = path.join(holder.build, 'bridge', `${stem}.i.cpp`);
    fs.mkdirSync(path.dirname(bridge), { recursive: true });
    fs.writeFileSync(bridge, `// bridge for ${stem}\n`);
    fs.writeFileSync(`${bridge}.exports.json`, '[]');
    if (source) fs.writeFileSync(`${bridge}.source`, `${source}\n`);
    return bridge;
}

// A header as a package source's stage holds it, by the path a bridge's sidecar records.
function stagedHeader(source, name, header) {
    const file = `${holder.cache}/${source}/packages/${name}/dist/prebuilt/ios-iphonesimulator-mt-release/include/${header}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '// a staged header\n');
    return file;
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridges-'));
    holder.build = path.join(work, 'build');
    holder.cache = path.join(work, '.crossbind').replaceAll(path.sep, '/');
    holder.packages = { conan: {} };
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('getAllBridges', () => {
    test('keeps a bridge whose recorded header still exists', async () => {
        const header = path.join(work, 'native.h');
        fs.writeFileSync(header, 'class Native {};\n');
        const bridge = addBridge('native', { source: header });
        const getAllBridges = await importFresh();

        expect(getAllBridges(() => {})).toEqual([bridge.replaceAll(path.sep, '/')]);
        expect(fs.existsSync(bridge)).toBe(true);
    });

    test('prunes a bridge whose recorded header is gone, with its sidecars', async () => {
        const bridge = addBridge('deleted', { source: path.join(work, 'deleted.h') });
        fs.writeFileSync(`${bridge}.deps`, '');
        const log = vi.fn();
        const getAllBridges = await importFresh();

        expect(getAllBridges(log)).toEqual([]);
        expect(fs.existsSync(bridge)).toBe(false);
        expect(fs.existsSync(`${bridge}.exports.json`)).toBe(false);
        expect(fs.existsSync(`${bridge}.source`)).toBe(false);
        expect(fs.existsSync(`${bridge}.deps`)).toBe(false);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('deleted.i.cpp'));
    });

    // A package source's stage outlives the declaration: the header is still there, but its package's include
    // directory is off the compile, so the bridge would stop every build that compiles the cached ones.
    test('prunes a bridge of a header whose package the project no longer declares, and keeps one it declares', async () => {
        const declared = addBridge('zlib', { source: stagedHeader('conan', 'zlib', 'zlib.h') });
        const header = stagedHeader('conan', 'lz4', 'lz4.h');
        const bridge = addBridge('lz4', { source: header });
        holder.packages = { conan: { zlib: { version: '1.3.2', options: {} } } };
        const log = vi.fn();
        const getAllBridges = await importFresh();

        expect(getAllBridges(log)).toEqual([declared.replaceAll(path.sep, '/')]);
        expect(fs.existsSync(bridge)).toBe(false);
        expect(fs.existsSync(`${bridge}.source`)).toBe(false);
        expect(fs.existsSync(header)).toBe(true);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("crossbind: pruned stale bridge 'lz4.i.cpp' - packages.conan no longer declares lz4");
    });

    // Its stage is left as well, and no source of that name tells whose it was.
    test('prunes a bridge of a header from a package source the project no longer has', async () => {
        const bridge = addBridge('core', { source: stagedHeader('vcpkg', 'fmt', 'fmt/core.h') });
        const log = vi.fn();
        const getAllBridges = await importFresh();

        expect(getAllBridges(log)).toEqual([]);
        expect(fs.existsSync(bridge)).toBe(false);
        expect(log).toHaveBeenCalledWith("crossbind: pruned stale bridge 'core.i.cpp' - packages.vcpkg no longer declares fmt");
    });

    // Only a stage's own layout reads as one: a header elsewhere in the cache, or beside it, stays.
    test('keeps a bridge of a header that lies in no stage', async () => {
        const inCache = `${holder.cache}/build/generated/native.h`;
        fs.mkdirSync(path.dirname(inCache), { recursive: true });
        fs.writeFileSync(inCache, 'class Native {};\n');
        const bridge = addBridge('native', { source: inCache });
        const getAllBridges = await importFresh();

        expect(getAllBridges(() => {})).toEqual([bridge.replaceAll(path.sep, '/')]);
    });

    test('leaves bridges without a sidecar alone (pre-sidecar output)', async () => {
        const bridge = addBridge('legacy');
        const getAllBridges = await importFresh();

        expect(getAllBridges(() => {})).toEqual([bridge.replaceAll(path.sep, '/')]);
        expect(fs.existsSync(bridge)).toBe(true);
    });
});
