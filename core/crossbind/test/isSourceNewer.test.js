import {
    describe, test, expect, beforeEach, afterEach, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeNativeSourceStamp } from '../src/utils/nativeSourceStamp.js';

// state resolves the project config at import time; feed paths through a holder instead.
const holder = { native: [], build: '' };
vi.mock('../src/state/index.js', () => ({
    default: { config: { paths: { get native() { return holder.native; }, get build() { return holder.build; } } } },
}));

const OLD = new Date('2026-01-01T00:00:00Z');
const NEW = new Date('2026-06-01T00:00:00Z');

let work;

async function importFresh() {
    vi.resetModules();
    const mod = await import('../src/actions/isSourceNewer.js');
    return { isSourceNewer: mod.default, isNativeSourceNewerThan: mod.isNativeSourceNewerThan };
}

function writeAt(file, when) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    fs.utimesSync(file, when, when);
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-source-newer-'));
    holder.native = [path.join(work, 'native')];
    holder.build = path.join(work, 'build');
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('isSourceNewer', () => {
    test('false when the artifact does not exist yet', async () => {
        const { isSourceNewer } = await importFresh();
        writeAt(path.join(work, 'native/a.cpp'), NEW);
        expect(isSourceNewer({ jsName: 'out.js' })).toBe(false);
    });

    test('true when a native source is newer than the built js', async () => {
        const { isSourceNewer } = await importFresh();
        writeAt(path.join(work, 'build/out.js'), OLD);
        writeAt(path.join(work, 'native/deep/a.h'), NEW);
        expect(isSourceNewer({ jsName: 'out.js' })).toBe(true);
    });

    test('false when the built js is newer than every source', async () => {
        const { isSourceNewer } = await importFresh();
        writeAt(path.join(work, 'native/a.cpp'), OLD);
        writeAt(path.join(work, 'build/out.js'), NEW);
        writeNativeSourceStamp(path.join(work, 'build/out.js'), holder.native);
        expect(isSourceNewer({ jsName: 'out.js' })).toBe(false);
    });

    test('rebuilds after a source is deleted, even though the remaining files are older', async () => {
        const { isSourceNewer } = await importFresh();
        const source = path.join(work, 'native/removed.cpp');
        const artifact = path.join(work, 'build/out.js');
        writeAt(source, OLD);
        writeAt(artifact, NEW);
        writeNativeSourceStamp(artifact, holder.native);
        fs.unlinkSync(source);

        expect(isSourceNewer({ jsName: 'out.js' })).toBe(true);
    });

    test('rebuilds once when an older build has no source inventory', async () => {
        const { isSourceNewer } = await importFresh();
        writeAt(path.join(work, 'native/a.cpp'), OLD);
        writeAt(path.join(work, 'build/out.js'), NEW);

        expect(isSourceNewer({ jsName: 'out.js' })).toBe(true);
    });
});

describe('isNativeSourceNewerThan (directory artifact)', () => {
    test('true when sources are newer than the staged prebuilt dir', async () => {
        const { isNativeSourceNewerThan } = await importFresh();
        const libDir = path.join(work, 'dist/prebuilt/wasm/lib');
        writeAt(path.join(libDir, 'libx.a'), OLD);
        writeAt(path.join(work, 'native/a.cpp'), NEW);
        expect(isNativeSourceNewerThan(libDir)).toBe(true);
    });

    test('false when the staged prebuilt dir is newer than every source', async () => {
        const { isNativeSourceNewerThan } = await importFresh();
        const libDir = path.join(work, 'dist/prebuilt/wasm/lib');
        writeAt(path.join(work, 'native/a.cpp'), OLD);
        writeAt(path.join(libDir, 'libx.a'), NEW);
        writeNativeSourceStamp(libDir, holder.native);
        expect(isNativeSourceNewerThan(libDir)).toBe(false);
    });

    test('false when the artifact dir is missing', async () => {
        const { isNativeSourceNewerThan } = await importFresh();
        writeAt(path.join(work, 'native/a.cpp'), NEW);
        expect(isNativeSourceNewerThan(path.join(work, 'dist/nope'))).toBe(false);
    });
});
