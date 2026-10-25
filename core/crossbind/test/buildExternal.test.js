import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const holder = { config: null };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() { return holder.config; },
        set config(v) { holder.config = v; },
        targets: [],
    },
}));
vi.mock('../src/actions/buildLib.js', () => ({ default: vi.fn() }));

// What each upstream release extracts to, keyed by its archive.
const RELEASES = {
    'demo-1.0.tar.gz': 'int f(void) {\n    return 1;\n}\n',
    'demo-2.0.tar.gz': 'int f(void) {\n    return 3;\n}\n',
};

const extractions = { count: 0 };

// downloadAndExtractFile as far as buildExternal sees it: a tree is kept while it came from the same archive.
vi.mock('../src/utils/downloadAndExtractFile.js', async (importOriginal) => ({
    ...(await importOriginal()),
    default: vi.fn(async (urls, output) => {
        const archive = path.basename([urls].flat()[0]);
        const marker = `${output}/source.archive`;
        if (fs.existsSync(`${output}/source`) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === archive) return false;
        extractions.count += 1;
        fs.rmSync(`${output}/source`, { recursive: true, force: true });
        fs.mkdirSync(`${output}/source`, { recursive: true });
        fs.writeFileSync(`${output}/source/lib.c`, RELEASES[archive]);
        fs.writeFileSync(marker, archive);
        return true;
    }),
}));

const { default: buildExternal } = await import('../src/actions/buildExternal.js');
const { default: buildLib } = await import('../src/actions/buildLib.js');

const PATCH = [
    'Upstream: https://example.invalid/commit/1',
    '',
    'diff --git a/lib.c b/lib.c',
    '--- a/lib.c',
    '+++ b/lib.c',
    '@@ -1,3 +1,3 @@',
    ' int f(void) {',
    '-    return 1;',
    '+    return 2;',
    ' }',
    '',
].join('\n');

let dir;

beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-build-external-')));
    fs.writeFileSync(path.join(dir, 'fix.patch'), PATCH);
    vi.mocked(buildLib).mockClear();
    extractions.count = 0;
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

function release(nativeVersion, build = {}) {
    holder.config = {
        general: { name: 'demo' },
        package: { nativeVersion },
        build: {
            getURL: (version) => `https://example.invalid/demo-${version}.tar.gz`,
            patches: [{ file: path.join(dir, 'fix.patch') }],
            ...build,
        },
        paths: { build: path.join(dir, 'build'), project: dir, output: path.join(dir, 'dist') },
    };
}

const source = () => fs.readFileSync(path.join(dir, 'build', 'source', 'lib.c'), 'utf8');

describe('buildExternal applies the recipe patches', () => {
    test('before replaceList, so crossbind edits the source as patched', async () => {
        release('1.0', { replaceList: [{ regex: 'return 2;', replacement: 'return 4;', paths: ['lib.c'] }] });
        await buildExternal({});
        expect(source()).toContain('return 4;');
        expect(buildLib).toHaveBeenCalledTimes(1);
    });

    test('once: the next build of the same release keeps the patched tree', async () => {
        release('1.0');
        await buildExternal({});
        await buildExternal({});
        expect(source()).toContain('return 2;');
        expect(extractions.count).toBe(1);
        expect(buildLib).toHaveBeenCalledTimes(2);
    });

    test('again after a patch that failed is restored, as an edit undone or a branch switched back leaves it', async () => {
        release('1.0');
        await buildExternal({});
        fs.writeFileSync(path.join(dir, 'fix.patch'), PATCH.replace('-    return 1;', '-    return 9;'));
        await expect(buildExternal({})).rejects.toThrow(/fix\.patch does not apply/);

        fs.writeFileSync(path.join(dir, 'fix.patch'), PATCH);
        await buildExternal({});
        expect(source()).toContain('return 2;');
    });

    test('and a release they no longer fit stops every build, not only the first', async () => {
        release('1.0');
        await buildExternal({});
        expect(source()).toContain('return 2;');

        release('2.0');
        await expect(buildExternal({})).rejects.toThrow(/fix\.patch does not apply/);
        await expect(buildExternal({})).rejects.toThrow(/fix\.patch does not apply/);
        expect(buildLib).toHaveBeenCalledTimes(1);
    });
});
