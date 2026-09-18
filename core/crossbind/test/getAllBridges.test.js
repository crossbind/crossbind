import {
    describe, test, expect, beforeEach, afterEach, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// state resolves the project config at import time; the tests only need paths.build.
const holder = { build: '' };
vi.mock('../src/state/index.js', () => ({ default: { config: { paths: { get build() { return holder.build; } } } } }));

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

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridges-'));
    holder.build = path.join(work, 'build');
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

    test('leaves bridges without a sidecar alone (pre-sidecar output)', async () => {
        const bridge = addBridge('legacy');
        const getAllBridges = await importFresh();

        expect(getAllBridges(() => {})).toEqual([bridge.replaceAll(path.sep, '/')]);
        expect(fs.existsSync(bridge)).toBe(true);
    });
});
