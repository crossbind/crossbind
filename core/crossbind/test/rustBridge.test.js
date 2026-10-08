import {
    describe, test, expect, beforeAll, afterAll,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import generateRustBridge, {
    createRustBridgeCrate, readCrateName, parseSurface, parseCrateSurface,
} from '../src/utils/rustBridgeGen.js';

// One crate covering the documented v1 surface: enum, value object, class (ctor, factory,
// methods, Display, Result/Option returns, &str/&String/&Class params, i64) and a free fn.
const LIB_RS = `
#[repr(i32)]
pub enum Mode {
    Fast = 0,
    Slow = 1,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

pub struct Counter {
    current: i32,
}

impl Counter {
    pub fn new(start: i32) -> Self {
        Counter { current: start }
    }
    pub fn from_text(text: &str) -> Option<Self> {
        None
    }
    pub fn current(&self) -> i32 {
        self.current
    }
    pub fn bump(&mut self, by: i32) -> i32 {
        self.current += by;
        self.current
    }
    pub fn checked_div(&self, by: i32) -> Result<i32, String> {
        Ok(self.current / by)
    }
    pub fn label(&self, prefix: &String) -> String {
        format!("{}{}", prefix, self.current)
    }
    pub fn distance(&self, other: &Counter) -> i64 {
        (self.current - other.current) as i64
    }
    pub fn mode(&self) -> Mode {
        Mode::Fast
    }
    pub fn origin(&self) -> Point {
        Point::default()
    }
}

impl std::fmt::Display for Counter {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.current)
    }
}

pub fn double_it(value: i32) -> i32 {
    value * 2
}
`;

let work;
let crateDir;

beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-rust-bridge-'));
    crateDir = path.join(work, 'demo-crate');
    fs.mkdirSync(path.join(crateDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "demo-crate"\nversion = "0.1.0"\n');
    fs.writeFileSync(path.join(crateDir, 'src/lib.rs'), LIB_RS);
});

afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('readCrateName', () => {
    test('reads the package name from Cargo.toml', () => {
        expect(readCrateName(crateDir)).toBe('demo-crate');
    });

    test('throws when the crate has no Cargo.toml', () => {
        expect(() => readCrateName(path.join(work, 'missing'))).toThrow();
    });
});

describe('generateRustBridge', () => {
    let result;
    let bridge;
    let manifest;
    let dts;

    beforeAll(() => {
        const dtsFile = path.join(work, 'demo.d.ts');
        result = generateRustBridge({
            crateDir, vectors: [{ of: 'i32', name: 'VectorInt' }], dtsFile, keepName: 'demo', log: () => {},
        });
        bridge = fs.readFileSync(path.join(result.bridgeDir, 'src/lib.rs'), 'utf8');
        manifest = fs.readFileSync(path.join(result.bridgeDir, 'Cargo.toml'), 'utf8');
        dts = fs.readFileSync(dtsFile, 'utf8');
    });

    test('writes the companion crate next to the user crate', () => {
        expect(result.bridgeDir).toBe(`${crateDir}/.crossbind/bridge-crate`);
        expect(result.crateName).toBe('demo_crate_crossbind_bridge');
    });

    test('manifest depends on the user crate by path and keeps one codegen unit', () => {
        expect(manifest).toContain('name = "demo-crate-crossbind-bridge"');
        expect(manifest).toContain('crate-type = ["staticlib"]');
        // Relative, not absolute: the bridge sits two levels under the crate, and the same tree is
        // read from a container mount where the host checkout path does not exist.
        expect(manifest).toContain('demo_crate = { package = "demo-crate", path = "../.." }');
        expect(manifest).toContain('embind-rs = { path = ');
        expect(manifest).toContain('codegen-units = 1');
        // Isolated on purpose: a surrounding workspace must never absorb the bridge crate.
        expect(manifest).toContain('[workspace]');
    });

    test('registers the class, its methods and the free function', () => {
        expect(bridge).toContain('class_::<demo_crate::Counter>("Counter")');
        expect(bridge).toContain('.constructor');
        expect(bridge).toContain('"current"');
        expect(bridge).toContain('"bump"');
        expect(bridge).toContain('"checkedDiv"');
        expect(bridge).toContain('"fromText"');
        expect(bridge).toContain('"toString"');
        expect(bridge).toContain('double_it');
    });

    test('registers the enum with its variants and the value object with its fields', () => {
        expect(bridge).toContain('enum_::<ModeW>("Mode")');
        expect(bridge).toContain('demo_crate::Mode::Fast');
        expect(bridge).toContain('value_object_::<PointW>("Point")');
        expect(bridge).toContain('"x"');
        expect(bridge).toContain('"y"');
    });

    test('adapts borrowed params: strings cross as String, class refs through a Ref wrapper', () => {
        expect(bridge).toContain('CounterRef');
        expect(bridge).toMatch(/label[\s\S]*?String/);
    });

    test('emits the vector registration declared by the config', () => {
        expect(bridge).toContain('register_vector::<i32>("VectorInt")');
    });

    test('appends the keep symbol so the lazily linked archive can be pinned', () => {
        expect(bridge).toContain('pub extern "C" fn crossbind_keep_demo()');
    });

    test('writes declarations next to the requested path', () => {
        expect(dts).toContain('export declare class Counter');
        expect(dts).toContain('checkedDiv');
    });

    test('is idempotent: a second run leaves the generated files untouched', () => {
        const before = fs.statSync(path.join(result.bridgeDir, 'src/lib.rs')).mtimeMs;
        generateRustBridge({
            crateDir, vectors: [{ of: 'i32', name: 'VectorInt' }], keepName: 'demo', log: () => {},
        });
        expect(fs.statSync(path.join(result.bridgeDir, 'src/lib.rs')).mtimeMs).toBe(before);
    });

    test('throws when the crate has no src/lib.rs', () => {
        const empty = path.join(work, 'empty-crate');
        fs.mkdirSync(empty, { recursive: true });
        fs.writeFileSync(path.join(empty, 'Cargo.toml'), '[package]\nname = "empty"\n');
        expect(() => generateRustBridge({ crateDir: empty, log: () => {} })).toThrow(/lib\.rs not found/);
    });
});

// Anything outside the v1 surface is skipped WITH a log line - never silently.
describe('parseSurface: what the grammar refuses', () => {
    const OUTSIDE = `
pub enum Loose {
    A(i32),
}

#[repr(C)]
pub struct NotCopy {
    pub x: f64,
}

pub struct Wide;

impl Wide {
    pub fn new() -> Self {
        Wide
    }
    pub fn consuming(self) -> i32 {
        1
    }
    pub fn too_many(&self, a: i32, b: i32, c: i32, d: i32, e: i32, f: i32, g: i32) -> i32 {
        a
    }
    pub fn odd_param(&self, other: Vec<Wide>) -> i32 {
        0
    }
    pub fn odd_return(&self) -> Box<dyn std::fmt::Debug> {
        Box::new(1)
    }
    pub fn odd_option(&self) -> Option<Loose> {
        None
    }
    pub fn factory_wide(a: i32, b: i32, c: i32, d: i32, e: i32, f: i32, g: i32) -> Self {
        Wide
    }
}

pub struct Bare;

impl Bare {
    fn private_only(&self) -> i32 {
        0
    }
}
`;

    let model;
    let logs;

    beforeAll(() => {
        logs = [];
        model = parseSurface(OUTSIDE, (line) => logs.push(line));
    });

    test('skips an enum whose variants carry data, and says so', () => {
        expect(model.enums).toEqual([]);
        expect(logs.some((l) => l.includes('enum Loose skipped'))).toBe(true);
    });

    test('skips a repr(C) struct without the required derives, and says so', () => {
        expect(model.valueObjects).toEqual([]);
        expect(logs.some((l) => l.includes('struct NotCopy skipped'))).toBe(true);
    });

    test('skips methods outside the grammar with one reason each', () => {
        const wide = model.classes.find((c) => c.name === 'Wide');
        expect(wide.methods.map((m) => m.name)).toEqual([]);
        expect(logs.some((l) => l.includes('consuming self is not supported'))).toBe(true);
        expect(logs.some((l) => l.includes('too_many'))).toBe(true);
        expect(logs.some((l) => l.includes("a struct inside 'Vec<Wide>' must derive Serialize and Deserialize"))).toBe(true);
        expect(logs.some((l) => l.includes('unsupported return'))).toBe(true);
        expect(logs.some((l) => l.includes('Option<Loose> return is not representable'))).toBe(true);
        expect(logs.some((l) => l.includes('factories take max 6 args'))).toBe(true);
    });

    test('drops a struct whose surface is entirely private, and says so', () => {
        expect(model.classes.map((c) => c.name)).not.toContain('Bare');
        expect(logs.some((l) => l.includes('struct Bare has no exportable pub fns'))).toBe(true);
    });

    test('drops a binding that borrows a struct it dropped, and says so', () => {
        const log = [];
        const model = parseSurface(`
pub struct Plain {
    count: i32,
}
pub fn count_of(p: &Plain) -> i32 { 0 }
pub fn keep(v: i32) -> i32 { v }
`, (m) => log.push(m));
        expect(model.classes.map((c) => c.name)).not.toContain('Plain');
        expect(model.freeFns.map((f) => f.name)).toEqual(['keep']);
        expect(log).toContainEqual(expect.stringContaining('fn count_of skipped (a parameter borrows a struct that is not registered)'));
    });
});

describe('parseCrateSurface', () => {
    let srcDir;

    beforeAll(() => {
        srcDir = path.join(work, 'multi-file/src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'lib.rs'), [
            'pub struct Counter { current: i32 }',
            '',
            'impl Counter {',
            '    pub fn new(start: i32) -> Self { Counter { current: start } }',
            '}',
            '',
            '#[cfg(feature = "extra")]',
            'mod extra;',
            '',
        ].join('\n'));
        fs.writeFileSync(path.join(srcDir, 'extra.rs'), [
            'use crate::Counter;',
            '',
            'impl Counter {',
            '    pub fn doubled(&self) -> i32 { self.current * 2 }',
            '}',
            '',
        ].join('\n'));
    });

    test('walks the crate root and registers its types', () => {
        const model = parseCrateSurface({ srcDir, log: () => {} });
        expect(model.classes.map((c) => c.name)).toContain('Counter');
    });

    test('skips a feature-gated module unless the feature is resolved on', () => {
        const off = parseCrateSurface({ srcDir, log: () => {} });
        expect(off.classes.find((c) => c.name === 'Counter').methods.map((m) => m.name)).not.toContain('doubled');
        const on = parseCrateSurface({ srcDir, features: ['extra'], log: () => {} });
        expect(on.classes.find((c) => c.name === 'Counter').methods.map((m) => m.name)).toContain('doubled');
    });

    test('a name two modules declare takes the impls of the bound one only', () => {
        const dir = path.join(work, 'same-name/src');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'lib.rs'), [
            'pub mod bytes;',
            'pub struct Matcher { text: String }',
            'impl Matcher {',
            '    pub fn is_match(&self, text: &str) -> bool { true }',
            '}',
        ].join('\n'));
        fs.writeFileSync(path.join(dir, 'bytes.rs'), [
            'pub struct Matcher { bytes: Vec<u8> }',
            'impl Matcher {',
            '    pub fn is_match(&self, bytes: &[u8]) -> bool { true }',
            '    pub fn bytes_only(&self) -> u32 { 0 }',
            '}',
        ].join('\n'));

        const model = parseCrateSurface({ srcDir: dir, log: () => {} });

        expect(model.classes.find((c) => c.name === 'Matcher').methods.map((m) => [m.name, m.args.map((a) => a.ty)]))
            .toEqual([['is_match', ['&str']]]);
    });
});

describe('parseCrateSurface: one module of the crate', () => {
    let srcDir;
    const write = (file, lines) => {
        fs.mkdirSync(path.dirname(path.join(srcDir, file)), { recursive: true });
        fs.writeFileSync(path.join(srcDir, file), `${lines.join('\n')}\n`);
    };
    const parse = (modulePath, features = []) => parseCrateSurface({ srcDir, features, modulePath, log: () => {} });

    beforeAll(() => {
        srcDir = path.join(work, 'module-crate/src');
        write('lib.rs', [
            'pub fn root_value() -> i32 { 1 }',
            '#[cfg(feature = "fast")]',
            'pub mod fast;',
            'mod hidden;',
            'pub mod nested;',
            'pub mod globbed;',
        ]);
        write('fast.rs', [
            'pub fn hash(input: &[u8], seed: u64) -> u64 { seed }',
            'pub struct Hasher { state: u64 }',
            'impl Hasher {',
            '    pub fn new() -> Self { Hasher { state: 0 } }',
            '    pub fn update(&mut self, input: &[u8]) { self.state += input.len() as u64; }',
            '    pub fn digest(&self) -> u64 { self.state }',
            '}',
        ]);
        write('hidden.rs', ['pub fn secret() -> i32 { 2 }']);
        write('nested/mod.rs', ['pub mod inner;']);
        write('nested/inner.rs', ['pub fn deep() -> i32 { 3 }']);
        write('globbed.rs', ['mod parts;', 'pub use self::parts::*;']);
        write('globbed/parts.rs', ['pub fn piece() -> i32 { 4 }']);
    });

    test('binds what the module defines and nothing from the crate root', () => {
        const model = parse(['fast'], ['fast']);
        expect(model.freeFns.map((f) => f.name)).toEqual(['hash']);
        const hasher = model.classes.find((c) => c.name === 'Hasher');
        expect(hasher.ctor).not.toBeNull();
        expect(hasher.methods.map((m) => m.name)).toEqual(['update', 'digest']);
    });

    test('reaches a module declared in a nested directory', () => {
        expect(parse(['nested', 'inner']).freeFns.map((f) => f.name)).toEqual(['deep']);
    });

    test('follows a glob re-export relative to the module', () => {
        expect(parse(['globbed']).freeFns.map((f) => f.name)).toEqual(['piece']);
    });

    test('refuses a module that is private or switched off by a feature', () => {
        expect(() => parse(['hidden'])).toThrow(/private/);
        expect(() => parse(['fast'])).toThrow(/not found/);
        expect(() => parse(['missing'])).toThrow(/not found/);
    });

    test('keeps the crate root surface when no module is named', () => {
        expect(parse([]).freeFns.map((f) => f.name)).toEqual(['root_value']);
    });
});

describe('createRustBridgeCrate', () => {
    let created;
    let bridge;
    let manifest;
    let projectPath;
    let cacheDir;

    beforeAll(() => {
        projectPath = path.join(work, 'app');
        cacheDir = path.join(projectPath, '.crossbind');
        fs.mkdirSync(path.join(projectPath, 'src/native'), { recursive: true });
        const rsFile = path.join(projectPath, 'src/native/counter.rs');
        fs.writeFileSync(rsFile, LIB_RS);
        created = createRustBridgeCrate({
            rsFile,
            cacheDir,
            projectPath,
            vectors: [],
            cargoDependencies: { uuid: '1.11.0', geo: '{ version = "0.29", default-features = false }' },
            log: () => {},
        });
        bridge = fs.readFileSync(path.join(created.bridgeDir, 'src/lib.rs'), 'utf8');
        manifest = fs.readFileSync(path.join(created.bridgeDir, 'Cargo.toml'), 'utf8');
    });

    test('synthesizes a self-contained rlib crate for the app-local source', () => {
        expect(created.bridgeDir).toBe(`${cacheDir}/rust-bridges/counter`);
        expect(created.crateName).toBe('counter_crossbind_app');
        expect(manifest).toContain('crate-type = ["rlib"]');
    });

    test('embeds the user file by path instead of copying it', () => {
        expect(bridge).toContain('#[path = "');
        expect(bridge).toContain('mod user;');
        expect(bridge).toContain('class_::<user::Counter>("Counter")');
    });

    test('exports the keep symbol of its lib, which pulls its registrations into a lazy link', () => {
        expect(bridge).toContain('#[no_mangle]\npub extern "C" fn crossbind_keep_counter_crossbind_app() {}');
    });

    test('renders declared cargo dependencies, both plain versions and verbatim specs', () => {
        expect(manifest).toContain('uuid = "1.11.0"');
        expect(manifest).toContain('geo = { version = "0.29", default-features = false }');
    });

    test('mirrors the declarations under the cache instead of the user source folder', () => {
        const mirrored = path.join(cacheDir, 'types/src/native/counter.rs.d.ts');
        expect(fs.existsSync(mirrored)).toBe(true);
        expect(fs.existsSync(path.join(projectPath, 'src/native/counter.rs.d.ts'))).toBe(false);
        expect(fs.readFileSync(mirrored, 'utf8')).toContain('export declare class Counter');
    });

    test('returns the parsed model so callers can wire the surface', () => {
        expect(created.model.classes.map((c) => c.name)).toContain('Counter');
        expect(created.model.enums.map((e) => e.name)).toContain('Mode');
    });
});

describe('typed arrays', () => {
    test('parameters take the view wire, returns keep the typed array wrapper', () => {
        const TYPED_RS = `
pub fn checksum(data: &[u8], seed: u32) -> u32 { seed }
pub fn keep(data: Vec<u8>) -> usize { data.len() }
pub fn mean(values: &[f64]) -> f64 { values[0] }
pub fn scale(values: Vec<f64>) -> Vec<f64> { values }
pub fn make(n: i32) -> Vec<u8> { vec![0; n as usize] }
`;
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-typed-rs-'));
        try {
            const rsFile = path.join(work, 'typed.rs');
            fs.writeFileSync(rsFile, TYPED_RS);
            const { bridgeDir } = createRustBridgeCrate({
                rsFile, cacheDir: path.join(work, '.crossbind'), projectPath: work, log: () => {},
            });
            const bridge = fs.readFileSync(path.join(bridgeDir, 'src/lib.rs'), 'utf8');
            expect(bridge).toContain('fn __free_checksum(a0: embind_rs::JsBytesArg, a1: u32) -> u32');
            expect(bridge).toContain('user::checksum(a0.as_slice(), a1)');
            expect(bridge).toContain('user::keep(a0.to_vec())');
            expect(bridge).toContain('user::mean(a0.as_slice())');
            expect(bridge).toContain('fn __free_scale(a0: embind_rs::JsF64sArg) -> embind_rs::JsF64s');
            expect(bridge).toContain('fn __free_make(a0: i32) -> embind_rs::JsBytes');
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    });
});

const parseLogged = (src) => {
    const logs = [];
    return { model: parseSurface(src, (line) => logs.push(line)), logs };
};

describe('parameter bindings and fixed arrays', () => {
    test('a `mut` binding stays inside the function: the parameter crosses as its type', () => {
        const { model } = parseLogged(`
pub fn hash(mut input: &[u8], seed: u64) -> u64 { seed }
pub struct Hasher { state: u64 }
impl Hasher {
    pub fn new() -> Self { Hasher { state: 0 } }
    pub fn update(&mut self, mut input: &[u8]) { self.state += input.len() as u64; }
}
`);
        expect(model.freeFns.find((f) => f.name === 'hash').args).toEqual([{ name: 'input', ty: '&[u8]' }, { name: 'seed', ty: 'u64' }]);
        expect(model.classes.find((c) => c.name === 'Hasher').methods.map((m) => m.name)).toEqual(['update']);
    });

    test('a fixed array crosses only with a literal length serde can carry, up to 32 items', () => {
        const { model, logs } = parseLogged(`
pub fn digest(bytes: [u8; 32]) -> [u8; 32] { bytes }
pub fn key(bytes: &[u8; 4]) -> i32 { 0 }
pub fn rows() -> Vec<[u8; 32]> { Vec::new() }
pub fn named(secret: &[u8; SECRET_SIZE]) -> i32 { 0 }
pub fn long(bytes: [u8; 64]) -> i32 { 0 }
pub fn long_ref(bytes: &[u8; 64]) -> i32 { 0 }
pub fn long_out() -> [u8; 64] { [0; 64] }
pub fn long_rows() -> Vec<[u8; 64]> { Vec::new() }
`);
        expect(model.freeFns.map((f) => f.name)).toEqual(['digest', 'key', 'rows']);
        for (const name of ['named', 'long', 'long_ref', 'long_out', 'long_rows']) {
            expect(logs.some((l) => l.includes(`fn ${name} skipped`)), name).toBe(true);
        }
    });
});

describe('crate surfaces beyond the plain grammar', () => {
    const bridgeOf = (src) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-rs-surface-'));
        const logs = [];
        try {
            const rsFile = path.join(dir, 'surface.rs');
            fs.writeFileSync(rsFile, src);
            const { bridgeDir, model } = createRustBridgeCrate({
                rsFile, cacheDir: path.join(dir, '.crossbind'), projectPath: dir, log: (line) => logs.push(line),
            });
            return {
                model,
                logs,
                bridge: fs.readFileSync(path.join(bridgeDir, 'src/lib.rs'), 'utf8'),
                dts: fs.readFileSync(path.join(dir, '.crossbind/types/surface.rs.d.ts'), 'utf8'),
            };
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };

    test('an enum with hex, octal or binary discriminants binds as a plain enum', () => {
        const { model } = parseLogged(`
#[derive(Default, Clone, Copy)]
#[repr(u8)]
pub enum Check {
    /// No checksum
    None = 0x00,
    #[default]
    Crc64 = 0x04,
    Sha256 = 0x0A,
    Octal = 0o17,
    Mask = 0b1000_0000,
}
`);
        expect(model.enums).toEqual([{
            name: 'Check',
            variants: [
                { name: 'None', value: 0 }, { name: 'Crc64', value: 4 }, { name: 'Sha256', value: 10 },
                { name: 'Octal', value: 15 }, { name: 'Mask', value: 128 },
            ],
        }]);
    });

    test('follows modules declared inside a macro through their re-exports, feature gates included', () => {
        const srcDir = path.join(work, 'macro-crate/src');
        const write = (file, lines) => {
            fs.mkdirSync(path.dirname(path.join(srcDir, file)), { recursive: true });
            fs.writeFileSync(path.join(srcDir, file), `${lines.join('\n')}\n`);
        };
        write('lib.rs', [
            'macro_rules! private_modules {',
            '    ($($name:ident),*) => {',
            '        $(',
            '            mod $name;',
            '        )*',
            '    };',
            '}',
            'private_modules!(engine, extra);',
            'pub use crate::engine::{Engine, checksum, internal as renamed};',
            '#[cfg(feature = "extra")]',
            'pub use crate::extra::Extra;',
        ]);
        write('engine.rs', [
            'pub struct Engine { n: u32 }',
            'impl Engine {',
            '    pub fn new() -> Self { Engine { n: 0 } }',
            '    pub fn run(&self) -> u32 { self.n }',
            '}',
            'pub fn checksum(data: &[u8]) -> u32 { data.len() as u32 }',
            'pub fn internal() -> u32 { 1 }',
            'pub fn unexported() -> u32 { 2 }',
        ]);
        write('extra.rs', ['pub struct Extra { n: u32 }', 'impl Extra {', '    pub fn new() -> Self { Extra { n: 0 } }', '}']);

        const off = parseCrateSurface({ srcDir, log: () => {} });
        expect(off.classes.map((c) => c.name)).toEqual(['Engine']);
        expect(off.freeFns.map((f) => f.name)).toEqual(['checksum']);
        const on = parseCrateSurface({ srcDir, features: ['extra'], log: () => {} });
        expect(on.classes.map((c) => c.name)).toEqual(['Engine', 'Extra']);
    });

    test('`impl Default` makes a struct constructible from JS, wherever the impl sits', () => {
        const { model, bridge, dts } = bridgeOf(`
impl Default for Settings {
    fn default() -> Self { Settings { level: 3 } }
}
pub struct Settings { level: u32 }
impl Settings {
    pub fn level(&self) -> u32 { self.level }
}
`);
        expect(model.classes.find((c) => c.name === 'Settings').hasDefault).toBe(true);
        expect(bridge).toContain('<user::Settings as Default>::default()');
        expect(dts).toContain('    constructor();');
    });

    test('an associated fn that does not build Self is a static function on the class', () => {
        const { model, bridge, dts } = bridgeOf(`
pub struct Codec { level: u32 }
impl Codec {
    pub fn new(level: u32) -> Self { Codec { level } }
    pub fn verify(encoded: &str, data: &[u8]) -> Result<(), String> { Ok(()) }
    pub fn default_level() -> u32 { 3 }
}
`);
        expect(model.classes.find((c) => c.name === 'Codec').statics.map((f) => f.name)).toEqual(['verify', 'default_level']);
        expect(bridge).toContain('.static_function2("verify", __codec_verify)');
        expect(bridge).toContain('.static_function0("defaultLevel", __codec_default_level)');
        expect(dts).toContain('    static verify(encoded: string, data: Uint8Array): void;');
        expect(dts).toContain('    static defaultLevel(): number;');
    });

    test('a Copy or Clone struct moves by copy: consuming methods, by-value params and returns of other structs', () => {
        const { model, logs, bridge } = bridgeOf(`
#[derive(Clone, Copy)]
pub struct Memory(u64);
impl Memory {
    pub const fn kib(kib: u64) -> Memory { Memory(kib) }
    pub const fn as_kib(self) -> u64 { self.0 }
}
#[derive(Clone, Copy)]
pub struct Config { memory: Memory }
#[derive(Clone, Copy)]
pub struct Builder { memory: Memory }
impl Builder {
    pub const fn memory(mut self, memory: Memory) -> Builder { self.memory = memory; self }
    pub fn build(self) -> Result<Config, String> { Ok(Config { memory: self.memory }) }
}
impl Config {
    pub fn builder() -> Builder { Builder { memory: Memory(0) } }
    pub fn memory_kib(&self) -> u64 { self.memory.0 }
}
pub struct Engine { config: Config }
impl Engine {
    pub fn new(config: Config) -> Self { Engine { config } }
    pub fn finish(self) -> u64 { 0 }
}
`);
        const cls = (name) => model.classes.find((c) => c.name === name);
        expect(cls('Memory').methods.map((m) => m.name)).toEqual(['as_kib']);
        expect(cls('Builder').methods.map((m) => m.name)).toEqual(['memory', 'build']);
        expect(cls('Config').statics.map((f) => f.name)).toEqual(['builder']);
        expect(cls('Engine').ctor.args).toEqual([{ name: 'config', ty: 'Config' }]);
        expect(cls('Engine').methods).toEqual([]);
        expect(logs.some((l) => l.includes('Engine::finish skipped'))).toBe(true);

        expect(bridge).toContain('(&*t).clone().as_kib()');
        expect(bridge).toContain('(&*t).clone().memory((unsafe { &*a0.0 }).clone())');
        expect(bridge).toContain('match (&*t).clone().build() { Ok(v) => ConfigOwned(Box::into_raw(Box::new(v)))');
        expect(bridge).toContain('user::Engine::new((unsafe { &*a0.0 }).clone())');
        expect(bridge).toContain('.smart_ptr("ConfigPtr")');
        expect(bridge).toContain('.smart_ptr("BuilderPtr")');
        // A class handed back by another one resolves its smart pointer when that binding
        // registers, so every class registers before any binding does.
        expect(bridge.lastIndexOf('class_::<')).toBeLessThan(bridge.indexOf('.function'));
    });

    test('a cfg decides every item: enabled features in, disabled or target-dependent ones out', () => {
        const srcDir = path.join(work, 'cfg-crate/src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'lib.rs'), `
#[cfg(not(feature = "std"))]
mod no_std;
#[cfg(not(feature = "std"))]
pub use no_std::Error;
#[derive(Clone, Copy)]
#[repr(u8)]
pub enum Backend {
    Scalar = 0,
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    Avx2 = 2,
    #[cfg(feature = "simd")]
    Simd = 3,
}
pub struct Engine { n: u32 }
impl Engine {
    pub fn new() -> Self { Engine { n: 0 } }
    #[cfg(feature = "std")]
    pub fn with_std(&self) -> u32 { 1 }
    #[cfg(target_os = "linux")]
    pub fn linux_only(&self) -> u32 { 2 }
}
#[cfg(all(feature = "std", not(feature = "simd")))]
pub fn plain() -> u32 { 3 }
#[cfg(any(
    feature = "simd",
    target_arch = "wasm32",
))]
pub fn wide() -> u32 { 4 }
pub const LANES: u32 = 4;
pub const RATIO: f64 = 0.5;
`);
        fs.writeFileSync(path.join(srcDir, 'no_std.rs'), 'pub enum Error { Eof, Interrupted }\n');

        const std = parseCrateSurface({ srcDir, features: ['std'], log: () => {} });
        expect(std.enums).toEqual([{ name: 'Backend', variants: [{ name: 'Scalar', value: 0 }] }]);
        expect(std.classes.find((c) => c.name === 'Engine').methods.map((m) => m.name)).toEqual(['with_std']);
        expect(std.freeFns.map((f) => f.name)).toEqual(['plain']);
        expect(std.consts.map((c) => c.name)).toEqual(['RATIO']);

        const simd = parseCrateSurface({ srcDir, features: ['std', 'simd'], log: () => {} });
        expect(simd.enums[0].variants).toEqual([{ name: 'Scalar', value: 0 }, { name: 'Simd', value: 3 }]);
        expect(simd.freeFns.map((f) => f.name)).toEqual(['wide']);
    });

    test('a `//` inside a string is no comment: a URL in an attribute or a const is kept whole', () => {
        const { model } = parseLogged(`
#![doc(html_root_url = "https://docs.rs/example/1.0.0")]
pub const HOME: &str = "https://example.com";
pub struct Page { n: u32 }
impl Page {
    pub fn new() -> Self { Page { n: 0 } }
}
`);
        expect(model.classes.map((c) => c.name)).toEqual(['Page']);
        expect(model.consts).toEqual([{ name: 'HOME', ty: '&str', value: '"https://example.com"' }]);
    });

    test('an enum whose implicit discriminants follow a target-dependent variant is left out', () => {
        const { model, logs } = parseLogged(`
pub enum Mixed {
    A,
    #[cfg(target_arch = "x86_64")]
    B,
    C,
}
`);
        expect(model.enums).toEqual([]);
        expect(logs.some((l) => l.includes('enum Mixed skipped'))).toBe(true);
    });

    test('a Result behind a path (io::Result, std::io::Result) is a Result', () => {
        const { model } = parseLogged(`
pub fn size(n: u32) -> io::Result<u32> { Ok(n) }
pub fn count(n: u32) -> std::io::Result<u32> { Ok(n) }
`);
        expect(model.freeFns.map((f) => [f.name, f.throws])).toEqual([['size', true], ['count', true]]);
    });

    test('a std::io stream binds as a class that takes and hands back byte chunks', () => {
        const { model, logs, bridge, dts } = bridgeOf(`
use std::io::{self, Read, Write};

#[derive(Clone, Copy, Default)]
pub struct Level { n: u32 }
impl Level {
    pub fn fast() -> Self { Level { n: 1 } }
}
pub struct Encoder<W: Write> { inner: W, level: u32 }
impl<W: Write> Encoder<W> {
    pub fn new(inner: W, level: Level) -> io::Result<Self> { Ok(Encoder { inner, level: level.n }) }
    pub fn level(&self) -> u32 { self.level }
    pub fn get_ref(&self) -> &W { &self.inner }
    pub fn finish(mut self) -> io::Result<W> { self.inner.flush()?; Ok(self.inner) }
}
impl<W: Write> Write for Encoder<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> { self.inner.write(buf) }
    fn flush(&mut self) -> io::Result<()> { self.inner.flush() }
}
pub struct Decoder<R: Read> { inner: R }
impl<R: Read> Decoder<R> {
    pub fn new(inner: R, strict: bool) -> Self { Decoder { inner } }
    pub fn into_inner(self) -> R { self.inner }
}
impl<R: Read> Read for Decoder<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> { self.inner.read(buf) }
}
pub struct Seeker<W: Write + io::Seek> { inner: W }
impl<W: Write + io::Seek> Seeker<W> {
    pub fn new(inner: W) -> Self { Seeker { inner } }
}
impl<W: Write + io::Seek> Write for Seeker<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> { self.inner.write(buf) }
    fn flush(&mut self) -> io::Result<()> { self.inner.flush() }
}
`);
        const stream = (name) => model.streams.find((s) => s.name === name);
        expect(model.streams.map((s) => [s.name, s.role])).toEqual([['Encoder', 'writer'], ['Decoder', 'reader']]);
        expect(stream('Encoder').ctor.args).toEqual([{ name: 'level', ty: 'Level' }]);
        expect(stream('Encoder').finishers.map((f) => f.name)).toEqual(['finish']);
        expect(stream('Encoder').methods.map((m) => m.name)).toEqual(['level']);
        expect(stream('Decoder').ctor.args).toEqual([{ name: 'inner', ty: '&[u8]' }, { name: 'strict', ty: 'bool' }]);
        expect(model.classes.map((c) => c.name)).toEqual(['Level']);
        expect(logs.some((l) => l.includes('Seeker skipped'))).toBe(true);
        expect(logs).toContain('crossbind: rust bridge: Decoder::into_inner skipped (a reader is not consumed: its R is the input passed to new)');

        expect(bridge).toContain('pub struct EncoderCrossbindStream { inner: Option<user::Encoder<__CrossbindSink>>, sink: __CrossbindSink }');
        expect(bridge).toContain('user::Encoder::new(sink.clone(), (unsafe { &*a0.0 }).clone())');
        expect(bridge).toContain('std::io::Write::write_all(w, a0.as_slice())');
        expect(bridge).toContain('embind_rs::JsBytes(t.sink.drain())');
        expect(bridge).toContain('match t.inner.take()');
        expect(bridge).toContain('user::Decoder::new(std::io::Cursor::new(a0.to_vec()), a1)');
        expect(bridge).toContain('std::io::Read::read_to_end(r, &mut out)');
        // read(max) grows with the data it returns, so a large max allocates nothing up front.
        expect(bridge).toContain('std::io::Read::read_to_end(&mut std::io::Read::take(r, a0 as u64), &mut out)');
        expect(bridge).not.toContain('vec![0u8; a0 as usize]');
        expect(bridge).toContain('.function1("write", __encoder_write)');
        expect(bridge).toContain('.function0("finish", __encoder_finish)');
        expect(bridge).toContain('.function0("readAll", __decoder_read_all)');
        expect(bridge).toContain('.function1("read", __decoder_read)');

        expect(dts).toContain('export declare class Encoder {');
        expect(dts).toContain('    constructor(level: Level);');
        expect(dts).toContain('    write(data: Uint8Array): Uint8Array;');
        expect(dts).toContain('    finish(): Uint8Array;');
        expect(dts).toContain('    constructor(inner: Uint8Array, strict: boolean);');
        expect(dts).toContain('    readAll(): Uint8Array;');
    });

    test('Option<u64>, Option<i64> and optional typed arrays cross as parameters', () => {
        const { model, logs, bridge, dts } = bridgeOf(`
pub fn sized(expected: Option<u64>, offset: Option<i64>) -> u32 { 0 }
pub fn primed(dict: Option<&[u8]>, weights: Option<&[f64]>) -> u32 { 0 }
pub struct Primer { n: u32 }
impl Primer {
    pub fn new(dict: Option<&[u8]>, limit: Option<u64>) -> Self { Primer { n: 0 } }
}
`);
        expect(logs.filter((l) => l.includes('skipped'))).toEqual([]);
        expect(model.freeFns.map((f) => f.name)).toEqual(['sized', 'primed']);
        expect(bridge).toContain('fn __free_sized(a0: embind_rs::JsBigIntOptArg<u64>, a1: embind_rs::JsBigIntOptArg<i64>) -> u32');
        expect(bridge).toContain('user::sized(a0.0, a1.0)');
        expect(bridge).toContain('fn __free_primed(a0: embind_rs::JsViewOptArg<u8>, a1: embind_rs::JsViewOptArg<f64>) -> u32');
        expect(bridge).toContain('user::primed(a0.as_slice(), a1.as_slice())');
        expect(bridge).toContain('user::Primer::new(a0.as_slice(), a1.0)');
        expect(bridge).toContain('embind_rs::register_optional_bigint::<i64>();');
        expect(bridge).toContain('embind_rs::register_optional_bigint::<u64>();');
        expect(dts).toContain('sized(expected: bigint | null | undefined, offset: bigint | null | undefined): number;');
        expect(dts).toContain('primed(dict: Uint8Array | null | undefined, weights: Float64Array | null | undefined): number;');
        expect(dts).toContain('constructor(dict: Uint8Array | null | undefined, limit: bigint | null | undefined);');
    });

    test('a NonZero integer crosses as its integer and 0 is rejected before the call', () => {
        const { model, logs, bridge, dts } = bridgeOf(`
use std::num::{NonZeroU32, NonZeroU64};
pub struct Options { size: u64 }
impl Options {
    pub fn new() -> Self { Options { size: 0 } }
    pub fn set_block_size(&mut self, block_size: Option<NonZeroU64>) { self.size = block_size.map_or(0, |v| v.get()); }
    pub fn set_threads(&mut self, threads: NonZeroU32) {}
}
`);
        expect(logs.filter((l) => l.includes('skipped'))).toEqual([]);
        expect(model.classes.find((c) => c.name === 'Options').methods.map((m) => m.name)).toEqual(['set_block_size', 'set_threads']);
        expect(bridge).toContain('a0: embind_rs::JsBigIntOptArg<u64>');
        expect(bridge).toContain('match a0.0 { None => None, Some(v) => match std::num::NonZeroU64::new(v) { Some(n) => Some(n), None => return embind_rs::raise_err(String::from("a NonZeroU64 cannot be 0")) } }');
        expect(bridge).toContain('match std::num::NonZeroU32::new(a0) { Some(n) => n, None => return embind_rs::raise_err(String::from("a NonZeroU32 cannot be 0")) }');
        expect(bridge).toContain('embind_rs::register_optional_bigint::<u64>();');
        expect(dts).toContain('setBlockSize(block_size: bigint | null | undefined): void;');
        expect(dts).toContain('setThreads(threads: number): void;');
    });

    test('a constructor takes up to 7 arguments, a stream constructor too', () => {
        const { model, logs, bridge } = bridgeOf(`
use std::io::Read;
pub struct Wide { total: u32 }
impl Wide {
    pub fn new(a: u32, b: u32, c: u32, d: u32, e: u32, f: u32, g: u32) -> Self { Wide { total: a + b + c + d + e + f + g } }
}
pub struct Wider { total: u32 }
impl Wider {
    pub fn new(a: u32, b: u32, c: u32, d: u32, e: u32, f: u32, g: u32, h: u32) -> Self { Wider { total: a + h } }
}
pub struct Unpacker<R: Read> { inner: R }
impl<R: Read> Unpacker<R> {
    pub fn new(inner: R, size: u64, lc: u32, lp: u32, pb: u32, dict: u32, preset: Option<&[u8]>) -> std::io::Result<Self> { Ok(Unpacker { inner }) }
}
impl<R: Read> Read for Unpacker<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> { self.inner.read(buf) }
}
`);
        expect(model.classes.find((c) => c.name === 'Wide').ctor.args).toHaveLength(7);
        expect(model.streams.find((s) => s.name === 'Unpacker').ctor.args).toHaveLength(7);
        expect(logs).toContain('crossbind: rust bridge: Wider::new skipped (max 7 args)');
        expect(bridge).toContain('.constructor_ptr7(__wide_new)');
        expect(bridge).toContain('.constructor_ptr7(__unpacker_new)');
        expect(bridge).not.toContain('__wider_new');
    });

    test('a type declared further down the file is known to the bindings above it', () => {
        const { model, logs } = parseLogged(`
pub struct A { n: u32 }
impl A {
    pub fn new() -> Self { A { n: 0 } }
    pub fn later(&self) -> B { B { n: 0 } }
    pub fn take(&self, other: &B) -> u32 { other.n }
}
pub fn make_b() -> B { B { n: 0 } }
impl C {
    pub fn value(&self) -> u32 { 1 }
}
pub struct B { n: u32 }
impl B {
    pub fn n(&self) -> u32 { self.n }
}
pub struct C { n: u32 }
`);
        expect(logs.filter((l) => l.includes('skipped'))).toEqual([]);
        expect(model.classes.find((c) => c.name === 'A').methods.map((m) => m.name)).toEqual(['later', 'take']);
        expect(model.freeFns.map((f) => f.name)).toEqual(['make_b']);
        expect(model.classes.find((c) => c.name === 'C').methods.map((m) => m.name)).toEqual(['value']);
    });

    test('a generic impl block is not read as free functions', () => {
        const { model } = parseLogged(`
pub struct Writer<W> { inner: W }
impl<W: std::io::Write> Writer<W> {
    pub fn new(inner: W) -> Self { Writer { inner } }
    pub fn helper(level: u32) -> u32 { level }
}
pub struct Wrapper<T> { inner: T }
impl Wrapper<u8> {
    pub fn raw(x: u32) -> u32 { x }
}
pub fn real(x: u32) -> u32 { x }
`);
        expect(model.freeFns.map((f) => f.name)).toEqual(['real']);
    });
});

describe('JSON values (serde_json::Value)', () => {
    const JSON_RS = `
use serde_json::Value;

pub struct Probe { n: i64 }

impl Probe {
    pub fn new() -> Self { Probe { n: 1 } }
    pub fn echo(&self, v: serde_json::Value) -> serde_json::Value { v }
}

pub fn pick(v: Value, key: &str) -> Result<serde_json::Value, String> {
    v.get(key).cloned().ok_or_else(|| String::from("missing"))
}
`;

    test('parses both spellings into the canonical Json token and flags the model', () => {
        const model = parseSurface(JSON_RS, () => {});

        expect(model.usesJson).toBe(true);
        const echo = model.classes[0].methods.find((m) => m.name === 'echo');
        expect(echo.args[0].ty).toBe('Json');
        expect(echo.ret).toBe('Json');
        const pick = model.freeFns.find((f) => f.name === 'pick');
        expect(pick.args[0].ty).toBe('Json');
        expect(pick.ret).toBe('Json');
        expect(pick.throws).toBe(true);
    });

    test('bare Value without a serde_json import is refused with a reason', () => {
        const logs = [];

        const model = parseSurface('pub fn f(v: Value) -> i32 { 1 }\n', (l) => logs.push(l));

        expect(model.usesJson).toBe(false);
        expect(model.freeFns).toHaveLength(0);
        expect(logs.join('\n')).toContain('unsupported parameter');
    });

    test('shared ownership (Arc): parses factories/params, guards &mut self, emits the shared wire', () => {
        const ARC_RS = `
use std::sync::Arc;

pub struct Doc { label: String }

impl Doc {
    pub fn create(label: &str) -> Arc<Self> { Arc::new(Doc { label: label.to_string() }) }
    pub fn label(&self) -> String { self.label.clone() }
    pub fn same_as(&self, other: Arc<Doc>) -> bool { std::ptr::eq(self, Arc::as_ptr(&other)) }
}

pub fn dup_doc(d: Arc<Doc>) -> Arc<Doc> { d }
`;
        const model = parseSurface(ARC_RS, () => {});
        expect(model.sharedOf).toEqual(['Doc']);
        const doc = model.classes.find((c) => c.name === 'Doc');
        expect(doc.shared).toBe(true);
        expect(doc.factories[0].shared).toBe(true);
        expect(doc.methods.find((m) => m.name === 'same_as').args[0].ty).toBe('Arc<Doc>');
        expect(model.freeFns.find((f) => f.name === 'dup_doc').ret).toBe('Arc<Doc>');

        expect(() => parseSurface(`
use std::sync::Arc;
pub struct Doc { n: i32 }
impl Doc {
    pub fn create() -> Arc<Self> { Arc::new(Doc { n: 0 }) }
    pub fn bump(&mut self) -> i32 { self.n += 1; self.n }
}
`, () => {})).toThrow(/must take &self/);

        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-arc-rs-'));
        try {
            const rsFile = path.join(work, 'doc.rs');
            fs.writeFileSync(rsFile, ARC_RS);
            const { bridgeDir } = createRustBridgeCrate({
                rsFile, cacheDir: path.join(work, '.crossbind'), projectPath: work, log: () => {},
            });
            const bridge = fs.readFileSync(path.join(bridgeDir, 'src/lib.rs'), 'utf8');
            expect(bridge).toContain('.smart_ptr_shared("DocShared")');
            expect(bridge).toContain('.create_arc1("create"');
            expect(bridge).toContain('pub struct DocShared(pub std::sync::Arc<user::Doc>);');
            expect(bridge).toContain('increment_strong_count');
            const dts = fs.readFileSync(path.join(work, '.crossbind/types/doc.rs.d.ts'), 'utf8');
            expect(dts).toContain('static create(label: string): Doc;');
            expect(dts).toContain('dupDoc(d: Doc): Doc;');
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    });

    test('live JS values: parses JsValue/JsFunction tokens, refuses them without the import', () => {
        const JS_RS = `
use embind_rs::{JsFunction, JsValue};

pub fn pass(v: JsValue) -> JsValue { v }
pub fn apply(f: JsFunction, x: f64) -> Result<JsValue, String> { f.call1(&JsValue::from_f64(x)) }
`;
        const model = parseSurface(JS_RS, () => {});
        const pass = model.freeFns.find((f) => f.name === 'pass');
        expect(pass.args[0].ty).toBe('JsValue');
        expect(pass.ret).toBe('JsValue');
        const apply = model.freeFns.find((f) => f.name === 'apply');
        expect(apply.args[0].ty).toBe('JsFunction');
        expect(apply.throws).toBe(true);

        const logs = [];
        const bare = parseSurface('pub fn f(v: JsValue) -> i32 { 1 }\n', (l) => logs.push(l));
        expect(bare.freeFns).toHaveLength(0);
        expect(logs.join('\n')).toContain('unsupported parameter');

        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-jsval-rs-'));
        try {
            const rsFile = path.join(work, 'live.rs');
            fs.writeFileSync(rsFile, JS_RS);
            const { bridgeDir } = createRustBridgeCrate({
                rsFile, cacheDir: path.join(work, '.crossbind'), projectPath: work, log: () => {},
            });
            const bridge = fs.readFileSync(path.join(bridgeDir, 'src/lib.rs'), 'utf8');
            expect(bridge).toContain('a0: embind_rs::JsValue');
            const dts = fs.readFileSync(path.join(work, '.crossbind/types/live.rs.d.ts'), 'utf8');
            expect(dts).toContain('pass(v: unknown): unknown;');
            expect(dts).toContain('apply(f: (...args: unknown[]) => unknown, x: number): unknown;');
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    });

    test('fixed-size array parameter keeps its length and is borrowed at the call site', () => {
        const ARR_RS = `
pub fn checksum(bytes: &[u8; 4]) -> i32 { bytes.iter().map(|b| *b as i32).sum() }
`;
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-arr-rs-'));
        try {
            const rsFile = path.join(work, 'arr.rs');
            fs.writeFileSync(rsFile, ARR_RS);
            const { bridgeDir } = createRustBridgeCrate({
                rsFile, cacheDir: path.join(work, '.crossbind'), projectPath: work, log: () => {},
            });
            const bridge = fs.readFileSync(path.join(bridgeDir, 'src/lib.rs'), 'utf8');
            expect(bridge).toContain('&__crossbind_from_json::<[u8; 4]>(a0.0)');
            expect(bridge).not.toContain('Vec<u8; 4>');
            const dts = fs.readFileSync(path.join(work, '.crossbind/types/arr.rs.d.ts'), 'utf8');
            expect(dts).toContain('checksum(bytes: number[]): number;');
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    });

    test('generated crate carries the wire impl, one serde dep and the JsonValue dts', () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-json-rs-'));
        try {
            const rsFile = path.join(work, 'probe.rs');
            fs.writeFileSync(rsFile, JSON_RS);

            const { bridgeDir } = createRustBridgeCrate({
                rsFile,
                cacheDir: path.join(work, '.crossbind'),
                projectPath: work,
                cargoDependencies: { serde_json: '1' },
                log: () => {},
            });

            const bridge = fs.readFileSync(path.join(bridgeDir, 'src/lib.rs'), 'utf8');
            expect(bridge).toContain('pub struct __CrossbindJson(pub serde_json::Value);');
            expect(bridge).toContain("const SIG: char = 'i';");
            expect(bridge).toContain('crossbind_emval_handle_to_json');
            const manifest = fs.readFileSync(path.join(bridgeDir, 'Cargo.toml'), 'utf8');
            expect(manifest.match(/serde_json/g)).toHaveLength(1);
            const dts = fs.readFileSync(path.join(work, '.crossbind/types/probe.rs.d.ts'), 'utf8');
            expect(dts).toContain('export type JsonValue');
            expect(dts).toContain('echo(v: JsonValue): JsonValue;');
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
        }
    });
});
