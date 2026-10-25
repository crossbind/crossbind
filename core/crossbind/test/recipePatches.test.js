import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyRecipePatches, refreshPatchedSource, writePatchedSourceStamp } from '../src/utils/recipePatches.js';
import { getSourceFingerprint } from '../src/utils/sourceFingerprint.js';
import { getContentHash } from '../src/utils/hash.js';

const patchText = (from, to) => [
    'Upstream: https://example.invalid/commit/1',
    '',
    'diff --git a/lib.c b/lib.c',
    '--- a/lib.c',
    '+++ b/lib.c',
    '@@ -1,3 +1,3 @@',
    ' int f(void) {',
    `-    return ${from};`,
    `+    return ${to};`,
    ' }',
    '',
].join('\n');
const PATCH = patchText(1, 2);

let dir;
let buildPath;

beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-patches-')));
    buildPath = path.join(dir, 'build');
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

// As downloadAndExtractFile does, the whole tree is replaced.
function extract(body = '    return 1;') {
    const sourcePath = path.join(buildPath, 'source');
    fs.rmSync(sourcePath, { recursive: true, force: true });
    fs.mkdirSync(sourcePath, { recursive: true });
    fs.writeFileSync(path.join(sourcePath, 'lib.c'), `int f(void) {\n${body}\n}\n`);
    return sourcePath;
}

function patchFile(name = 'fix.patch', content = PATCH) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
}

const read = (sourcePath) => fs.readFileSync(path.join(sourcePath, 'lib.c'), 'utf8');

function withEnv(values, fn) {
    const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    Object.assign(process.env, values);
    try {
        return fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

describe('applyRecipePatches', () => {
    test('applies a patch given as a path or as the file URL a recipe builds from import.meta.url', () => {
        const sourcePath = extract();
        applyRecipePatches(sourcePath, [{ file: patchFile() }]);
        expect(read(sourcePath)).toContain('return 2;');

        extract();
        applyRecipePatches(sourcePath, [{ file: pathToFileURL(patchFile('url.patch')) }]);
        expect(read(sourcePath)).toContain('return 2;');
    });

    test('refuses a patch the source does not match, names it, and leaves the source as it was', () => {
        const sourcePath = extract('    return 3;');
        expect(() => applyRecipePatches(sourcePath, [{ file: patchFile() }])).toThrow(/fix\.patch does not apply/);
        expect(read(sourcePath)).toContain('return 3;');
    });

    test('applies every patch, in order', () => {
        const sourcePath = extract();
        applyRecipePatches(sourcePath, [{ file: patchFile() }, { file: patchFile('next.patch', patchText(2, 3)) }]);
        expect(read(sourcePath)).toContain('return 3;');
    });

    test('applies to the extracted source even when it sits inside another git checkout', () => {
        execFileSync('git', ['init', '-q'], { cwd: dir });
        const sourcePath = extract();
        applyRecipePatches(sourcePath, [{ file: patchFile() }]);
        expect(read(sourcePath)).toContain('return 2;');
    });

    test('never takes the repository a downloaded tree carries, whose filters would run on the host', () => {
        const sourcePath = extract();
        const ran = path.join(dir, 'filter-ran');
        execFileSync('git', ['init', '-q'], { cwd: sourcePath });
        execFileSync('git', ['config', 'filter.planted.clean', `touch "${ran}"; cat`], { cwd: sourcePath });
        fs.writeFileSync(path.join(sourcePath, '.gitattributes'), '*.c filter=planted\n');
        applyRecipePatches(sourcePath, [{ file: patchFile() }]);
        expect(read(sourcePath)).toContain('return 2;');
        expect(fs.existsSync(ran)).toBe(false);
    });

    test('reads a patch path that starts with a dash as a file, not an option', () => {
        const sourcePath = extract();
        fs.writeFileSync(path.join(sourcePath, '--odd.patch'), PATCH);
        applyRecipePatches(sourcePath, [{ file: '--odd.patch' }]);
        expect(read(sourcePath)).toContain('return 2;');
    });

    test('keeps the line endings of the source where git would convert them, as Git for Windows does', () => {
        const sourcePath = extract();
        const home = path.join(dir, 'home');
        fs.mkdirSync(home);
        fs.writeFileSync(path.join(home, '.gitconfig'), '[core]\n\tautocrlf = true\n');
        withEnv({ HOME: home, XDG_CONFIG_HOME: home }, () => applyRecipePatches(sourcePath, [{ file: patchFile() }]));
        expect(read(sourcePath)).toBe('int f(void) {\n    return 2;\n}\n');
    });

    test('never takes a repository from the environment, as a git hook running the build passes on, which would skip the patch', () => {
        const sourcePath = extract();
        execFileSync('git', ['init', '-q'], { cwd: dir });
        withEnv({ GIT_DIR: path.join(dir, '.git'), GIT_WORK_TREE: dir }, () => applyRecipePatches(sourcePath, [{ file: patchFile() }]));
        expect(read(sourcePath)).toContain('return 2;');
    });

    test('does nothing for a recipe without patches', () => {
        const sourcePath = extract();
        applyRecipePatches(sourcePath, undefined);
        expect(read(sourcePath)).toContain('return 1;');
    });
});

describe('the source fingerprint and the extracted tree follow the patches', () => {
    const configWith = (patches) => ({ package: { nativeVersion: '1.0.0' }, build: { sha256: 'a'.repeat(64), patches } });

    test('a recipe without patches keeps the fingerprint it had before patches existed', () => {
        const before = getContentHash(JSON.stringify({ nativeVersion: '1.0.0', sha256: 'a'.repeat(64) }));
        expect(getSourceFingerprint(configWith([]))).toBe(before);
        expect(getSourceFingerprint(configWith(undefined))).toBe(before);
    });

    test('adding a patch or editing one changes the fingerprint', () => {
        const file = patchFile();
        const patched = configWith([{ file }]);
        const before = getSourceFingerprint(patched);
        expect(before).not.toBe(getSourceFingerprint(configWith([])));
        fs.appendFileSync(file, '\n');
        expect(getSourceFingerprint(patched)).not.toBe(before);
    });

    test('a tree extracted under other patches is dropped so it is extracted and patched again', () => {
        const patches = [{ file: patchFile() }];
        const sourcePath = extract();
        refreshPatchedSource(buildPath, patches);
        expect(fs.existsSync(sourcePath)).toBe(false);

        extract();
        writePatchedSourceStamp(buildPath, patches);
        refreshPatchedSource(buildPath, patches);
        expect(fs.existsSync(sourcePath)).toBe(true);

        fs.appendFileSync(patches[0].file, '\n');
        refreshPatchedSource(buildPath, patches);
        expect(fs.existsSync(sourcePath)).toBe(false);
    });

    test('a tree a patch failed on is extracted again on the next run, whatever the tree before it was stamped with', () => {
        const patches = [{ file: patchFile() }];
        const sourcePath = extract();
        applyRecipePatches(sourcePath, patches);
        writePatchedSourceStamp(buildPath, patches);

        // A release the patch no longer fits replaces the tree; the build stops before the stamp is written.
        extract('    return 3;');
        expect(() => applyRecipePatches(sourcePath, patches)).toThrow(/does not apply/);
        refreshPatchedSource(buildPath, patches);
        expect(fs.existsSync(sourcePath)).toBe(false);
    });

    test('dropping every patch restores the upstream tree, and a never-patched tree stays', () => {
        const patches = [{ file: patchFile() }];
        extract();
        writePatchedSourceStamp(buildPath, patches);
        refreshPatchedSource(buildPath, []);
        expect(fs.existsSync(path.join(buildPath, 'source'))).toBe(false);

        const plain = extract();
        writePatchedSourceStamp(buildPath, []);
        refreshPatchedSource(buildPath, undefined);
        expect(fs.existsSync(plain)).toBe(true);
    });
});
