import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import resolveEmbindRustRoot, { embindRustVersion } from './resolveEmbindRust.js';
import runCargo, { toHostPath } from './runCargo.js';
import writeIfChanged from './writeIfChanged.js';

// Generates the embind bridge for a cargo package as a COMPANION CRATE, the Rust analog of the
// C++ .i.cpp bridges: the user's crate stays plain Rust (no embind-rs dependency, no macro line)
// and crossbind emits <pkg>/.crossbind/bridge-crate/ which depends on the user crate by path and holds
// all registrations (newtype wrappers dodge the orphan rule; shim fns adapt &self and enum/value
// object types). buildCargo compiles the bridge crate; its staticlib bundles the user crate.
//
// v1 surface grammar (parsed from src/lib.rs, rustfmt-style):
//   #[repr(i32)] pub enum E { A = 0, .. }                  -> enum
//   #[repr(C)] #[derive(..Default..Copy..)] pub struct V   -> value object (pub fields)
//   pub struct C + inherent `impl C { pub fn .. }`         -> class
//     pub fn new(..) -> Self                               -> constructor (<=3 args)
//     pub fn other(..) -> Self                             -> smart_ptr factory (<=2 args)
//     pub fn m(&mut self / &self, ..) -> R                 -> method (<=4 args), JS name camelCase
//   top-level pub fn f(..) -> R                            -> free function (<=4 args)
//   impl Display for C                                     -> toString() on the class
//   params may also be &str / &String (String on the wire, borrowed at the call site)
//   a returned &str / &String comes back owned (a JS string);
//   i64 / u64 cross as JS BigInt, the narrower integers and f32 as numbers, char as a
//   one-character string; Result<T, E> in any return above throws in JS on Err
//   (E: Display); Option<Self> factories return JS null; Option<i32/f64/bool/String> works in
//   params (undefined/null -> None) and returns (None -> null); other Option shapes skip
//   vectors come from crossbind.config.mjs: export.bindings.vectors = [{ of: 'i32', name: '..' }]
// Anything outside this surface is skipped WITH a log line - never silently.

const PRIMITIVES = new Set(['i32', 'i64', 'u64', 'f64', 'bool', 'String', '()',
    'i8', 'i16', 'u8', 'u16', 'u32', 'f32', 'usize', 'isize', 'char']);
const PARAM_ONLY = new Set(['&str', '&String']);
const OPTION_INNERS = new Set(['i32', 'f64', 'bool', 'String']);
const OPTION_PARAM_RE = /^Option<(i32|f64|bool|String|&str)>$/;
const OPTION_CLASS_REF_RE = /^Option<&(\w+)>$/;
const OPTIONAL_REG = { i32: 'register_optional_i32', f64: 'register_optional_f64', bool: 'register_optional_bool', String: 'register_optional_string' };
const VECTOR_ITEM_TYPES = new Set(['i32', 'f64', 'bool']);
// serde_json::Value params/returns cross as a deep JSON copy (adapter-side codec, canonical
// token 'Json'); the bare `Value` spelling counts only when the file imports serde_json.
const JSON_TY = 'Json';
// A closure parameter (`impl Fn(..) -> R` or `Box<dyn Fn(..) -> R>`) takes a JS function: the
// shim wraps it so the Rust side calls back through the live handle.
const CLOSURE_RE = /^(?:impl\s+Fn|Box<\s*dyn\s+Fn)\s*\(([^)]*)\)\s*(?:->\s*([\w:<>&' ]+?)\s*)?(?:>\s*)?(?:\+[^>]*)?$/;
function closureShape(ty) {
    const text = String(ty).replace(/\s+/g, ' ').trim();
    const m = text.match(CLOSURE_RE);
    if (!m) return null;
    const boxed = text.startsWith('Box<');
    const args = (m[1] ?? '').split(',').map((a) => a.trim()).filter(Boolean);
    const ret = (m[2] ?? '()').replace(/>\s*$/, '').trim();
    const CLOSURE_ARGS = new Set(['i32', 'f64', 'bool', 'String', '&str']);
    if (!args.every((a) => CLOSURE_ARGS.has(a))) return null;
    if (!['i32', 'f64', 'bool', 'String', '()'].includes(ret)) return null;
    return { args, ret, boxed };
}
// Collections cross as plain JS arrays and objects. They ride the JSON wire, so the element type
// only has to be something serde can write: primitives, String, nested collections, and user
// structs that derive Serialize/Deserialize. The canonical token keeps the Rust spelling, so the
// shim can name the exact type it converts to.
const COLLECTION_RE = /^(?:Vec<.+>|\[.+;\s*\d+\]|&\[.+\]|\(.+,.*\)|(?:std::collections::)?(?:HashMap|BTreeMap|HashSet|BTreeSet)<.+>)$/;
// `&[u8]` / `Vec<u8>` and `&[f64]` / `Vec<f64>` are typed arrays on the JS side.
const TYPED_ARRAYS = {
    'Vec<u8>': { wrapper: 'JsBytes', owned: 'Vec<u8>', slice: false },
    '&[u8]': { wrapper: 'JsBytes', owned: 'Vec<u8>', slice: true },
    'Vec<f64>': { wrapper: 'JsF64s', owned: 'Vec<f64>', slice: false },
    '&[f64]': { wrapper: 'JsF64s', owned: 'Vec<f64>', slice: true },
};
const typedArrayOf = (ty) => TYPED_ARRAYS[String(ty).replace(/\s+/g, '')] ?? null;

const isCollection = (ty) => {
    if (typedArrayOf(ty)) return false;
    const text = String(ty).trim();
    if (COLLECTION_RE.test(text)) return true;
    // An optional collection rides the same wire: JSON writes None as null.
    const inner = text.match(/^Option<(.+)>$/)?.[1];
    return Boolean(inner && COLLECTION_RE.test(inner.trim()));
};

// A user type inside a collection travels as JSON, so it has to derive Serialize/Deserialize.
// Types crossbind knows by itself (primitives, String) always do.
function collectionCarries(ty, ctx) {
    const names = String(ty).match(/\b[A-Z]\w*\b/g) ?? [];
    return names.every((name) => {
        const vo = (ctx.valueObjects ?? []).find((v) => v.name === name);
        if (vo) return Boolean(vo.serde);
        const known = (ctx.classes?.has?.(name)) || (ctx.enums ?? []).some((e) => e.name === name)
            || (ctx.newtypes ?? []).some((n) => n.name === name);
        return !known;
    });
}
const isJsonSpelling = (ty, ctx) => Boolean(ctx?.allowJson)
    && (ty === 'serde_json::Value' || (Boolean(ctx.hasSerdeUse) && ty === 'Value'));
// Arc<Class> params/returns (shared ownership): canonical token 'Arc<X>'; the bare `Arc`
// spelling counts only when the file imports std::sync::Arc. Same app-surface gate as Json.
const ARC_RE = /^Arc<(\w+)>$/;
const normalizeArc = (ty, ctx) => {
    if (!ctx?.allowJson) return ty;
    const m = ty.match(/^(?:std::sync::)?Arc<(\w+)>$/);
    if (!m) return ty;
    if (!ty.startsWith('std::sync::') && !ctx.hasArcUse) return ty;
    return `Arc<${m[1]}>`;
};
// Live JS handles (embind_rs::JsValue / JsFunction): bare spellings count only when the file
// imports from embind_rs - the one deliberate coupling of the E2 surface.
const JS_TOKS = new Set(['JsValue', 'JsFunction']);
// Returns the canonical token only when the spelling is ELIGIBLE (qualified, or bare with the
// embind_rs import present) - the token equals the bare name, so acceptance must key on this
// result, never on the raw string.
const matchJsTok = (ty, ctx) => {
    if (!ctx?.allowJson) return null;
    const m = String(ty).match(/^(?:embind_rs::)?(JsValue|JsFunction)$/);
    if (!m) return null;
    if (!String(ty).startsWith('embind_rs::') && !ctx.hasEmbindUse) return null;
    return m[1];
};
const FN_SIG_RE = /^pub (?:const )?fn (\w+)\s*\(([^)]*)\)\s*(?:->\s*([\w:<>(),& ]+?))?\s*\{/;

// The parameter list is read by counting parentheses, because a closure parameter carries its
// own: `f: impl Fn(i32) -> i32` would end the list early for a regex.
function matchFnSignature(line) {
    const head = /^pub (?:const )?fn (\w+)\s*\(/.exec(line);
    if (!head) return null;
    let depth = 0;
    let end = -1;
    for (let i = head[0].length - 1; i < line.length; i += 1) {
        if (line[i] === '(') depth += 1;
        else if (line[i] === ')') {
            depth -= 1;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) return null;
    const params = line.slice(head[0].length, end);
    // The body may start on the same line, so the return type ends at the opening brace.
    const brace = line.indexOf('{', end);
    if (brace === -1) return null;
    const rest = line.slice(end + 1, brace).trim();
    const ret = rest.startsWith('->') ? rest.slice(2).trim() : undefined;
    return [line, head[1], params, ret];
}

export default function generateRustBridge({ crateDir, vectors = [], dtsFile = null, keepName = null, dtsMode = 'sync', log = console.log }) {
    const libRsPath = `${crateDir}/src/lib.rs`;
    if (!fs.existsSync(libRsPath)) throw new Error(`crossbind: rust bridge: ${libRsPath} not found`);
    const rawCrateName = readCrateName(crateDir);
    const userCrate = rawCrateName.replaceAll('-', '_');
    const src = fs.readFileSync(libRsPath, 'utf8');

    const model = parseSurface(src, log);
    let bridge = emitBridge(model, { userCrate, vectors, log });
    // Rust archives are linked LAZILY (never force_load/whole-archive: each staticlib bundles its
    // own libstd, and fully loading two of them duplicates thousands of std symbols). Instead the
    // consumer pins this keep symbol (-u/--undefined); codegen-units=1 puts it in the same object
    // as the init-array constructor, so pulling it pulls the registrations - and only them.
    if (keepName) bridge += `\n#[no_mangle]\npub extern "C" fn crossbind_keep_${keepName}() {}\n`;
    if (dtsFile) writeIfChanged(dtsFile, emitDts(model, vectors, dtsMode));

    const bridgeDir = `${crateDir}/.crossbind/bridge-crate`;
    const embindRsDir = resolveEmbindRsDir();
    const manifest = [
        '# Generated by crossbind rustBridgeGen - do not edit.',
        `# embind-rs from @crossbind/core-embind-rust ${embindRustVersion()}`,
        '[package]',
        `name = "${userCrate.replaceAll('_', '-')}-crossbind-bridge"`,
        'version = "0.0.0"',
        'edition = "2021"',
        '',
        '[lib]',
        `name = "${userCrate}_crossbind_bridge"`,
        'crate-type = ["staticlib"]',
        '',
        '[dependencies]',
        `${userCrate} = { package = "${rawCrateName}", path = "${relPath(bridgeDir, crateDir)}" }`,
        `embind-rs = { path = "${relPath(bridgeDir, embindRsDir)}" }`,
        ...(model.usesJson ? ['serde = "1"', 'serde_json = "1"'] : []),
        '',
        '[profile.release]',
        // Unwinding, not abort: the shims catch a panic and raise it as a JS exception.
        'panic = "unwind"',
        '# One object per crate: the keep symbol and the init-array ctor must share an object.',
        'codegen-units = 1',
        '',
        '# Isolated on purpose: never join a surrounding workspace.',
        '[workspace]',
        '',
    ].join('\n');

    writeIfChanged(`${bridgeDir}/Cargo.toml`, manifest);
    writeIfChanged(`${bridgeDir}/src/lib.rs`, bridge);
    return { bridgeDir, crateName: `${userCrate}_crossbind_bridge` };
}

// App-local .rs files (the Rust analog of an app's own .h) get a SELF-CONTAINED synthesized
// crate: the user file is embedded via `#[path] mod user;` (no copy) and the bridge lives in the
// same crate, so registrations reference `user::Type` directly. The bundler transformer calls
// this on import (like createBridgeFile for C++); the native builds compile every crate under
// <project>/.crossbind/rust-bridges/ and link the staticlibs whole-archive.
export function createRustBridgeCrate({ rsFile, cacheDir, projectPath, vectors = [], cargoDependencies = {}, dtsMode = 'sync', log = console.log }) {
    const stem = path.basename(rsFile, '.rs').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    const dir = `${cacheDir}/rust-bridges/${stem}`;
    const model = parseSurface(fs.readFileSync(rsFile, 'utf8'), log);
    const bridge = emitBridge(model, {
        userCrate: 'user',
        vectors,
        log,
        prelude: `#[path = "${relPath(`${dir}/src`, rsFile)}"]\nmod user;`,
    });

    const manifest = [
        '# Generated by crossbind rustBridgeGen - do not edit.',
        `# embind-rs from @crossbind/core-embind-rust ${embindRustVersion()}`,
        '[package]',
        `name = "${stem.replaceAll('_', '-')}-crossbind-app"`,
        'version = "0.0.0"',
        'edition = "2021"',
        '',
        '[lib]',
        `name = "${stem}_crossbind_app"`,
        '# rlib: bundled into the single app super-crate (one libstd for all app-local surfaces).',
        'crate-type = ["rlib"]',
        '',
        '[dependencies]',
        `embind-rs = { path = "${relPath(dir, resolveEmbindRsDir())}" }`,
        // The app config's top-level cargoDependencies, so an app-local surface can use
        // upstream crates directly (values: a version string, or a verbatim `{ ... }` spec).
        ...Object.entries(cargoDependencies).map(([name, spec]) => (
            String(spec).trim().startsWith('{') ? `${name} = ${spec}` : `${name} = "${spec}"`
        )),
        ...(model.usesJson && !cargoDependencies.serde ? ['serde = "1"'] : []),
        ...(model.usesJson && !cargoDependencies.serde_json ? ['serde_json = "1"'] : []),
        '',
        '[profile.release]',
        // Unwinding, not abort: the shims catch a panic and raise it as a JS exception.
        'panic = "unwind"',
        'codegen-units = 1',
        '',
        '# Isolated on purpose: never join a surrounding workspace.',
        '[workspace]',
        '',
    ].join('\n');

    writeIfChanged(`${dir}/Cargo.toml`, manifest);
    writeIfChanged(`${dir}/src/lib.rs`, bridge);
    // Relative `./x.rs` imports are typed by path resolution (ambient declarations only work
    // for non-relative names like `cargo:x`), so the declaration mirrors the project-relative
    // path under the language-neutral <cache>/types/ overlay (same home as .h declarations);
    // @crossbind/typescript-config wires the rootDirs and keeps user folders free of generated files.
    writeIfChanged(`${cacheDir}/types/${path.relative(projectPath, rsFile)}.d.ts`, emitDts(model, vectors, dtsMode));
    return { bridgeDir: dir, crateName: `${stem}_crossbind_app`, model };
}

// Direct CRATE import (`import { X } from 'cargo:uuid'` with top-level `cargoDependencies`
// declaring `uuid`): no surface file and no package - the bridge is generated from the
// upstream crate's OWN multi-file source. cargo metadata (which fetches on first run) locates
// the source and the resolved feature set; the bridge crate is a normal rlib under
// rust-bridges/, so the app super-staticlib flow links it like any app-local surface.
const crateModelCache = new Map();
export function createCrateImportBridge({ crateName, spec, cacheDir, dtsMode = 'sync', log = console.log }) {
    const stem = `crate_${crateName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`;
    const dir = `${cacheDir}/rust-bridges/${stem}`;
    const depLine = String(spec).trim().startsWith('{') ? `${crateName} = ${spec}` : `${crateName} = "${spec}"`;
    // The surface is only known after cargo metadata, which itself needs a manifest: the first
    // write is the minimal one, the second adds the JSON wire's dependencies once the model says
    // the bridge needs them.
    const manifestWith = (extraDeps) => [
        '# Generated by crossbind rustBridgeGen - do not edit.',
        `# embind-rs from @crossbind/core-embind-rust ${embindRustVersion()}`,
        '[package]',
        `name = "${stem.replaceAll('_', '-')}-crossbind-app"`,
        'version = "0.0.0"',
        'edition = "2021"',
        '',
        '[lib]',
        `name = "${stem}_crossbind_app"`,
        '# rlib: bundled into the single app super-crate (one libstd for all app-local surfaces).',
        'crate-type = ["rlib"]',
        '',
        '[dependencies]',
        depLine,
        `embind-rs = { path = "${relPath(dir, resolveEmbindRsDir())}" }`,
        ...extraDeps,
        '',
        '[profile.release]',
        // Unwinding, not abort: the shims catch a panic and raise it as a JS exception.
        'panic = "unwind"',
        'codegen-units = 1',
        '',
        '# Isolated on purpose: never join a surrounding workspace.',
        '[workspace]',
        '',
    ].join('\n');
    writeIfChanged(`${dir}/Cargo.toml`, manifestWith([]));
    // cargo metadata needs a resolvable lib target before the real bridge exists.
    if (!fs.existsSync(`${dir}/src/lib.rs`)) writeIfChanged(`${dir}/src/lib.rs`, '// crossbind placeholder\n');

    const cacheKey = `${dir}|${depLine}`;
    let model = crateModelCache.get(cacheKey);
    if (!model) {
        let meta;
        try {
            const probe = runCargo(['metadata', '--format-version', '1', '--manifest-path', `${dir}/Cargo.toml`], {
                capture: true, maxBuffer: 128 * 1024 * 1024,
            });
            if (probe.status !== 0) throw new Error(String(probe.stderr ?? '').trim() || `exit code ${probe.status}`);
            meta = JSON.parse(probe.stdout);
        } catch (e) {
            throw new Error(`crossbind: crate import '${crateName}': cargo metadata failed (${e.message})`, { cause: e });
        }
        const pkg = meta.packages.find((p) => p.name === crateName);
        if (!pkg) throw new Error(`crossbind: crate import '${crateName}': crate not found in the cargo dependency graph`);
        const features = meta.resolve?.nodes?.find((n) => n.id === pkg.id)?.features ?? [];
        const srcDir = path.join(path.dirname(toHostPath(pkg.manifest_path)), 'src');
        model = parseCrateSurface({ srcDir, features, log });
        // Always audible (the transformer silences routine skip-noise): an empty surface means
        // the import will bind NOTHING - generic/re-export-style crates need an app-local .rs.
        if (!model.classes.length && !model.enums.length && !model.freeFns.length) {
            console.warn(`crossbind: crate import '${crateName}' has no bindable surface (its lib.rs defines no in-grammar types) - write an app-local surface .rs over it instead`);
        }
        crateModelCache.set(cacheKey, model);
    }

    const jsonDeps = ['serde', 'serde_json'].filter((dep) => dep !== crateName).map((dep) => `${dep} = "1"`);
    writeIfChanged(`${dir}/Cargo.toml`, manifestWith(model.usesJson ? jsonDeps : []));
    // Two crates can export the same type name (semver::Version and uuid::Version both do), so a
    // crate import registers under `<crate>_<Name>` and the proxy module re-exports the clean name.
    const namePrefix = `${crateName.replaceAll('-', '_')}_`;
    const bridge = emitBridge(model, { userCrate: crateName.replaceAll('-', '_'), vectors: [], log, namePrefix });
    writeIfChanged(`${dir}/src/lib.rs`, bridge);
    // Editor types for the `cargo:<crate>` import: an ambient module the app's tsconfig
    // includes (e.g. "include": ["**/*", ".crossbind/rust-crates/types/**/*.d.ts"]). The scheme
    // keeps the module name unique, so npm packages/@types of the same name never clash.
    const dtsBody = emitDts(model, [], dtsMode).split('\n').map((l) => (l ? `    ${l}` : l)).join('\n');
    writeIfChanged(`${cacheDir}/rust-crates/types/${crateName}.d.ts`, `declare module 'cargo:${crateName}' {\n${dtsBody}\n}\n`);
    return {
        bridgeDir: dir, crateName: `${stem}_crossbind_app`, model, namePrefix,
    };
}

// The embind-rs runtime crate ships inside @crossbind/core-embind-rust; the consumer (a plugin
// or the package itself) declares that dependency and resolveEmbindRust finds it.
function resolveEmbindRsDir() {
    return `${resolveEmbindRustRoot()}/crate`;
}

// Returns the RAW [package] name (dashes kept): cargo dependency lookups need it verbatim.
// Callers wanting the crate/lib identifier convert dashes to underscores themselves.
// Generated manifests address their siblings relatively. An absolute path bakes in the host
// checkout, which is wrong the moment the same tree is read from anywhere else - a container mount
// being the case that made this visible. Cargo resolves `path` against the manifest's directory
// and `#[path]` against the file carrying it, so a relative value is correct in both worlds.
export function relPath(fromDir, target) {
    return path.relative(fromDir, target).split(path.sep).join('/') || '.';
}

export function readCrateName(crateDir) {
    const toml = fs.readFileSync(`${crateDir}/Cargo.toml`, 'utf8');
    const name = toml.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    if (!name) throw new Error(`crossbind: could not read [package] name from ${crateDir}/Cargo.toml`);
    return name;
}


// ---------------- parser ----------------

export function parseSurface(src, log) {
    const acc = newAcc();
    scanSource(src, acc, { collectTypes: true, log });
    return finalizeModel(acc, log);
}

// Parses an UPSTREAM crate for a direct crate import (`import .. from '<crate>'`): exported
// types come from lib.rs; inherent impls and `impl Display` are collected across the crate's
// `mod`-declared files, following the resolved feature set for cfg-gated modules.
export function parseCrateSurface({ srcDir, features = [], log = console.log }) {
    const acc = newAcc();
    const enabled = new Set(features);
    const seen = new Set();
    const walk = (file, modPath) => {
        if (seen.has(file) || !fs.existsSync(file)) return;
        seen.add(file);
        // Root and glob-re-exported modules collect their pub types; other modules only
        // contribute impls (plus types individually re-exported by name).
        const collectTypes = modPath.length === 0 || acc.globModules.has(modPath.join('::'));
        const mods = scanSource(fs.readFileSync(file, 'utf8'), acc, { collectTypes, log });
        const childBase = file.endsWith('lib.rs') || file.endsWith('mod.rs') ? path.dirname(file) : file.slice(0, -3);
        for (const m of mods) {
            if (!cfgEnabled(m.cfg, enabled)) continue;
            walk(path.join(childBase, `${m.name}.rs`), [...modPath, m.name]);
            walk(path.join(childBase, m.name, 'mod.rs'), [...modPath, m.name]);
        }
    };
    walk(path.join(srcDir, 'lib.rs'), []);
    return finalizeModel(acc, log);
}

function newAcc() {
    return {
        enums: [],        // { name, variants: [{ name, value }] }
        valueObjects: [], // { name, fields: [{ name, type }] }
        newtypes: [],     // { name, inner } - crosses as the inner value
        jsonTypes: [],    // { name } - data enums that cross as a plain JS value
        consts: [],       // { name, ty, value } - registered as a module constant
        classes: new Map(), // name -> { name, ctor, factories: [], methods: [], hasDisplay }
        freeFns: [],      // { name, jsName, args, ret, throws }
        displayNames: new Set(),
        wantedTypes: new Set(),  // type names re-exported from lib.rs (`pub use ..::{X}`)
        globModules: new Set(),  // module paths glob-re-exported from lib.rs (`pub use ..::m::*`)
    };
}

// `#[cfg(..)]` on a `mod` line: null = ungated; no feature tokens = never enabled (so
// cfg(test) / cfg(target_os = ..) modules are skipped).
function cfgOf(attrs) {
    const cfg = attrs.find((a) => a.startsWith('#[cfg('));
    if (!cfg) return null;
    const features = [...cfg.matchAll(/feature\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    return { features, any: /cfg\(any/.test(cfg) };
}

function cfgEnabled(cfg, enabled) {
    if (cfg === null) return true;
    if (cfg.features.length === 0) return false;
    return cfg.any ? cfg.features.some((f) => enabled.has(f)) : cfg.features.every((f) => enabled.has(f));
}

// Scans ONE source file into the accumulator; returns the `mod name;` declarations found.
// collectTypes: types and free fns register only from the crate root (lib.rs) - module files
// contribute impls (methods, factories, Display) for already-known types.
function scanSource(src, acc, { collectTypes, log }) {
    const { enums, valueObjects, newtypes, jsonTypes, consts, classes, freeFns, displayNames, wantedTypes } = acc;
    acc.hasSerdeUse ||= /\buse\s+serde_json\b/.test(src);
    acc.hasArcUse ||= /\buse\s+std::sync::(?:Arc\b|\{[^}]*\bArc\b)/.test(src);
    acc.hasEmbindUse ||= /\buse\s+embind_rs::/.test(src);
    const mods = [];
    // Strip line comments; join multi-line `pub fn` signatures (to their brace) and multi-line
    // `pub use` re-export lists (to their semicolon).
    const rawLines = src.split('\n').map((l) => l.replace(/\/\/.*$/, ''));
    const lines = [];
    for (let i = 0; i < rawLines.length; i += 1) {
        let line = rawLines[i];
        if (/\bpub (?:const )?fn\b/.test(line)) {
            while (!line.includes('{') && !line.includes(';') && i + 1 < rawLines.length) {
                i += 1;
                line = `${line} ${rawLines[i].trim()}`;
            }
        } else if (/^\s*pub use\b/.test(line)) {
            while (!line.includes(';') && i + 1 < rawLines.length) {
                i += 1;
                line = `${line} ${rawLines[i].trim()}`;
            }
        }
        lines.push(line);
    }

    let attrs = [];
    for (let i = 0; i < lines.length; i += 1) {
        const t = lines[i].trim();
        if (t.startsWith('#[') || t.startsWith('#![')) { attrs.push(t); continue; }
        if (t === '') continue;

        // Crate-root re-exports make module-defined types part of the surface: capitalized
        // leaves of `pub use ..::{X, Y};` are collected when the defining module is scanned.
        if (collectTypes && t.startsWith('pub use ')) {
            // Named re-exports mark module types as surface; glob re-exports mark their whole
            // module as root-like (its pub types are collected when the walk reaches it).
            const body = t.replace(/^pub use\s+/, '').replace(/;.*$/, '').trim();
            const items = [];
            const braced = body.match(/^(?:crate::|self::)?(?:([\w:]+)::)?\{(.*)\}$/);
            if (braced) {
                const prefix = braced[1] ? `${braced[1]}::` : '';
                braced[2].split(',').map((s) => s.trim()).filter(Boolean)
                    .forEach((s) => items.push(prefix + s.replace(/^(?:crate::|self::)/, '')));
            } else {
                items.push(body.replace(/^(?:crate::|self::)/, ''));
            }
            for (const item of items) {
                if (item.endsWith('::*')) {
                    acc.globModules.add(item.slice(0, -3));
                } else {
                    const leaf = (item.split('::').pop() ?? '').replace(/\s+as\s+\w+$/, '');
                    if (/^[A-Z]\w*$/.test(leaf)) wantedTypes.add(leaf);
                }
            }
            attrs = [];
            continue;
        }

        let enumM = t.match(/^pub enum (\w+)/);
        if (enumM && !collectTypes && !wantedTypes.has(enumM[1])) enumM = null;
        let structM = t.match(/^pub struct (\w+)/);
        if (structM && !collectTypes && !wantedTypes.has(structM[1])) structM = null;
        const modM = t.match(/^(?:pub(?:\([^)]*\))?\s+)?mod (\w+)\s*([;{])/);
        // `pub const NAME: T = value;` (and `pub static`) - a value, not a getter, in JS.
        const constM = collectTypes ? t.match(/^pub (?:const|static) (\w+)\s*:\s*([\w()&' ]+?)\s*=\s*(.+?);$/) : null;
        const displayM = t.match(/^impl (?:[\w:]+::)?Display for (\w+)/);
        const traitImplM = !displayM && /^impl\b[^{]*\bfor\b/.test(t);
        const implM = displayM || traitImplM ? null : t.match(/^impl (\w+)\s*\{/);
        const freeFnM = collectTypes && !enumM && !structM && !modM && !displayM && !traitImplM && !implM
            ? matchFnSignature(t) : null;

        if (enumM) {
            const derive = attrs.find((a) => a.startsWith('#[derive')) ?? '';

            const variants = [];
            let idx = 0;
            for (i += 1; i < lines.length && !/^\}/.test(lines[i].trim()); i += 1) {
                const v = lines[i].trim().match(/^(\w+)(?:\s*=\s*(-?\d+))?\s*,?$/);
                if (v) { variants.push({ name: v[1], value: v[2] !== undefined ? Number(v[2]) : idx }); idx = variants.at(-1).value + 1; }
            }
            const hasSerde = derive.includes('Serialize') && derive.includes('Deserialize');
            if (variants.length) enums.push({ name: enumM[1], variants });
            // A variant that carries data cannot be an embind enum, but it can cross as a plain
            // JS value when the enum derives serde - in serde's own representation.
            else if (hasSerde) jsonTypes.push({ name: enumM[1] });
            else log(`crossbind: rust bridge: enum ${enumM[1]} skipped (a data enum crosses only when it derives Serialize and Deserialize)`);
        } else if (structM) {
            const isReprC = attrs.some((a) => /repr\(C\)/.test(a));
            const derive = attrs.find((a) => a.startsWith('#[derive')) ?? '';
            // A single-field tuple struct over a primitive is a newtype: it crosses as the inner
            // value, the way napi-rs spells `#[napi(transparent)]`.
            const newtypeM = t.match(/^pub struct (\w+)\s*\(\s*pub ([\w()]+)\s*,?\s*\)\s*;/);
            if (newtypeM && PRIMITIVES.has(newtypeM[2])) {
                newtypes.push({ name: newtypeM[1], inner: newtypeM[2] });
            } else if (isReprC) {
                const ok = derive.includes('Default') && derive.includes('Copy');
                const fields = [];
                for (i += 1; i < lines.length && !/^\}/.test(lines[i].trim()); i += 1) {
                    const f = lines[i].trim().match(/^pub (\w+)\s*:\s*([\w()]+)\s*,?$/);
                    // A field may be another value object: embind nests them, and the wrapper is
                    // repr(transparent) over the user struct, so the offset still lands right.
                    if (f && (PRIMITIVES.has(f[2]) || valueObjects.some((v) => v.name === f[2]))) fields.push({ name: f[1], type: f[2] });
                }
                if (ok && fields.length) valueObjects.push({ name: structM[1], fields, serde: derive.includes('Serialize') && derive.includes('Deserialize') });
                else log(`crossbind: rust bridge: struct ${structM[1]} skipped (repr(C) needs derive(Default, Copy) and pub primitive or value-object fields)`);
            } else if (derive.includes('Serialize') && derive.includes('Deserialize') && !newtypeM) {
                // Deriving serde says "this is data": it crosses as a plain JS object, and its
                // methods (if any) stay native, the way napi-rs separates #[napi(object)] from
                // #[napi].
                if (!jsonTypes.some((j) => j.name === structM[1])) jsonTypes.push({ name: structM[1] });
                if (t.endsWith('{')) { for (i += 1; i < lines.length && !/^\}/.test(lines[i].trim()); i += 1); }
            } else {
                if (!classes.has(structM[1])) classes.set(structM[1], { name: structM[1], ctor: null, factories: [], methods: [], fields: [], hasDefault: derive.includes('Default') });
                const cls = classes.get(structM[1]);
                cls.serde = derive.includes('Serialize') && derive.includes('Deserialize');
                // Public fields read and write as JS properties, the way napi-rs exposes them.
                if (t.endsWith('{')) {
                    for (i += 1; i < lines.length && !/^\}/.test(lines[i].trim()); i += 1) {
                        const f = lines[i].trim().match(/^pub (\w+)\s*:\s*([\w()]+)\s*,?$/);
                        if (f) cls.fields.push({ name: f[1], type: f[2] });
                    }
                }
            }
        } else if (constM) {
            const constTy = normalizeStringSpelling(constM[2]);
            if (PRIMITIVES.has(constTy) || constTy === '&str') consts.push({ name: constM[1], ty: constTy, value: constM[3].trim() });
            else log(`crossbind: rust bridge: const ${constM[1]} skipped (only i32, f64 and bool constants cross)`);
        } else if (modM) {
            // `mod x;` is followed for crate imports; inline `mod x { .. }` bodies are opaque.
            if (modM[2] === ';') mods.push({ name: modM[1], cfg: cfgOf(attrs) });
            else i = skipBlock(lines, i);
        } else if (displayM) {
            // `impl Display for X` -> a JS toString(); the block body itself is not parsed.
            displayNames.add(displayM[1]);
            i = skipBlock(lines, i);
        } else if (traitImplM) {
            i = skipBlock(lines, i);
        } else if (implM && classes.has(implM[1])) {
            const cls = classes.get(implM[1]);
            let depth = 1;
            for (i += 1; i < lines.length && depth > 0; i += 1) {
                const s = lines[i];
                const sig = matchFnSignature(s.trim());
                if (sig && depth === 1) parseFn(cls, sig, { enums, valueObjects, newtypes, jsonTypes, classes, allowJson: collectTypes, hasSerdeUse: acc.hasSerdeUse, hasArcUse: acc.hasArcUse, hasEmbindUse: acc.hasEmbindUse }, log);
                depth += (s.match(/\{/g) ?? []).length - (s.match(/\}/g) ?? []).length;
            }
            i -= 1;
        } else if (implM) {
            // Consume unknown-impl bodies so their fns are never misread as free functions.
            i = skipBlock(lines, i);
        } else if (freeFnM) {
            parseFreeFn(freeFns, freeFnM, { enums, valueObjects, newtypes, jsonTypes, classes, allowJson: collectTypes, hasSerdeUse: acc.hasSerdeUse, hasArcUse: acc.hasArcUse, hasEmbindUse: acc.hasEmbindUse }, log);
        }
        attrs = [];
    }
    return mods;
}

function finalizeModel(acc, log) {
    const { enums, valueObjects, newtypes, jsonTypes, consts, classes, freeFns, displayNames } = acc;
    // A class with no exported surface is dropped (with a note), mirroring the C++ generator.
    // A binding that borrows a dropped class would name a class that never registers and abort
    // the module at init, so dropping a class drops those bindings too, until nothing changes.
    const dropped = new Set();
    const borrowsDropped = (args) => args.some((p) => {
        const ty = String(p.ty);
        return (ty.startsWith('&') && dropped.has(ty.slice(1))) || dropped.has(ty.match(ARC_RE)?.[1]);
    });
    let changed = true;
    while (changed) {
        changed = false;
        for (const [name, cls] of classes) {
            if (!cls.ctor && !cls.factories.length && !cls.methods.length && !(cls.fields ?? []).length) {
                classes.delete(name);
                dropped.add(name);
                changed = true;
                log(`crossbind: rust bridge: struct ${name} has no exportable pub fns - not registered`);
            }
        }
        const keepFn = (owner) => (f) => {
            // A function that hands back a class the model dropped would name a type that never
            // registers, so it goes with it.
            if (f.ownedClass && dropped.has(f.ownedClass)) {
                changed = true;
                log(`crossbind: rust bridge: ${owner}${f.name} skipped (it returns a struct that is not registered)`);
                return false;
            }
            if (!borrowsDropped(f.args)) return true;
            changed = true;
            log(`crossbind: rust bridge: ${owner}${f.name} skipped (a parameter borrows a struct that is not registered)`);
            return false;
        };
        freeFns.splice(0, freeFns.length, ...freeFns.filter(keepFn('fn ')));
        for (const cls of classes.values()) {
            cls.methods = cls.methods.filter(keepFn(`${cls.name}::`));
            cls.factories = cls.factories.filter(keepFn(`${cls.name}::`));
            if (cls.ctor && borrowsDropped(cls.ctor.args)) { cls.ctor = null; changed = true; log(`crossbind: rust bridge: ${cls.name}::new skipped (a parameter borrows a struct that is not registered)`); }
        }
    }
    for (const cls of classes.values()) {
        cls.fields = (cls.fields ?? []).filter((f) => {
            const carries = PRIMITIVES.has(f.type) || enums.some((e) => e.name === f.type) || valueObjects.some((v) => v.name === f.type);
            if (!carries) log(`crossbind: rust bridge: ${cls.name}.${f.name} skipped (a property carries primitives, enums and value objects)`);
            return carries;
        });
    }
    for (const cls of classes.values()) {
        const collides = cls.methods.some((m) => camel(m.name) === 'toString');
        if (displayNames.has(cls.name) && collides) log(`crossbind: rust bridge: ${cls.name} Display->toString skipped (a toString method already exists)`);
        cls.hasDisplay = displayNames.has(cls.name) && !collides;
    }
    const isJsonRecordName = (ty) => {
        const text = String(ty).trim();
        const inner = text.match(/^Option<(.+)>$/)?.[1]?.trim() ?? text;
        return jsonTypes.some((j) => j.name === inner)
            || (text.startsWith('Option<') && valueObjects.some((v) => v.name === inner));
    };
    const anyJson = (args, ret) => args.some((p) => p.ty === JSON_TY || isCollection(p.ty) || isJsonRecordName(p.ty))
        || ret === JSON_TY || isCollection(ret) || isJsonRecordName(ret);
    const usesJson = freeFns.some((f) => anyJson(f.args, f.ret))
        || [...classes.values()].some((c) => (c.ctor && anyJson(c.ctor.args, '()'))
            || c.factories.some((f) => anyJson(f.args, '()'))
            || c.methods.some((m) => anyJson(m.args, m.ret)));

    // Shared (Arc) classes: collect every class named by an Arc<...> surface anywhere, then
    // enforce the shapes whose Box paths would corrupt the Arc-based delete()/share machinery.
    const sharedOf = new Set();
    const noteArc = (ty) => { const m = String(ty).match(ARC_RE); if (m) sharedOf.add(m[1]); };
    const noteAll = (args, ret) => { args.forEach((p) => noteArc(p.ty)); noteArc(ret); };
    freeFns.forEach((f) => noteAll(f.args, f.ret));
    for (const c of classes.values()) {
        if (c.factories.some((f) => f.shared)) sharedOf.add(c.name);
        if (c.ctor) noteAll(c.ctor.args, '()');
        c.factories.forEach((f) => noteAll(f.args, '()'));
        c.methods.forEach((m) => noteAll(m.args, m.ret));
    }
    for (const c of classes.values()) {
        if (!sharedOf.has(c.name)) continue;
        c.shared = true;
        if (c.ctor) {
            throw new Error(`crossbind: rust bridge: ${c.name} has Arc<...> surfaces, so a plain 'new' constructor cannot exist (its Box allocation would corrupt the shared delete()) - use a named factory returning Arc<Self>`);
        }
        const mut = c.methods.find((m) => !m.byRef);
        if (mut) {
            throw new Error(`crossbind: rust bridge: ${c.name} is shared via Arc<...>, so its methods must take &self ('${mut.name}' takes &mut self) - use interior mutability or drop the Arc surface`);
        }
        const boxed = c.factories.find((f) => !f.shared);
        if (boxed) {
            throw new Error(`crossbind: rust bridge: ${c.name} is shared via Arc<...>, so every factory must return Arc<Self> ('${boxed.name}' returns Self)`);
        }
    }
    return { enums, valueObjects, newtypes, jsonTypes, consts, classes: [...classes.values()], freeFns, usesJson, sharedOf: [...sharedOf].sort() };
}

// Consumes a brace-delimited block starting at line i; returns the closing line's index.
function skipBlock(lines, i) {
    let depth = 0;
    let started = false;
    for (; i < lines.length; i += 1) {
        const opens = (lines[i].match(/\{/g) ?? []).length;
        depth += opens - ((lines[i].match(/\}/g) ?? []).length);
        if (opens > 0) started = true;
        if (started && depth <= 0) break;
    }
    return i;
}

// Splits `Result<T, E>` / `Option<T>` off a return type; `Result<T>` (an alias like
// anyhow/io::Result) also matches - the shim's Ok/Err arms work on any core Result underneath.
// `&'static str` and `Cow<'_, str>` are the same JS string as `&str`.
function normalizeStringSpelling(ty) {
    const text = String(ty).trim();

    if (/^&\s*'\w+\s+str$/.test(text)) return '&str';
    // A Cow return becomes an owned String on the way out, like any borrowed string.
    if (/^(?:std::borrow::)?Cow<\s*(?:'\w+\s*,\s*)?str\s*>$/.test(text)) return '&str';
    return text;
}

// `Option<Record>` and `Option<ValueObject>` ride the JSON wire whole: null is the None.
function isOptionalRecord(ty, ctx) {
    const inner = String(ty).trim().match(/^Option<(.+)>$/)?.[1]?.trim();
    if (!inner || !ctx) return false;
    return (ctx.jsonTypes ?? []).some((j) => j.name === inner)
        || (ctx.valueObjects ?? []).some((v) => v.name === inner);
}

function analyzeReturn(raw, ctx) {
    // `impl Iterator<Item = T>` is read as the sequence it produces: the shim collects it, so JS
    // gets the values rather than a lazy iterator.
    const iterator = raw.trim().match(/^impl\s+Iterator\s*<\s*Item\s*=\s*(.+?)\s*>$/);
    if (iterator) return { inner: `Vec<${iterator[1].trim()}>`, throws: false, optional: false, collect: true };
    const r = normalizeStringSpelling(raw.trim());
    const res = unwrapGeneric(r, 'Result');
    // Only the Ok type crosses; the error type needs nothing but Display, so `Box<dyn Error>`
    // and friends are read past here.
    if (res !== null) {
        const ok = splitTopLevel(res)[0].trim();
        if (isCollection(ok)) return { inner: ok, throws: true, optional: false };
        const inner = unwrapGeneric(ok, 'Option');
        return inner !== null
            ? { inner: inner.trim(), throws: true, optional: true }
            : { inner: ok, throws: true, optional: false };
    }
    if (isCollection(r) || isOptionalRecord(r, ctx)) return { inner: r, throws: false, optional: false };
    const opt = unwrapGeneric(r, 'Option');
    if (opt !== null) return { inner: opt.trim(), throws: false, optional: true };
    return { inner: r, throws: false, optional: false };
}

// `Name<...>` -> the text between the outermost angle brackets, or null when the type is not
// that generic. Counting depth is what lets a nested generic (`Result<i32, Box<dyn Error>>`)
// keep its own commas.
function unwrapGeneric(ty, name) {
    const head = new RegExp(`^${name}\\s*<`).exec(ty);
    if (!head || !ty.endsWith('>')) return null;
    let depth = 0;
    for (let i = head[0].length - 1; i < ty.length; i += 1) {
        if (ty[i] === '<') depth += 1;
        else if (ty[i] === '>') {
            depth -= 1;
            if (depth === 0) return i === ty.length - 1 ? ty.slice(head[0].length, i) : null;
        }
    }
    return null;
}

function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
        // `->` is an arrow, not a closing angle bracket: a closure parameter has one.
        const isArrow = text[i] === '>' && text[i - 1] === '-';
        if (text[i] === '<' || text[i] === '(' || text[i] === '[') depth += 1;
        else if (!isArrow && (text[i] === '>' || text[i] === ')' || text[i] === ']')) depth -= 1;
        else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts;
}

function parseFn(cls, sig, ctx, log) {
    const { enums, valueObjects, classes } = ctx;
    const [, name, rawParams, rawRet] = sig;
    // A borrowed string is known in both directions: as a parameter it borrows, as a return it
    // comes back owned.
    const known = (ty) => PRIMITIVES.has(ty) || PARAM_ONLY.has(ty) || typedArrayOf(ty) || (isCollection(ty) && collectionCarries(ty, ctx))
        || enums.some((e) => e.name === ty) || valueObjects.some((v) => v.name === ty)
        || (ctx.newtypes ?? []).some((n) => n.name === ty)
        || (ctx.jsonTypes ?? []).some((j) => j.name === ty)
        || isOptionalRecord(ty, ctx);
    // `&OtherClass` params: the referenced struct must already be declared (parsed) above.
    const isClassRef = (ty) => ty.startsWith('&') && !PARAM_ONLY.has(ty) && classes.has(ty.slice(1));

    const params = splitTopLevel(rawParams).map((p) => p.trim()).filter(Boolean);
    let selfKind = null;
    if (params[0] === '&mut self' || params[0] === '&self') selfKind = params.shift();
    else if (params[0] === 'self' || params[0] === 'mut self') {
        log(`crossbind: rust bridge: ${cls.name}::${name} skipped (consuming self is not supported)`);
        return;
    }

    const args = [];
    for (const p of params) {
        const m = p.match(/^(\w+)\s*:\s*(&\s*(?:str|String)|Option\s*<\s*(?:i32|f64|bool|String|&\s*\w+)\s*>|Vec\s*<[^;]+>|\[[^\]]+;\s*\d+\]|&\s*\[[^\]]+\]|\([^)]*,[^)]*\)|(?:std\s*::\s*collections\s*::\s*)?(?:HashMap|BTreeMap|HashSet|BTreeSet)\s*<[^>]+>|serde_json\s*::\s*Value|(?:std\s*::\s*sync\s*::\s*)?Arc\s*<\s*\w+\s*>|embind_rs\s*::\s*Js(?:Value|Function)|&\s*\w+|[\w()]+)$/);
        let ty = m?.[2].replace(/\s+/g, '');
        if (ty) ty = normalizeStringSpelling(ty);
        if (ty && !known(ty) && isJsonSpelling(ty, ctx)) ty = JSON_TY;
        if (ty) ty = normalizeArc(ty, ctx);
        const jsTokP = ty ? matchJsTok(ty, ctx) : null;
        if (jsTokP) ty = jsTokP;
        const arcParam = ty?.match(ARC_RE)?.[1];
        const optClassRef = ty?.match(OPTION_CLASS_REF_RE)?.[1];
        const closure = closureShape(p.slice(p.indexOf(':') + 1));
        if (closure) { args.push({ name: `a${args.length}`, ty: `__closure${JSON.stringify(closure)}` }); continue; }
        if (!m || !(known(ty) || ty === JSON_TY || jsTokP || (arcParam && classes.has(arcParam)) || PARAM_ONLY.has(ty) || OPTION_PARAM_RE.test(ty) || isClassRef(ty)
            || (optClassRef && classes.has(optClassRef)))) {
            log(isCollection(ty) && !collectionCarries(ty, ctx)
                ? `crossbind: rust bridge: ${cls.name}::${name} skipped (a struct inside '${ty}' must derive Serialize and Deserialize to cross)`
                : `crossbind: rust bridge: ${cls.name}::${name} skipped (unsupported parameter '${p}')`);
            return;
        }
        args.push({ name: m[1], ty });
    }
    const returnInfo = analyzeReturn(rawRet ?? '()', ctx);
    let { inner: ret, throws, optional } = returnInfo;
    if (!known(ret) && isJsonSpelling(ret, ctx)) ret = JSON_TY;
    ret = normalizeArc(ret.replace(/\s+/g, ''), ctx);
    const jsTokR = matchJsTok(ret, ctx);
    if (jsTokR) ret = jsTokR;
    if (jsTokR && optional) {
        log(`crossbind: rust bridge: ${cls.name}::${name} skipped (Option<${ret}> returns are not supported - return JsValue::null() instead)`);
        return;
    }

    if (!selfKind) {
        const arcSelf = ret === 'Arc<Self>' || ret === `Arc<${cls.name}>`;
        if (!arcSelf && ret !== 'Self' && ret !== cls.name) {
            log(`crossbind: rust bridge: ${cls.name}::${name} skipped (associated fns must return Self, Result<Self, E> or Option<Self>)`);
            return;
        }
        if (name === 'new') {
            if (arcSelf) { log(`crossbind: rust bridge: ${cls.name}::new skipped (Arc<Self> has no ctor shape - use a named factory like 'create')`); return; }
            if (optional) { log(`crossbind: rust bridge: ${cls.name}::new skipped (Option<Self> has no ctor shape - use a named factory or Result<Self, E>)`); return; }
            if (args.length > 6) { log(`crossbind: rust bridge: ${cls.name}::new skipped (max 6 args)`); return; }
            cls.ctor = { args, throws };
        } else {
            if (arcSelf && optional) { log(`crossbind: rust bridge: ${cls.name}::${name} skipped (Option<Arc<Self>> is not supported in this wave)`); return; }
            if (args.length > 6) { log(`crossbind: rust bridge: ${cls.name}::${name} skipped (factories take max 6 args)`); return; }
            cls.factories.push({ name, args, throws, optional, shared: arcSelf });
        }
        return;
    }
    const retArcInner = ret.match(ARC_RE)?.[1];
    if (retArcInner) {
        const target = retArcInner === 'Self' ? cls.name : retArcInner;
        if (!classes.has(target)) {
            log(`crossbind: rust bridge: ${cls.name}::${name} skipped (unsupported return '${ret}')`);
            return;
        }
        if (throws) {
            log(`crossbind: rust bridge: ${cls.name}::${name} skipped (a fallible Arc return is not carried yet)`);
            return;
        }
        if (args.length > 6) { log(`crossbind: rust bridge: ${cls.name}::${name} skipped (max 6 args)`); return; }
        cls.methods.push({ name, args, ret: `Arc<${target}>`, byRef: selfKind === '&self', throws: false, optionalRet: false });
        return;
    }
    if (optional && !OPTION_INNERS.has(ret)) {
        log(`crossbind: rust bridge: ${cls.name}::${name} skipped (Option<${ret}> return is not representable - inners: i32, f64, bool, String; or an Option<Self> factory)`);
        return;
    }
    const selfOwned = ret === 'Self' || ret === cls.name || classes.has(ret);
    const borrowedSelf = ret.replace(/\s+/g, '').match(/^&(?:mut)?(Self|\w+)$/)?.[1];
    const selfBorrowed = borrowedSelf === 'Self' || borrowedSelf === cls.name;
    if (selfOwned || selfBorrowed) {
        cls.methods.push({
            name, args, ret: selfOwned ? (ret === 'Self' ? cls.name : ret) : cls.name,
            byRef: selfKind === '&self', throws, optionalRet: false,
            ownedClass: selfOwned ? (ret === 'Self' ? cls.name : ret) : null,
            borrowedSelf: selfBorrowed,
        });
        return;
    }
    if (!known(ret) && ret !== JSON_TY && !jsTokR) {
        log(`crossbind: rust bridge: ${cls.name}::${name} skipped (unsupported return '${ret}')`);
        return;
    }
    if (args.length > 6) { log(`crossbind: rust bridge: ${cls.name}::${name} skipped (max 6 args)`); return; }
    cls.methods.push({ name, args, ret, byRef: selfKind === '&self', throws, optionalRet: optional, collect: returnInfo.collect });
}

function parseFreeFn(freeFns, sig, ctx, log) {
    const { enums, valueObjects, classes } = ctx;
    const [, name, rawParams, rawRet] = sig;
    // A borrowed string is known in both directions: as a parameter it borrows, as a return it
    // comes back owned.
    const known = (ty) => PRIMITIVES.has(ty) || PARAM_ONLY.has(ty) || typedArrayOf(ty) || (isCollection(ty) && collectionCarries(ty, ctx))
        || enums.some((e) => e.name === ty) || valueObjects.some((v) => v.name === ty)
        || (ctx.newtypes ?? []).some((n) => n.name === ty)
        || (ctx.jsonTypes ?? []).some((j) => j.name === ty)
        || isOptionalRecord(ty, ctx);
    const isClassRef = (ty) => ty.startsWith('&') && !PARAM_ONLY.has(ty) && classes.has(ty.slice(1));

    const args = [];
    for (const p of splitTopLevel(rawParams).map((s) => s.trim()).filter(Boolean)) {
        const m = p.match(/^(\w+)\s*:\s*(&\s*(?:str|String)|Option\s*<\s*(?:i32|f64|bool|String|&\s*\w+)\s*>|Vec\s*<[^;]+>|\[[^\]]+;\s*\d+\]|&\s*\[[^\]]+\]|\([^)]*,[^)]*\)|(?:std\s*::\s*collections\s*::\s*)?(?:HashMap|BTreeMap|HashSet|BTreeSet)\s*<[^>]+>|serde_json\s*::\s*Value|(?:std\s*::\s*sync\s*::\s*)?Arc\s*<\s*\w+\s*>|embind_rs\s*::\s*Js(?:Value|Function)|&\s*\w+|[\w()]+)$/);
        let ty = m?.[2].replace(/\s+/g, '');
        if (ty) ty = normalizeStringSpelling(ty);
        if (ty && !known(ty) && isJsonSpelling(ty, ctx)) ty = JSON_TY;
        if (ty) ty = normalizeArc(ty, ctx);
        const jsTokP = ty ? matchJsTok(ty, ctx) : null;
        if (jsTokP) ty = jsTokP;
        const arcParam = ty?.match(ARC_RE)?.[1];
        const optClassRef = ty?.match(OPTION_CLASS_REF_RE)?.[1];
        const closure = closureShape(p.slice(p.indexOf(':') + 1));
        if (closure) { args.push({ name: `a${args.length}`, ty: `__closure${JSON.stringify(closure)}` }); continue; }
        if (!m || !(known(ty) || ty === JSON_TY || jsTokP || (arcParam && classes.has(arcParam)) || PARAM_ONLY.has(ty) || OPTION_PARAM_RE.test(ty) || isClassRef(ty)
            || (optClassRef && classes.has(optClassRef)))) {
            log(isCollection(ty) && !collectionCarries(ty, ctx)
                ? `crossbind: rust bridge: fn ${name} skipped (a struct inside '${ty}' must derive Serialize and Deserialize to cross)`
                : `crossbind: rust bridge: fn ${name} skipped (unsupported parameter '${p}')`);
            return;
        }
        args.push({ name: m[1], ty });
    }
    const returnInfo = analyzeReturn(rawRet ?? '()', ctx);
    let { inner: ret, throws, optional } = returnInfo;
    if (!known(ret) && isJsonSpelling(ret, ctx)) ret = JSON_TY;
    ret = normalizeArc(ret.replace(/\s+/g, ''), ctx);
    const jsTokR = matchJsTok(ret, ctx);
    if (jsTokR) ret = jsTokR;
    const retArc = ret.match(ARC_RE)?.[1];
    if (retArc) {
        if (!classes.has(retArc)) { log(`crossbind: rust bridge: fn ${name} skipped (unsupported return '${ret}')`); return; }
        if (throws) { log(`crossbind: rust bridge: fn ${name} skipped (a fallible Arc return is not carried yet)`); return; }
    }
    if (jsTokR && optional) { log(`crossbind: rust bridge: fn ${name} skipped (Option<${ret}> returns are not supported - return JsValue::null() instead)`); return; }
    if (optional && !OPTION_INNERS.has(ret) && !retArc) { log(`crossbind: rust bridge: fn ${name} skipped (Option<${ret}> return is not representable - inners: i32, f64, bool, String, Arc<Class>)`); return; }
    if (isCollection(ret) && !collectionCarries(ret, ctx)) { log(`crossbind: rust bridge: fn ${name} skipped (a struct inside '${ret}' must derive Serialize and Deserialize to cross)`); return; }
    // A fresh instance handed back by value: JS owns it and frees it on delete().
    if (classes.has(ret) && !(ctx.jsonTypes ?? []).some((j) => j.name === ret)) {
        freeFns.push({ name, jsName: camel(name), args, ret, throws, optionalRet: false, ownedClass: ret });
        return;
    }
    if (!known(ret) && ret !== JSON_TY && !retArc && !jsTokR) { log(`crossbind: rust bridge: fn ${name} skipped (unsupported return '${ret}')`); return; }
    if (args.length > 6) { log(`crossbind: rust bridge: fn ${name} skipped (max 6 args)`); return; }
    freeFns.push({ name, jsName: camel(name), args, ret, throws, optionalRet: optional, collect: returnInfo.collect });
}

// ---------------- emitter ----------------

const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function emitBridge(model, {
    userCrate, vectors, log, prelude = '', namePrefix = '',
}) {
    const U = userCrate;
    // embind's registry is flat, so two crate imports that both export `Version` would collide.
    // A direct `cargo:` import registers its public names under a per-crate prefix; the generated
    // proxy module maps them back to the clean names the import specifier already scopes.
    const pub = (name) => `${namePrefix}${name}`;
    const isEnum = (ty) => model.enums.some((e) => e.name === ty);
    const newtypeOf = (ty) => (model.newtypes ?? []).find((n) => n.name === ty);
    // A serde record, a data enum, a value object inside an Option: all cross as plain JS values
    // through the JSON wire.
    const jsonRecord = (ty) => {
        const text = String(ty).trim();
        const inner = text.match(/^Option<(.+)>$/)?.[1]?.trim() ?? text;
        return (model.jsonTypes ?? []).some((j) => j.name === inner)
            || (text.startsWith('Option<') && model.valueObjects.some((v) => v.name === inner));
    };
    // A panic inside a binding becomes a JS exception; an Arc wrapper has no sentinel to return
    // afterwards, so those bodies run unguarded (a panic there still aborts).
    const guarded = (retTy, body) => (retTy.endsWith('Shared') ? body : `embind_rs::guard(|| ${body})`);
    const isVo = (ty) => model.valueObjects.some((v) => v.name === ty);
    // Bridge-local wire type of a signature token, and the two directions of the shim adaptation.
    // &str/&String params cross as String (borrowed at the call site); &OtherClass params cross
    // as the class pointer via a bridge-local Ref wrapper (borrowed unsafely at the call site).
    // A slice is a collection, not a borrowed class.
    const isRef = (ty) => ty.startsWith('&') && !PARAM_ONLY.has(ty) && !isCollection(ty) && !typedArrayOf(ty);
    const arcInner = (ty) => String(ty).match(ARC_RE)?.[1];
    // An optional Arc rides the nullable shared wrapper; every other optional keeps `Option<T>`.
    // `&[T]` decodes into a Vec and is handed back as a slice; every other collection is owned.
    // `&[T; N]` keeps its fixed length (serde reads a JS array of exactly N items); `&[T]`
    // decodes into a Vec.
    const fixedArrayRef = (ty) => String(ty).trim().match(/^&\s*\[\s*(.+?)\s*;\s*(\d+)\s*\]$/);
    const ownedTy = (ty) => {
        const text = String(ty).trim();
        const fixed = fixedArrayRef(text);
        if (fixed) return qualifyUserTypes(`[${fixed[1]}; ${fixed[2]}]`);
        const slice = text.match(/^&\s*\[(.+)\]$/);
        return qualifyUserTypes(slice ? `Vec<${slice[1]}>` : text);
    };
    // Element and value types declared by the user crate need its path; std and primitive
    // spellings stay as they are.
    const STD_COLLECTIONS = { HashMap: 'std::collections::HashMap', BTreeMap: 'std::collections::BTreeMap', HashSet: 'std::collections::HashSet', BTreeSet: 'std::collections::BTreeSet' };
    const qualifyUserTypes = (text) => String(text).replace(/\b([A-Z]\w*)\b/g, (name) => (
        STD_COLLECTIONS[name] ? STD_COLLECTIONS[name] :
        model.classes.some((c) => c.name === name)
        || model.valueObjects.some((v) => v.name === name)
        || model.enums.some((e) => e.name === name)
        || (model.newtypes ?? []).some((n) => n.name === name)
        || (model.jsonTypes ?? []).some((j) => j.name === name)
            ? `${U}::${name}`
            : name));
    const borrowSuffix = (ty) => (!fixedArrayRef(ty) && /^&\s*\[/.test(String(ty).trim()) ? '.as_slice()' : '');
    const borrowPrefix = (ty) => (fixedArrayRef(ty) ? '&' : '');
    // `__closure{...}` carries the shape the parser read off `impl Fn(..)`.
    const closureOf = (ty) => {
        const text = String(ty);
        return text.startsWith('__closure') ? JSON.parse(text.slice('__closure'.length)) : null;
    };
    const jsValueOf = (ty, expr) => (ty === 'i32' || ty === 'f64' ? `embind_rs::JsValue::from_f64(${expr} as f64)`
        : ty === 'bool' ? `embind_rs::JsValue::from_bool(${expr})`
            : `embind_rs::JsValue::from_str(&${expr})`);
    const fromJsValue = (ty, expr) => (ty === 'i32' ? `${expr}.as_f64().unwrap_or(0.0) as i32`
        : ty === 'f64' ? `${expr}.as_f64().unwrap_or(0.0)`
            : ty === 'bool' ? `${expr}.as_bool().unwrap_or(false)`
                : ty === 'String' ? `${expr}.as_string().unwrap_or_default()`
                    : '()');
    const closureExpr = (shape, handle) => {
        const params = shape.args.map((ty, i) => `p${i}: ${ty}`).join(', ');
        const call = `${handle}.call${shape.args.length}(${shape.args.map((ty, i) => `&${jsValueOf(ty, `p${i}`)}`).join(', ')})`;
        const body = shape.ret === '()'
            ? `match ${call} { Ok(_) => (), Err(e) => embind_rs::raise_err(e) }`
            : `match ${call} { Ok(v) => ${fromJsValue(shape.ret, 'v')}, Err(e) => embind_rs::raise_err(e) }`;
        const closure = `move |${params}| -> ${shape.ret} { ${body} }`;
        return shape.boxed ? `Box::new(${closure})` : closure;
    };
    const optionStrParam = (ty) => ty.replace(/\s+/g, '') === 'Option<&str>';
    // Only a bound class counts: `Option<&str>` is a string, not a class reference.
    const optionClassRef = (ty) => {
        const name = String(ty).replace(/\s+/g, '').match(/^Option<&(\w+)>$/)?.[1];
        return name && model.classes.some((c) => c.name === name) ? name : null;
    };
    const optionalWireTy = (ty) => (arcInner(ty) ? `${arcInner(ty)}SharedOpt` : `Option<${ty}>`);
    const wireTy = (ty) => (typedArrayOf(ty) ? `embind_rs::${typedArrayOf(ty).wrapper}`
        : closureOf(ty) ? 'embind_rs::JsFunction'
        : isCollection(ty) || jsonRecord(ty) ? '__CrossbindJson'
        : optionStrParam(ty) ? 'Option<String>'
        : optionClassRef(ty) ? `${optionClassRef(ty)}RefOpt`
            : newtypeOf(ty) ? newtypeOf(ty).inner
        : PARAM_ONLY.has(ty) ? 'String'
        : isRef(ty) ? `${ty.slice(1)}Ref`
            : ty === JSON_TY ? '__CrossbindJson'
                : JS_TOKS.has(ty) ? `embind_rs::${ty}`
                    : arcInner(ty) ? `${arcInner(ty)}Shared`
                        : isEnum(ty) || isVo(ty) ? `${ty}W` : ty);
    // A collection parameter is decoded from the JSON value; a shape the Rust type cannot hold
    // raises instead of silently defaulting.
    const unwrap = (ty, expr) => (typedArrayOf(ty) ? `${expr}.0${typedArrayOf(ty).slice ? '.as_slice()' : ''}`
        : closureOf(ty) ? closureExpr(closureOf(ty), expr)
        : isCollection(ty) || jsonRecord(ty) ? `${borrowPrefix(ty)}__crossbind_from_json::<${ownedTy(ty)}>(${expr}.0)${borrowSuffix(ty)}`
        // (ownedTy qualifies user type names with the crate path)
        : optionStrParam(ty) ? `${expr}.as_deref()`
        : optionClassRef(ty) ? `${expr}.as_option()`
            : newtypeOf(ty) ? `${U}::${ty}(${expr})`
        : PARAM_ONLY.has(ty) ? `&${expr}`
        : isRef(ty) ? `unsafe { &*${expr}.0 }`
            : ty === JSON_TY || arcInner(ty) || isEnum(ty) || isVo(ty) ? `${expr}.0` : expr);
    const wrap = (ty, expr) => (typedArrayOf(ty) ? `embind_rs::${typedArrayOf(ty).wrapper}(${expr})`
        : isCollection(ty) || jsonRecord(ty) ? `__CrossbindJson(__crossbind_to_json(&(${expr})))`
        : newtypeOf(ty) ? `(${expr}).0`
        : PARAM_ONLY.has(ty) ? `String::from(${expr})`
        : ty === JSON_TY ? `__CrossbindJson(${expr})`
        : arcInner(ty) ? `${arcInner(ty)}Shared(${expr})`
            : isEnum(ty) || isVo(ty) ? `${ty}W(${expr})` : expr);

    const out = [];
    out.push('// Generated by crossbind rustBridgeGen - do not edit. The user crate stays plain Rust;');
    out.push('// newtype wrappers (orphan rule) + shim fns adapt its pub surface to embind-rs.');
    out.push('#![allow(clippy::all)]');
    out.push('#![allow(unused_imports)]');
    out.push('use embind_rs::{class_, enum_, enum_tid, register_vector, value_object_, value_object_tid, WireType};');
    out.push('use std::ffi::c_void;');
    out.push('');
    if (prelude) {
        out.push(prelude);
        out.push('');
    }

    for (const e of model.enums) {
        // No derives on the wrapper: a plain fieldless enum need not be Clone or Copy, and the
        // wire only ever moves one (`to_wire` takes self, `from_wire` builds a fresh one).
        out.push('#[repr(transparent)]');
        out.push(`pub struct ${e.name}W(pub ${U}::${e.name});`);
        out.push(`impl WireType for ${e.name}W {`);
        out.push('    type Wire = i32;');
        out.push("    const SIG: char = 'i';");
        out.push(`    fn tid() -> *const c_void { enum_tid::<${e.name}W>() }`);
        out.push(`    fn from_wire(w: i32) -> ${e.name}W {`);
        out.push('        match w {');
        for (const v of e.variants) out.push(`            ${v.value} => ${e.name}W(${U}::${e.name}::${v.name}),`);
        out.push(`            _ => ${e.name}W(${U}::${e.name}::${e.variants[0].name}),`);
        out.push('        }');
        out.push('    }');
        out.push('    fn to_wire(self) -> i32 { self.0 as i32 }');
        out.push('}');
        out.push(`impl embind_rs::ErrSentinel for ${e.name}W { fn err_sentinel() -> Self { <${e.name}W as WireType>::from_wire(0) } }`);
        out.push('');
    }

    for (const v of model.valueObjects) {
        out.push('#[derive(Clone, Copy)]');
        out.push('#[repr(transparent)]');
        out.push(`pub struct ${v.name}W(pub ${U}::${v.name});`);
        out.push(`impl Default for ${v.name}W { fn default() -> Self { ${v.name}W(${U}::${v.name}::default()) } }`);
        out.push(`impl WireType for ${v.name}W {`);
        out.push(`    type Wire = *mut ${v.name}W;`);
        out.push("    const SIG: char = 'p';");
        out.push(`    fn tid() -> *const c_void { value_object_tid::<${v.name}W>() }`);
        out.push(`    fn from_wire(w: *mut ${v.name}W) -> ${v.name}W { unsafe { *w } }`);
        out.push(`    fn to_wire(self) -> *mut ${v.name}W { Box::into_raw(Box::new(self)) }`);
        out.push('}');
        out.push(`impl embind_rs::ErrSentinel for ${v.name}W { fn err_sentinel() -> Self { Default::default() } }`);
        out.push('');
    }

    // `&OtherClass` params ride the class pointer wire through per-class Ref wrappers; collect
    // the referenced classes up front so the wrappers exist before the shims that use them.
    const classRefs = new Set();
    (model.classes ?? []).forEach((c) => c.methods.forEach((m) => { if (m.ownedClass || m.borrowedSelf) classRefs.add(m.ret); }));
    (model.freeFns ?? []).forEach((f) => { if (f.ownedClass) classRefs.add(f.ownedClass); });
    const scanRefs = (args) => args.forEach((p) => {
        if (isRef(p.ty)) classRefs.add(p.ty.slice(1));
        const optRef = optionClassRef(p.ty);
        if (optRef) classRefs.add(optRef);
    });
    for (const cls of model.classes) {
        if (cls.ctor) scanRefs(cls.ctor.args);
        cls.factories.forEach((f) => scanRefs(f.args));
        cls.methods.forEach((m) => scanRefs(m.args));
    }
    (model.freeFns ?? []).forEach((f) => scanRefs(f.args));
    for (const name of [...classRefs].sort()) {
        out.push('#[derive(Clone, Copy)]');
        out.push('#[repr(transparent)]');
        out.push(`pub struct ${name}Ref(pub *mut ${U}::${name});`);
        out.push(`impl WireType for ${name}Ref {`);
        out.push('    type Wire = *mut c_void;');
        out.push("    const SIG: char = 'p';");
        out.push(`    fn tid() -> *const c_void { embind_rs::class_tid::<${U}::${name}>() }`);
        out.push(`    fn from_wire(w: *mut c_void) -> ${name}Ref { ${name}Ref(w as *mut ${U}::${name}) }`);
        out.push(`    fn to_wire(self) -> *mut c_void { self.0 as *mut c_void }`);
        out.push('}');
        out.push('');
        // A fresh instance of the class: the wire is the smart pointer JS owns and frees.
        out.push('#[repr(transparent)]');
        out.push(`pub struct ${name}Owned(pub *mut ${U}::${name});`);
        out.push(`impl WireType for ${name}Owned {`);
        out.push('    type Wire = *mut c_void;');
        out.push("    const SIG: char = 'p';");
        out.push(`    fn tid() -> *const c_void { embind_rs::owned_ptr_tid::<${U}::${name}>() }`);
        out.push(`    fn from_wire(w: *mut c_void) -> ${name}Owned { ${name}Owned(w as *mut ${U}::${name}) }`);
        out.push('    fn to_wire(self) -> *mut c_void { self.0 as *mut c_void }');
        out.push('}');
        out.push(`impl embind_rs::ErrSentinel for ${name}Owned { fn err_sentinel() -> Self { ${name}Owned(core::ptr::null_mut()) } }`);
        out.push('');
        // The same object handed back for chaining: a pointer, so JS does not own it twice.
        out.push('#[repr(transparent)]');
        out.push(`pub struct ${name}RefOut(pub *mut ${U}::${name});`);
        out.push(`impl WireType for ${name}RefOut {`);
        out.push('    type Wire = *mut c_void;');
        out.push("    const SIG: char = 'p';");
        out.push(`    fn tid() -> *const c_void { embind_rs::class_ptr_tid::<${U}::${name}>() }`);
        out.push(`    fn from_wire(w: *mut c_void) -> ${name}RefOut { ${name}RefOut(w as *mut ${U}::${name}) }`);
        out.push('    fn to_wire(self) -> *mut c_void { self.0 as *mut c_void }');
        out.push('}');
        out.push(`impl embind_rs::ErrSentinel for ${name}RefOut { fn err_sentinel() -> Self { ${name}RefOut(core::ptr::null_mut()) } }`);
        out.push('');
        // `Option<&Class>` parameter: a null pointer is the None the caller wrote as null.
        out.push('#[derive(Clone, Copy)]');
        out.push('#[repr(transparent)]');
        out.push(`pub struct ${name}RefOpt(pub *mut ${U}::${name});`);
        out.push(`impl ${name}RefOpt {`);
        out.push(`    pub fn as_option(&self) -> Option<&${U}::${name}> {`);
        out.push('        if self.0.is_null() { None } else { Some(unsafe { &*self.0 }) }');
        out.push('    }');
        out.push('}');
        out.push(`impl WireType for ${name}RefOpt {`);
        out.push('    type Wire = *mut c_void;');
        out.push("    const SIG: char = 'p';");
        out.push(`    fn tid() -> *const c_void { embind_rs::class_ptr_tid::<${U}::${name}>() }`);
        out.push(`    fn from_wire(w: *mut c_void) -> ${name}RefOpt { ${name}RefOpt(w as *mut ${U}::${name}) }`);
        out.push(`    fn to_wire(self) -> *mut c_void { self.0 as *mut c_void }`);
        out.push('}');
        out.push('');
    }

    if (model.usesJson) {
        out.push('// A collection crosses as a JS array or object through the same JSON wire: decoding a');
        out.push('// shape the Rust type cannot hold raises in JS instead of quietly yielding a default.');
        out.push('fn __crossbind_from_json<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {');
        out.push('    match serde_json::from_value(value) {');
        out.push('        Ok(parsed) => parsed,');
        out.push('        Err(e) => {');
        out.push('            // Raise first: on wasm that throws into JS right here, so a bad argument');
        out.push('            // costs one error instead of the panic that would poison the instance.');
        out.push('            let _: () = embind_rs::raise_err(format!("cannot read this value as {}: {e}", std::any::type_name::<T>()));');
        out.push('            // Native only, where raising parks the error and returns: no value of T');
        out.push('            // can be fabricated, so unwind into the shim guard instead.');
        out.push('            panic!("cannot read this value as {}", std::any::type_name::<T>())');
        out.push('        }');
        out.push('    }');
        out.push('}');
        out.push('');
        out.push('fn __crossbind_to_json<T: serde::Serialize + ?Sized>(value: &T) -> serde_json::Value {');
        out.push('    serde_json::to_value(value).unwrap_or(serde_json::Value::Null)');
        out.push('}');
        out.push('');
        out.push('// serde_json::Value crosses as a deep JSON copy: the adapter converts handle <->');
        out.push('// [u32 len][bytes] JSON text through the host JSON codec; serde maps text <-> Value here.');
        out.push('#[repr(transparent)]');
        out.push('pub struct __CrossbindJson(pub serde_json::Value);');
        out.push('extern "C" {');
        out.push('    fn crossbind_tid_emval() -> *const c_void;');
        out.push('    fn crossbind_emval_json_to_handle(w: *mut u8) -> usize;');
        out.push('    fn crossbind_emval_handle_to_json(h: usize) -> *mut u8;');
        out.push('    fn malloc(n: usize) -> *mut u8;');
        out.push('    fn free(p: *mut u8);');
        out.push('}');
        out.push('impl WireType for __CrossbindJson {');
        out.push('    type Wire = usize;');
        out.push('    // Handles are i32 table indexes on wasm but BigInt-marshalled 64-bit values on');
        out.push("    // native (the jsi adapter's pointer slots), so the sig letter is per-family.");
        out.push('    #[cfg(target_family = "wasm")]');
        out.push("    const SIG: char = 'i';");
        out.push('    #[cfg(not(target_family = "wasm"))]');
        out.push("    const SIG: char = 'p';");
        out.push('    fn tid() -> *const c_void { unsafe { crossbind_tid_emval() } }');
        out.push('    fn from_wire(w: usize) -> Self {');
        out.push('        unsafe {');
        out.push('            let p = crossbind_emval_handle_to_json(w);');
        out.push('            let len = *(p as *const u32) as usize;');
        out.push('            let bytes = std::slice::from_raw_parts(p.add(4), len);');
        out.push('            let v = serde_json::from_slice(bytes).unwrap_or(serde_json::Value::Null);');
        out.push('            free(p);');
        out.push('            __CrossbindJson(v)');
        out.push('        }');
        out.push('    }');
        out.push('    fn to_wire(self) -> usize {');
        out.push('        let s = self.0.to_string();');
        out.push('        unsafe {');
        out.push('            let bytes = s.as_bytes();');
        out.push('            let base = malloc(4 + bytes.len());');
        out.push('            *(base as *mut u32) = bytes.len() as u32;');
        out.push('            std::ptr::copy_nonoverlapping(bytes.as_ptr(), base.add(4), bytes.len());');
        out.push('            crossbind_emval_json_to_handle(base)');
        out.push('        }');
        out.push('    }');
        out.push('}');
        out.push('impl embind_rs::ErrSentinel for __CrossbindJson { fn err_sentinel() -> Self { __CrossbindJson(serde_json::Value::Null) } }');
        out.push('');
    }

    // Arc<X> surfaces cross as the class's shared smart-pointer wire: the raw Arc::into_raw
    // pointer, one strong count per JS handle (given on to_wire, added on from_wire).
    for (const inner of model.sharedOf ?? []) {
        out.push('#[repr(transparent)]');
        out.push(`pub struct ${inner}Shared(pub std::sync::Arc<${U}::${inner}>);`);
        out.push(`impl WireType for ${inner}Shared {`);
        out.push('    type Wire = *mut c_void;');
        out.push("    const SIG: char = 'p';");
        out.push(`    fn tid() -> *const c_void { embind_rs::shared_tid::<${U}::${inner}>() }`);
        out.push('    fn from_wire(w: *mut c_void) -> Self {');
        out.push('        unsafe {');
        out.push(`            std::sync::Arc::increment_strong_count(w as *const ${U}::${inner});`);
        out.push(`            ${inner}Shared(std::sync::Arc::from_raw(w as *const ${U}::${inner}))`);
        out.push('        }');
        out.push('    }');
        out.push(`    fn to_wire(self) -> *mut c_void { std::sync::Arc::into_raw(self.0) as *mut c_void }`);
        out.push('}');
        out.push('');
        // `Option<Arc<T>>`: a null smart pointer is what embind reads back as JS null, so None
        // needs no optional type of its own.
        out.push('#[repr(transparent)]');
        out.push(`pub struct ${inner}SharedOpt(pub Option<std::sync::Arc<${U}::${inner}>>);`);
        out.push(`impl WireType for ${inner}SharedOpt {`);
        out.push('    type Wire = *mut c_void;');
        out.push("    const SIG: char = 'p';");
        out.push(`    fn tid() -> *const c_void { embind_rs::shared_tid::<${U}::${inner}>() }`);
        out.push('    fn from_wire(w: *mut c_void) -> Self {');
        out.push(`        if w.is_null() { return ${inner}SharedOpt(None); }`);
        out.push('        unsafe {');
        out.push(`            std::sync::Arc::increment_strong_count(w as *const ${U}::${inner});`);
        out.push(`            ${inner}SharedOpt(Some(std::sync::Arc::from_raw(w as *const ${U}::${inner})))`);
        out.push('        }');
        out.push('    }');
        out.push('    fn to_wire(self) -> *mut c_void {');
        out.push('        match self.0 {');
        out.push('            Some(value) => std::sync::Arc::into_raw(value) as *mut c_void,');
        out.push('            None => core::ptr::null_mut(),');
        out.push('        }');
        out.push('    }');
        out.push('}');
        out.push(`impl embind_rs::ErrSentinel for ${inner}SharedOpt { fn err_sentinel() -> Self { ${inner}SharedOpt(None) } }`);
        out.push('');
    }

    const registrations = [];
    const usedOptionals = new Set();
    const noteOptionArgs = (args) => args.forEach((p) => {
        const m = p.ty.match(OPTION_PARAM_RE);
        // `Option<&str>` rides the String optional; a class reference needs none (null is None).
        if (m) usedOptionals.add(m[1] === '&str' ? 'String' : m[1]);
    });
    for (const c of model.consts ?? []) {
        registrations.push(c.ty === '&str'
            ? `    embind_rs::constant_str("${pub(c.name)}", ${U}::${c.name});`
            : `    embind_rs::constant("${pub(c.name)}", ${U}::${c.name});`);
    }
    for (const e of model.enums) {
        registrations.push(`    enum_::<${e.name}W>("${pub(e.name)}")${e.variants.map((v) => `.value("${v.name}", ${v.value})`).join('')};`);
    }
    for (const v of model.valueObjects) {
        const fields = v.fields.map((f) => {
            const fieldTy = model.valueObjects.some((o) => o.name === f.type) ? `${f.type}W` : f.type;
            return `.field::<${fieldTy}>("${f.name}", core::mem::offset_of!(${U}::${v.name}, ${f.name}))`;
        }).join('');
        registrations.push(`    value_object_::<${v.name}W>("${pub(v.name)}")${fields}.finalize();`);
    }
    for (const vec of vectors) {
        if (!VECTOR_ITEM_TYPES.has(vec.of)) { log(`crossbind: rust bridge: vector of '${vec.of}' skipped (supported: i32, f64, bool)`); continue; }
        registrations.push(`    register_vector::<${vec.of}>("${pub(vec.name)}");`);
    }

    for (const cls of model.classes) {
        const C = `${U}::${cls.name}`;
        const shim = (fnName) => `__${cls.name.toLowerCase()}_${fnName}`;
        const chain = [`    class_::<${C}>("${pub(cls.name)}")`];

        const handsBackSelf = cls.methods.some((m) => m.ownedClass) || (model.freeFns ?? []).some((f) => f.ownedClass === cls.name);
        if (cls.shared) chain.push(`        .smart_ptr_shared("${pub(cls.name)}Shared")`);
        else if (cls.factories.length || handsBackSelf) chain.push(`        .smart_ptr("${pub(cls.name)}Ptr")`);
        // A struct that derives Default and declares no `new` still constructs from JS: the
        // derive is the author saying what a default instance is.
        if (!cls.ctor && !cls.shared && cls.hasDefault) {
            out.push(`fn ${shim('default')}() -> *mut ${C} { ${guarded('*mut', `Box::into_raw(Box::new(<${C} as Default>::default()))`)} }`);
            chain.push(`        .constructor_ptr0(${shim('default')})`);
        }
        if (cls.ctor) {
            const a = cls.ctor.args;
            noteOptionArgs(a);
            const ps = a.map((p, i) => `a${i}: ${wireTy(p.ty)}`).join(', ');
            const call = `${C}::new(${a.map((p, i) => unwrap(p.ty, `a${i}`)).join(', ')})`;
            if (cls.ctor.throws) {
                out.push(`fn ${shim('new')}(${ps}) -> *mut ${C} { ${guarded('*mut', `match ${call} { Ok(v) => Box::into_raw(Box::new(v)), Err(e) => embind_rs::raise_err_coded(e.to_string(), { use embind_rs::{CrossbindErrorCode, CrossbindErrorCodeFallback}; (&e).crossbind_code() }) }`)} }`);
                chain.push(`        .constructor_ptr${a.length}(${shim('new')})`);
            } else {
                out.push(`fn ${shim('new')}(${ps}) -> *mut ${C} { ${guarded('*mut', `Box::into_raw(Box::new(${call}))`)} }`);
                chain.push(`        .constructor_ptr${a.length}(${shim('new')})`);
            }
        }
        for (const f of cls.factories) {
            noteOptionArgs(f.args);
            const ps = f.args.map((p, i) => `a${i}: ${wireTy(p.ty)}`).join(', ');
            const call = `${C}::${f.name}(${f.args.map((p, i) => unwrap(p.ty, `a${i}`)).join(', ')})`;
            if (f.shared) {
                if (f.throws) {
                    out.push(`fn ${shim(f.name)}(${ps}) -> *mut ${C} { match ${call} { Ok(v) => std::sync::Arc::into_raw(v) as *mut ${C}, Err(e) => embind_rs::raise_err_coded(e.to_string(), { use embind_rs::{CrossbindErrorCode, CrossbindErrorCodeFallback}; (&e).crossbind_code() }) } }`);
                    chain.push(`        .create_ptr${f.args.length}("${camel(f.name)}", ${shim(f.name)})`);
                } else {
                    out.push(`fn ${shim(f.name)}(${ps}) -> std::sync::Arc<${C}> { ${call} }`);
                    chain.push(`        .create_arc${f.args.length}("${camel(f.name)}", ${shim(f.name)})`);
                }
                continue;
            }
            if (f.throws) {
                out.push(`fn ${shim(f.name)}(${ps}) -> *mut ${C} { ${guarded('*mut', `match ${call} { Ok(v) => Box::into_raw(Box::new(v)), Err(e) => embind_rs::raise_err_coded(e.to_string(), { use embind_rs::{CrossbindErrorCode, CrossbindErrorCodeFallback}; (&e).crossbind_code() }) }`)} }`);
                chain.push(`        .create_ptr${f.args.length}("${camel(f.name)}", ${shim(f.name)})`);
            } else if (f.optional) {
                out.push(`fn ${shim(f.name)}(${ps}) -> *mut ${C} { ${guarded('*mut', `match ${call} { Some(v) => Box::into_raw(Box::new(v)), None => core::ptr::null_mut() }`)} }`);
                chain.push(`        .create_ptr${f.args.length}("${camel(f.name)}", ${shim(f.name)})`);
            } else {
                out.push(`fn ${shim(f.name)}(${ps}) -> *mut ${C} { ${guarded('*mut', `Box::into_raw(Box::new(${call}))`)} }`);
                chain.push(`        .create_ptr${f.args.length}("${camel(f.name)}", ${shim(f.name)})`);
            }
        }
        for (const f of cls.fields ?? []) {
            out.push(`fn ${shim(`get_${f.name}`)}(t: &mut ${C}) -> ${wireTy(f.type)} { ${wrap(f.type, `t.${f.name}.clone()`)} }`);
            out.push(`fn ${shim(`set_${f.name}`)}(t: &mut ${C}, v: ${wireTy(f.type)}) { t.${f.name} = ${unwrap(f.type, 'v')}; }`);
            chain.push(`        .property("${camel(f.name)}", ${shim(`get_${f.name}`)}, ${shim(`set_${f.name}`)})`);
        }
        // `foo()` next to `set_foo(v)` reads as one JS property, the pair napi-rs spells with
        // #[napi(getter)] and #[napi(setter)].
        // A setter returns nothing: `set_point(p) -> f64` is a method that happens to be named
        // that way, not the write half of a property.
        const accessorPairs = cls.methods.filter((m) => m.args.length === 0 && m.ret !== '()'
            && cls.methods.some((other) => other.name === `set_${m.name}` && other.args.length === 1
                && other.args[0].ty === m.ret && other.ret === '()'));
        const accessorNames = new Set(accessorPairs.flatMap((m) => [m.name, `set_${m.name}`]));
        for (const m of accessorPairs) {
            out.push(`fn ${shim(`prop_get_${m.name}`)}(t: &mut ${C}) -> ${wireTy(m.ret)} { ${wrap(m.ret, `(&*t).${m.name}()`)} }`);
            out.push(`fn ${shim(`prop_set_${m.name}`)}(t: &mut ${C}, v: ${wireTy(m.ret)}) { t.set_${m.name}(${unwrap(m.ret, 'v')}); }`);
            chain.push(`        .property("${camel(m.name)}", ${shim(`prop_get_${m.name}`)}, ${shim(`prop_set_${m.name}`)})`);
        }
        for (const m of cls.methods) {
            if (accessorNames.has(m.name)) continue;
            noteOptionArgs(m.args);
            const params = [`t: &mut ${C}`, ...m.args.map((p, i) => `a${i}: ${wireTy(p.ty)}`)].join(', ');
            const callArgs = m.args.map((p, i) => unwrap(p.ty, `a${i}`)).join(', ');
            const recv = m.byRef ? '(&*t)' : 't';
            const rawCall = `${recv}.${m.name}(${callArgs})`;
            const call = m.collect ? `(${rawCall}).collect::<Vec<_>>()` : rawCall;
            if (m.ownedClass || m.borrowedSelf) {
                const wrapper = m.ownedClass ? `${m.ret}Owned` : `${m.ret}RefOut`;
                const value = m.ownedClass
                    ? `${wrapper}(Box::into_raw(Box::new(${call})))`
                    : `${wrapper}(${call} as *mut ${U}::${m.ret})`;
                out.push(`fn ${shim(m.name)}(${params}) -> ${wrapper} { ${guarded(wrapper, value)} }`);
                chain.push(`        .function${m.args.length}("${camel(m.name)}", ${shim(m.name)})`);
                classRefs.add(m.ret);
                continue;
            }
            const optArc = m.optionalRet && arcInner(m.ret);
            const body = m.throws
                ? `match ${call} { Ok(v) => ${wrap(m.ret, 'v')}, Err(e) => embind_rs::raise_err_coded(e.to_string(), { use embind_rs::{CrossbindErrorCode, CrossbindErrorCodeFallback}; (&e).crossbind_code() }) }`
                : (m.ret === '()' ? call : optArc ? `${arcInner(m.ret)}SharedOpt(${call})` : wrap(m.ret, call));
            const retTy = m.optionalRet ? optionalWireTy(m.ret) : (m.ret === '()' ? '()' : wireTy(m.ret));
            if (m.optionalRet && !arcInner(m.ret)) usedOptionals.add(m.ret);
            out.push(`fn ${shim(m.name)}(${params}) -> ${retTy} { ${guarded(retTy, body)} }`);
            chain.push(`        .function${m.args.length}("${camel(m.name)}", ${shim(m.name)})`);
        }
        if (cls.hasDisplay) {
            out.push(`fn ${shim('display_tostring')}(t: &mut ${C}) -> String { ${guarded('String', 'format!("{}", (&*t))')} }`);
            chain.push(`        .function0("toString", ${shim('display_tostring')})`);
        }
        registrations.push(`${chain.join('\n')};`);
    }

    for (const f of model.freeFns ?? []) {
        noteOptionArgs(f.args);
        const ps = f.args.map((p, i) => `a${i}: ${wireTy(p.ty)}`).join(', ');
        const rawCall = `${U}::${f.name}(${f.args.map((p, i) => unwrap(p.ty, `a${i}`)).join(', ')})`;
        const call = f.collect ? `(${rawCall}).collect::<Vec<_>>()` : rawCall;
        const retTy = f.optionalRet ? optionalWireTy(f.ret) : (f.ret === '()' ? '()' : wireTy(f.ret));
        if (f.optionalRet && !arcInner(f.ret)) usedOptionals.add(f.ret);
        if (f.ownedClass) {
            const wrapper = `${f.ownedClass}Owned`;
            out.push(`fn __free_${f.name}(${ps}) -> ${wrapper} { ${guarded(wrapper, `${wrapper}(Box::into_raw(Box::new(${call})))`)} }`);
            registrations.push(`    embind_rs::fn${f.args.length}("${pub(f.jsName)}", __free_${f.name});`);
            classRefs.add(f.ownedClass);
            continue;
        }
        const optArc = f.optionalRet && arcInner(f.ret);
        const body = f.throws
            ? `match ${call} { Ok(v) => ${wrap(f.ret, 'v')}, Err(e) => embind_rs::raise_err_coded(e.to_string(), { use embind_rs::{CrossbindErrorCode, CrossbindErrorCodeFallback}; (&e).crossbind_code() }) }`
            : (f.ret === '()' ? call : optArc ? `${arcInner(f.ret)}SharedOpt(${call})` : wrap(f.ret, call));
        out.push(`fn __free_${f.name}(${ps}) -> ${retTy} { ${guarded(retTy, body)} }`);
        registrations.push(`    embind_rs::fn${f.args.length}("${pub(f.jsName)}", __free_${f.name});`);
    }

    // Optional inner types register once up front (the adapters dedupe across archives).
    for (const inner of [...usedOptionals].sort()) {
        registrations.unshift(`    embind_rs::${OPTIONAL_REG[inner]}();`);
    }

    out.push('');
    out.push('embind_rs::bindings! {');
    out.push(registrations.join('\n'));
    out.push('}');
    out.push('');
    return out.join('\n');
}

// ---------------- .d.ts emitter ----------------

// A collection's TypeScript shape: an array for the sequence kinds, a Record for the maps, a
// tuple for a tuple. Anything the mapping does not recognise stays `unknown`, which is honest.
function tsCollection(ty) {
    const text = String(ty).trim();
    const map = text.match(/^(?:std::collections::)?(?:HashMap|BTreeMap)<\s*([^,]+),\s*(.+)>$/);
    if (map) return `Record<${tsInner(map[1])}, ${tsInner(map[2])}>`;
    const vec = text.match(/^Vec<(.+)>$/) || text.match(/^&?\s*\[(.+);\s*\d+\]$/) || text.match(/^&\s*\[(.+)\]$/);
    if (vec) return `${tsInner(vec[1])}[]`;
    const tuple = text.match(/^\((.+)\)$/);
    if (tuple) return `[${tuple[1].split(',').map((part) => tsInner(part)).join(', ')}]`;
    return 'unknown';
}

function tsInner(ty) {
    const text = String(ty).trim();
    return TS_TYPES[text] ?? (isCollection(text) ? tsCollection(text) : 'unknown');
}

const TS_TYPES = {
    i32: 'number', i64: 'bigint', u64: 'bigint', f64: 'number', bool: 'boolean',
    String: 'string', '&str': 'string', '&String': 'string', '()': 'void',
    i8: 'number', i16: 'number', u8: 'number', u16: 'number', u32: 'number', f32: 'number',
    // usize/isize carry a pointer-wide range: a number on wasm (32-bit), a BigInt on native.
    usize: 'number | bigint', isize: 'number | bigint', char: 'string',
};

// Editor-facing types for the package import (`import { X } from '<pkg>'`): the metro/vite
// resolver serves the runtime proxy, this file serves TypeScript. Exports are typed post-init
// (null until any init() resolves, which binds every imported module - same as the C++ .h flow).
export function emitDts(model, vectors, mode = 'sync') {
    const wrap = (t) => (mode === 'promise' ? `Promise<${t}>` : t);
    const ts = (ty) => {
        const opt = ty.match(OPTION_PARAM_RE);
        if (opt) return `${TS_TYPES[opt[1]] ?? opt[1]} | null | undefined`;
        if (ty === JSON_TY) return 'JsonValue';
        const arc = ty.match(ARC_RE);
        if (arc) return arc[1];  // Arc<X> is transparent in JS: the shared instance itself
        if (ty === 'JsValue') return 'unknown';
        if (ty === 'JsFunction') return '(...args: unknown[]) => unknown';
        const shape = String(ty).startsWith('__closure') ? JSON.parse(String(ty).slice('__closure'.length)) : null;
        if (shape) {
            const args = shape.args.map((a, i) => `a${i}: ${TS_TYPES[a] ?? 'unknown'}`).join(', ');
            return `(${args}) => ${shape.ret === '()' ? 'void' : TS_TYPES[shape.ret] ?? 'unknown'}`;
        }
        const typed = typedArrayOf(ty);
        if (typed) return typed.wrapper === 'JsBytes' ? 'Uint8Array' : 'Float64Array';
        if (isCollection(ty)) return tsCollection(ty);
        const optStr = ty.replace(/\s+/g, '') === 'Option<&str>';
        if (optStr) return 'string | null | undefined';
        const optRef = ty.replace(/\s+/g, '').match(/^Option<&(\w+)>$/)?.[1];
        if (optRef) return `${optRef} | null | undefined`;
        const nt = (model.newtypes ?? []).find((n) => n.name === ty);
        if (nt) return TS_TYPES[nt.inner] ?? nt.inner;
        if (ty.startsWith('&')) return TS_TYPES[ty] ?? ty.slice(1);  // &OtherClass param
        return TS_TYPES[ty] ?? ty;
    };
    const out = ['// Generated by crossbind rustBridgeGen - do not edit. Values are usable after init().', ''];
    if (model.usesJson) out.push('export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };', '');

    for (const v of model.valueObjects) {
        out.push(`export interface ${v.name} { ${v.fields.map((f) => `${f.name}: ${ts(f.type)};`).join(' ')} }`);
    }
    for (const c of model.consts ?? []) {
        out.push(`export declare const ${c.name}: ${TS_TYPES[c.ty] ?? c.ty};`);
    }
    for (const e of model.enums) {
        out.push(`export interface ${e.name} { readonly __crossbindEnum?: '${e.name}'; }`);
        out.push(`export declare let ${e.name}: { ${e.variants.map((v) => `readonly ${v.name}: ${e.name};`).join(' ')} };`);
    }
    for (const cls of model.classes) {
        out.push(`export declare class ${cls.name} {`);
        for (const f of cls.fields ?? []) out.push(`    ${camel(f.name)}: ${ts(f.type)};`);
        if (cls.ctor) out.push(`    constructor(${cls.ctor.args.map((p) => `${p.name}: ${ts(p.ty)}`).join(', ')});`);
        else if (!cls.shared && cls.hasDefault) out.push('    constructor();');
        else out.push('    private constructor();');
        for (const f of cls.factories) {
            out.push(`    static ${camel(f.name)}(${f.args.map((p) => `${p.name}: ${ts(p.ty)}`).join(', ')}): ${wrap(`${cls.name}${f.optional ? ' | null' : ''}`)};`);
        }
        for (const m of cls.methods) {
            out.push(`    ${camel(m.name)}(${m.args.map((p) => `${p.name}: ${ts(p.ty)}`).join(', ')}): ${wrap(`${ts(m.ret)}${m.optionalRet ? ' | null' : ''}`)};`);
        }
        if (cls.hasDisplay) out.push(`    toString(): ${wrap('string')};`);
        out.push(`    delete(): ${wrap('void')};`);
        out.push('}');
    }
    for (const f of model.freeFns ?? []) {
        out.push(`export declare function ${f.jsName}(${f.args.map((p) => `${p.name}: ${ts(p.ty)}`).join(', ')}): ${wrap(`${ts(f.ret)}${f.optionalRet ? ' | null' : ''}`)};`);
    }
    for (const vec of vectors) {
        if (!VECTOR_ITEM_TYPES.has(vec.of)) continue;
        out.push(`export declare class ${vec.name} {`);
        out.push('    constructor();');
        out.push(`    push_back(value: ${ts(vec.of)}): ${wrap('void')};`);
        out.push(`    get(index: number): ${wrap(ts(vec.of))};`);
        out.push(`    size(): ${wrap('number')};`);
        out.push(`    delete(): ${wrap('void')};`);
        out.push('}');
    }
    out.push('export declare let AllSymbols: Record<string, unknown>;');
    out.push('export declare function initNative(config?: Record<string, unknown>): Promise<unknown>;');
    out.push('');
    return out.join('\n');
}

// CLI: run inside a cargo package dir (reads its crossbind.config.mjs for crate path + vectors).
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    const config = (await import(pathToFileURL(`${process.cwd()}/crossbind.config.mjs`).href)).default;
    const crateDir = path.resolve(process.cwd(), config.export?.crate ?? 'crate');
    const { bridgeDir } = generateRustBridge({
        crateDir,
        vectors: config.export?.bindings?.vectors ?? [],
        dtsFile: `${process.cwd()}/dist/js/index.d.ts`,
    });
    console.log(bridgeDir);
}
