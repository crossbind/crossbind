import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The markers back bare crate imports (`import { Uuid } from 'cargo:uuid'`). Metro resolves
// against the file map it builds at startup, so a marker first written mid-resolution is
// invisible to that very build - they have to exist by the time the state module has loaded.
const h = vi.hoisted(() => ({ config: null }));

vi.mock('../src/state/loadConfig.js', () => ({
    default: async () => h.config,
    getFilledConfig: (c) => c,
}));

let tmpDir;

const loadStateModule = async (cargoDependencies, project = undefined) => {
    h.config = {
        system: {},
        general: { name: 'app' },
        paths: { cache: tmpDir, project },
        cargoDependencies,
        allDependencies: [],
    };
    vi.resetModules();
    return import('../src/state/index.js');
};

const markerPath = (name) => path.join(tmpDir, 'rust-crates', `${name}.rs`);

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cargo-markers-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('cargo crate import markers', () => {
    test('writes one marker per declared crate before the bundler can resolve', async () => {
        await loadStateModule({ uuid: '1', regex: '1' });

        expect(fs.readFileSync(markerPath('uuid'), 'utf8')).toContain('crossbind cargo crate import marker: uuid');
        expect(fs.existsSync(markerPath('regex'))).toBe(true);
    });

    test('leaves an existing marker untouched', async () => {
        // Rewriting would bump the mtime on every load and invalidate the bridge caches keyed
        // on it, forcing a rebuild of every crate on every run.
        fs.mkdirSync(path.dirname(markerPath('uuid')), { recursive: true });
        fs.writeFileSync(markerPath('uuid'), '// edited by hand\n');

        await loadStateModule({ uuid: '1' });

        expect(fs.readFileSync(markerPath('uuid'), 'utf8')).toBe('// edited by hand\n');
    });

    test('writes nothing when the project declares no crates', async () => {
        await loadStateModule(undefined);

        expect(fs.existsSync(path.join(tmpDir, 'rust-crates'))).toBe(false);
    });

    test('writes a marker for each module import of a declared crate in the app sources', async () => {
        const project = path.join(tmpDir, 'app');
        const write = (file, text) => {
            fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
            fs.writeFileSync(path.join(project, file), text);
        };
        write('src/App.tsx', "import { xxh364 } from 'cargo:xxhash-rust/xxh3';\nimport { Other } from 'cargo:undeclared/part';\n");
        write('node_modules/dep/index.js', "import 'cargo:xxhash-rust/xxh64';\n");
        write('.crossbind/old.js', "import 'cargo:xxhash-rust/const_xxh3';\n");

        await loadStateModule({ 'xxhash-rust': '0.8' }, project);

        expect(fs.existsSync(markerPath('xxhash-rust.xxh3'))).toBe(true);
        expect(fs.existsSync(markerPath('undeclared.part'))).toBe(false);
        expect(fs.existsSync(markerPath('xxhash-rust.xxh64'))).toBe(false);
        expect(fs.existsSync(markerPath('xxhash-rust.const_xxh3'))).toBe(false);
    });
});
