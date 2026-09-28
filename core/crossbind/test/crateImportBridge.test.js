import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// cargo metadata is what locates the crate source; the answer is faked so the test needs no network.
vi.mock('../src/utils/runCargo.js', () => ({ default: vi.fn(), toHostPath: (p) => p }));

let work;
let crateDir;
let cacheDir;

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-crate-import-'));
    crateDir = path.join(work, 'fixture');
    cacheDir = path.join(work, 'app/.crossbind');
    fs.mkdirSync(path.join(crateDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.1.0"\n');
    fs.writeFileSync(path.join(crateDir, 'src/lib.rs'), 'pub fn root_value() -> i32 { 1 }\npub mod fast;\n');
    fs.writeFileSync(path.join(crateDir, 'src/fast.rs'), [
        'pub fn hash(input: &[u8], seed: u64) -> u64 { seed }',
        'pub struct Hasher { state: u64 }',
        'impl Hasher {',
        '    pub fn new() -> Self { Hasher { state: 0 } }',
        '    pub fn digest(&self) -> u64 { self.state }',
        '}',
        '',
    ].join('\n'));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

async function bridgeFor(modulePath) {
    vi.resetModules();
    const { default: runCargo } = await import('../src/utils/runCargo.js');
    runCargo.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({
            packages: [{ name: 'fixture', id: 'fixture-id', manifest_path: path.join(crateDir, 'Cargo.toml') }],
            resolve: { nodes: [{ id: 'fixture-id', features: [] }] },
        }),
    });
    const { createCrateImportBridge } = await import('../src/utils/rustBridgeGen.js');
    return createCrateImportBridge({ crateName: 'fixture', modulePath, spec: '0.1', cacheDir, log: () => {} });
}

const writeLib = (lines) => fs.writeFileSync(path.join(crateDir, 'src/lib.rs'), `${lines.join('\n')}\n`);
const addMarker = (name) => {
    fs.mkdirSync(`${cacheDir}/rust-crates`, { recursive: true });
    fs.writeFileSync(`${cacheDir}/rust-crates/${name}.rs`, '// crossbind cargo crate import marker\n');
};

describe('createCrateImportBridge', () => {
    test("a module import binds that module through its path, in the crate's one bridge", async () => {
        const { bridgeDir, exports, model } = await bridgeFor(['fast']);

        expect(bridgeDir).toBe(`${cacheDir}/rust-bridges/crate_fixture`);
        expect(exports).toEqual([
            { local: 'Hasher', wire: 'fixture__fast_Hasher' },
            { local: 'hash', wire: 'fixture__fast_hash' },
        ]);
        expect(model.freeFns.map((f) => f.name)).toEqual(['hash']);
        const bridge = fs.readFileSync(`${bridgeDir}/src/lib.rs`, 'utf8');
        expect(bridge).toContain('fixture::fast::hash(');
        expect(bridge).toContain('"fixture__fast_hash"');
        expect(bridge).toContain('class_::<fixture::fast::Hasher>("fixture__fast_Hasher")');
        // The root belongs to every bridge of its crate.
        expect(bridge).toContain('fixture::root_value(');
        const dts = fs.readFileSync(`${cacheDir}/rust-crates/types/fixture.fast.d.ts`, 'utf8');
        expect(dts).toContain("declare module 'cargo:fixture/fast'");
        expect(dts).toContain('export declare function hash(');
        expect(dts).not.toContain('rootValue');
    });

    test('the bare crate import keeps its bridge, names and module', async () => {
        const { bridgeDir, exports } = await bridgeFor([]);

        expect(bridgeDir).toBe(`${cacheDir}/rust-bridges/crate_fixture`);
        expect(exports).toEqual([{ local: 'rootValue', wire: 'fixture_rootValue' }]);
        expect(fs.readFileSync(`${bridgeDir}/src/lib.rs`, 'utf8')).toContain('fixture::root_value(');
        expect(fs.readFileSync(`${bridgeDir}/Cargo.toml`, 'utf8')).not.toContain('[lints.rust]');
        expect(fs.readFileSync(`${cacheDir}/rust-crates/types/fixture.d.ts`, 'utf8')).toContain("declare module 'cargo:fixture'");
    });

    test('a type reached through the root and through its module registers once, under one name', async () => {
        writeLib(['pub fn root_value() -> i32 { 1 }', 'pub mod fast;', 'pub use fast::Hasher;']);
        addMarker('fixture');
        addMarker('fixture.fast');
        // A module import that was removed since: left out of the bridge, not fatal for the others.
        addMarker('fixture.gone');

        const root = await bridgeFor([]);
        const bridge = fs.readFileSync(`${root.bridgeDir}/src/lib.rs`, 'utf8');
        expect(bridge.match(/class_::<fixture::(?:fast::)?Hasher>/g)).toHaveLength(1);
        expect(root.exports).toContainEqual({ local: 'Hasher', wire: 'fixture__fast_Hasher' });
        const fast = await bridgeFor(['fast']);
        expect(fast.exports).toContainEqual({ local: 'Hasher', wire: 'fixture__fast_Hasher' });
        await expect(bridgeFor(['gone'])).rejects.toThrow(/not found/);
    });

    test("a type that only another import exports is imported into this import's types", async () => {
        writeLib(['pub mod params;', 'pub use params::Params;']);
        fs.writeFileSync(path.join(crateDir, 'src/params.rs'), [
            '#[derive(Clone, Copy)]',
            'pub struct Builder { m: u32 }',
            '#[derive(Clone, Copy)]',
            'pub struct Params { m: u32 }',
            'impl Builder {',
            '    pub fn build(self) -> Params { Params { m: self.m } }',
            '}',
            'impl Params {',
            '    pub fn builder() -> Builder { Builder { m: 0 } }',
            '    pub fn m(&self) -> u32 { self.m }',
            '}',
            '',
        ].join('\n'));
        addMarker('fixture');
        addMarker('fixture.params');

        await bridgeFor([]);
        const dts = fs.readFileSync(`${cacheDir}/rust-crates/types/fixture.d.ts`, 'utf8');
        expect(dts).toContain("import type { Builder } from 'cargo:fixture/params';");
        expect(dts).toContain('static builder(): Builder;');
    });
});
