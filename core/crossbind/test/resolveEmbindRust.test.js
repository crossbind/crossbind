import { describe, test, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Module-level memo: each case needs a fresh module registry. Without a project path the
// consumer-resolution branches are skipped, which is what puts the monorepo fallback under test
// (with one, require.resolve answers first and the fallback never runs).
const load = async () => {
    vi.resetModules();
    vi.doMock('../src/state/index.js', () => ({ default: { config: {} } }));
    return import('../src/utils/resolveEmbindRust.js');
};

afterEach(() => {
    vi.restoreAllMocks();
});

// No package that declares it resolves, from the project or from crossbind's own folder.
const noDeclaringPackage = () => vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
    throw new Error('not installed');
});

describe('resolveEmbindRustRoot', () => {
    test("finds the package through crossbind's own extensions, which declare it, when the project names none", async () => {
        const { default: resolveEmbindRustRoot } = await load();

        const root = resolveEmbindRustRoot();

        expect(fs.existsSync(`${root}/crate/Cargo.toml`)).toBe(true);
    });

    test('falls back to the package shipped next to the engine', async () => {
        // No package to resolve it through, so the monorepo layout answers: core/embind-rust,
        // three levels up from src/utils. A wrong relative depth here fails the Rust bridge with
        // "Rust bindings need @crossbind/core-embind-rust" in a repo that has it.
        const { default: resolveEmbindRustRoot } = await load();
        noDeclaringPackage();

        const root = resolveEmbindRustRoot();

        // path.join, not a literal '/': the resolver returns native separators, so a hardcoded
        // slash passes on posix and fails on windows.
        expect(root.endsWith(path.join('core', 'embind-rust'))).toBe(true);
        expect(fs.existsSync(`${root}/crate/Cargo.toml`)).toBe(true);
    });

    test('memoizes the resolved root', async () => {
        const { default: resolveEmbindRustRoot } = await load();

        const first = resolveEmbindRustRoot();
        const existsSync = vi.spyOn(fs, 'existsSync').mockReturnValue(false);

        expect(resolveEmbindRustRoot()).toBe(first);
        expect(existsSync).not.toHaveBeenCalled();
    });

    test('throws a directive error when nothing provides the package', async () => {
        const { default: resolveEmbindRustRoot } = await load();
        noDeclaringPackage();
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);

        expect(() => resolveEmbindRustRoot())
            .toThrow(/Rust bindings need @crossbind\/core-embind-rust/);
    });
});

describe('embindRustVersion', () => {
    test('reads the version off the resolved package', async () => {
        const { embindRustVersion } = await load();

        expect(embindRustVersion()).toMatch(/^\d+\.\d+\.\d+/);
    });

    test('reports unknown instead of throwing when the package cannot be read', async () => {
        const { embindRustVersion } = await load();
        vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('gone'); });

        expect(embindRustVersion()).toBe('unknown');
    });
});
