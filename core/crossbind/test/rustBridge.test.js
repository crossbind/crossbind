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
