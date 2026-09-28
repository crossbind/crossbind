# Rust — first-class bindings

> Import plain Rust into JavaScript the same way you import a C++ header:
> classes, methods, free functions — one import line, no proc-macros, no
> hand-written glue. Works on web (emscripten embind), iOS and Android
> (embind-jsi) with the same JS code; `platform: 'wasi'` skips Rust (no
> wasm32-wasip3 Rust target yet). The wasm `mt` runtime works too but needs
> nightly Rust: crossbind rebuilds std with the atomics/bulk-memory features via
> `-Zbuild-std` (run `rustup toolchain install nightly --component rust-src`
> once; without it the build fails with that exact instruction).

## Requirement

The engine does not depend on the Rust layer — the consumer declares it:

```bash
pnpm add -D @crossbind/core-embind-rust
```

Bundler plugins (`@crossbind/plugin-vite`, `-rollup`, `-webpack`, `-react-native`) already
carry it as a dependency, so plugin users usually get it transitively. A
Rust toolchain (`cargo` + the platform targets) must be installed; cargo
itself is the incremental cache — rebuilds are no-ops when nothing changed.

## Three import models

### 1. Direct crate import (`cargo:` scheme)

Import straight from a crates.io crate — no local Rust file at all. Declare
the crate in `crossbind.config.js`, then import with the `cargo:` prefix (the
`node:`/`npm:` convention: the prefix names the store):

```js
// crossbind.config.js — top level, next to `dependencies`
cargoDependencies: {
  uuid: '{ version = "1", features = ["v4"] }',
  semver: '1',
},
```

```js
import { initNative } from './native/native.h';
import { Uuid } from 'cargo:uuid'
import { Version, VersionReq } from 'cargo:semver'

await initNative()
const id = Uuid.newV4().toString()
const ok = new VersionReq('^1.2').matches(new Version('1.4.0'))
```

crossbind reads the crate's own sources (following `mod` trees, `pub use`
re-exports, modules declared inside macros and enabled feature gates) and
generates the bridge crate from what it finds. An undeclared `cargo:` import is a hard error — add the
crate to `cargoDependencies`.

A crate that keeps its API in modules is imported one public module at a
time, with `/` between the crate and each module level. xxhash-rust, for
one, exports nothing from its root:

```js
// cargoDependencies: { 'xxhash-rust': '{ version = "0.8", features = ["xxh3"] }' }
import { xxh364, Xxh3 } from 'cargo:xxhash-rust/xxh3'

const digest = xxh364(new TextEncoder().encode('crossbind'))
```

The module has to be public all the way from the crate root and switched on
by the features you declare. A private module, one behind a feature you did
not enable, or an inline `mod x { … }` block fails the import with the
module's name. Every import of one crate shares a single bridge, so a type
reached through the root and through a module is the same JS class: a
`Params` built with the `params` module's builder goes straight into the
root's `Argon2`.

Metro (React Native) resolves against the file list it builds when it
starts, so crossbind finds module imports by scanning the app's own
JavaScript and TypeScript sources as it loads, skipping `node_modules`,
`ios`, `android` and build output. A module specifier assembled at run time,
or written in a package outside the app, is missing from that scan; it
resolves from the next Metro start, once the first attempt has written its
marker.

Two crates may export the same type name (`semver::Version` and
`uuid::Version` both do). Each crate registers its bindings under names of
its own (prefixed with the crate and the module that defines each item) and
the generated module maps them back, so the names you import stay the
crate's own — reach for the `cargo:` import rather than the runtime module
object, which carries the prefixed spelling.

### 2. App-local `.rs` source

Write a Rust file next to your other native sources and import it like a
header. Upstream crates it uses go into the same `cargoDependencies`:

```rust
// src/native/geo_surface.rs
use geo::{ConvexHull, MultiPoint, Point};

pub struct Hull { points: Vec<Point<f64>> }

impl Hull {
    pub fn new() -> Self { Hull { points: Vec::new() } }
    pub fn add(&mut self, x: f64, y: f64) { self.points.push(Point::new(x, y)); }
    pub fn wkt(&self) -> String { /* … */ }
}
```

```js
import { initNative } from './native/native.h';
import { Hull } from './native/geo_surface.rs'
```

### 3. Rust crossbind package

A whole crate published as a crossbind package: `export.type: 'cargo'` in its
`crossbind.config.js` (see [`crossbind-config.md`](./crossbind-config.md)). crossbind runs
`cargo build --release --target <triple>` per platform and stages the `.a`
like any prebuilt; consumers import the package name exactly like a C++
package. An app build first builds, in the dependency's own package, a prebuilt that is
missing or was built from another embind-rs: each prebuilt records its embind-rs in
`crossbind-embind-rs.fingerprint`, because archives from two embind-rs sources do not
link together. The wasm `mt` prebuilt builds through the same nightly `-Zbuild-std`
path described above (st and mt cargo outputs are kept in separate target
dirs — they share a triple but not their std features).

## What plain Rust maps to

| Rust | JavaScript |
|------|------------|
| `struct` + `impl` methods | class with methods (`Type::new` → constructor) |
| a struct with `Default` (derived or `impl Default`) and no `new` | a constructor with no arguments |
| an associated fn that does not return `Self` | a static function on the class (`Class.name(..)`) |
| a method that takes `self` on a `Clone` or `Copy` struct | runs on a copy, so the JS instance keeps its value; a builder chain returns a new instance at each step |
| a struct passed by value (`fn new(params: Params)`) | pass the instance; it is copied, so the struct must be `Clone` or `Copy` |
| a struct generic over one `W: Write` or `R: Read` (`XzWriter<W>`, `XzReader<R>`) | a stream class over bytes in memory (see below) |
| `pub` fields on a class | JS properties (read and write) |
| a method returning `Self` or another class | a new JS instance the caller owns |
| a method returning `&mut Self` | the same instance back, for chaining |
| `fn x(&self) -> T` next to `fn set_x(&mut self, v: T)` | one JS property `x` (the setter must return nothing) |
| `pub const` / `pub static` of i32, f64, bool or `&str` | module constant |
| `&str` / `&String` params, `String` returns | JS strings |
| `&'static str` and `Cow<'_, str>` returns | JS strings (owned on the way out) |
| `i32` / `f64` / `bool` | number / boolean |
| `i64` / `u64` | `BigInt` (both directions) |
| `Option<T>` params and returns | `null`/`undefined` → `None` on the way in; `None` → `null` on the way out |
| `Option<i64>` / `Option<u64>`, `Option<&[u8]>` / `Option<&[f64]>` params | a `BigInt` (or safe-integer number) or typed array, or `null`/`undefined` for `None`; parameters only |
| `NonZeroU32`, `NonZeroU64` and the other `NonZero` integers as params, also inside `Option` where the plain integer's `Option` crosses | the integer (a `BigInt` for 64 bits); `0` throws before the call |
| `Result<T, E>` returns | throws a JS `Error` on `Err`; an error type that is also `AsRef<str>` puts that string on `error.code` |
| `impl Display` | `toString()` |
| free `pub fn` | plain exported function |
| `&OtherClass` params | pass the other class's instance |
| `&[u8]` / `&[f64]` params | `Uint8Array` / `Float64Array`, read in place on native runtimes and copied once into wasm memory; a subarray keeps its offset, another typed array or a plain array is converted, anything else throws |
| `Vec<u8>` / `Vec<f64>` | `Uint8Array` / `Float64Array` (one copy each way) |
| `Vec<T>`, `&[T]`, `[T; N]`, `&[T; N]`, tuples | JS array (deep copy); a fixed array needs a literal length of at most 32 (serde's limit), so `[u8; 64]` or `[u8; SIZE]` leaves the function out |
| `HashMap`/`BTreeMap` with string keys | JS object (deep copy) |
| `HashSet`/`BTreeSet` | a JS `Set` is accepted; returns come back as an array |
| `impl Iterator<Item = T>` return | the collected array |
| `Option<collection>` | the array/object, or `null` |
| a struct that derives `Serialize` + `Deserialize` | plain JS object (data, not a class - its methods stay native) |
| a data-carrying `enum` that derives them | serde's own representation (`{ Variant: value }`), reshaped by serde attributes |
| `Option<record>` / `Option<value object>` | the object, or `null` |
| a struct inside a collection | needs `#[derive(Serialize, Deserialize)]`; it travels as JSON |
| `serde_json::Value` params and returns | real JS values (objects/arrays/primitives), deep-copied at the boundary |
| `Arc<Class>` factories, params and returns | shared ownership: several JS handles co-own one instance, the last `delete()` frees it (shared classes use `&self` methods and Arc factories) |
| `impl Fn(..) -> R` / `Box<dyn Fn(..) -> R>` parameter | a JS function; the Rust side calls it back during the call (arguments and result: numbers, booleans, strings) |
| `embind_rs::JsValue` / `JsFunction` params and returns | live JS values by identity (no copy) and callbacks into JS; a JS throw surfaces as `Err` (import them from `embind_rs` — the one engine import in user code) |

`#[cfg]` attributes are read against the crate's enabled features: an item behind a feature you
enabled is bound, one behind a disabled feature is not, and one that only some targets compile
(`target_arch`, `target_os` and the like) is left out on every target, so one bridge builds
everywhere. An enum whose implicit discriminants would shift with such a variant is left out
as a whole.

A struct generic over a single `std::io::Write` or `std::io::Read` parameter becomes a stream
class over bytes held in memory. Its constructor takes the arguments of `new` other than the
stream. A writer's `write(bytes)` and `flush()` return the output that call produced, which can
be empty while the encoder buffers; a method that consumes the writer and hands the `W` back, such
as `finish()`, returns the rest and ends the stream. A reader is built from the whole input as a
`Uint8Array` and offers `read(max)`, which returns fewer than `max` bytes only at the end, and
`readAll()`. The type's other `&self` and `&mut self`
methods stay callable, and a call on an ended stream throws `<Name> is finished`:

```js
// cargoDependencies: { 'lzma-rust2': '0.16' }
import { XzOptions, XzWriter, XzReader } from 'cargo:lzma-rust2'

const writer = new XzWriter(XzOptions.withPreset(6))
const parts = [writer.write(chunk1), writer.write(chunk2), writer.finish()]
const text = new XzReader(xzBytes, false).readAll()
```

The in-memory input also satisfies a reader's `BufRead` and `Seek` bounds. A writer bound beyond
`Write`, `Send`, `Sync` and `'static` (a writer that must also `Seek`, for one) has no in-memory
stand-in, so that type is left out.

On a native runtime a `&[u8]` or `&[f64]` parameter is the caller's own buffer for the
length of the call, as in napi-rs: a callback the call makes must not write to, transfer or
shrink that buffer.

`JsValue`/`JsFunction` need a synchronous runtime (native JSI, wasm `st` on the
main thread): on worker-backed runtimes (the wasm `mt` default, or
`initNative({ useWorker: true })`) functions cannot cross the worker boundary and
identity does not survive structured cloning — use `serde_json::Value` there.

The full grammar, wire contract and builder API live in
`core/embind-rust/README.md`.

A Rust panic inside a binding reaches JS as an `Error` carrying the panic message. On the wasm
runtime the instance is spent afterwards: report the error and start a fresh module rather than
calling into a panicked one. It is still a
bug: state is whatever the panic left behind, so treat the error as a crash report, not a
recoverable failure.

A wasm build that links Rust gets a 1 MiB stack, the size rustc's own wasm targets reserve;
emscripten's default of 64 KiB is too small for crates that move large structs by value, and a
wasm stack overflow overwrites memory instead of trapping. Debug builds also add
`-sSTACK_OVERFLOW_CHECK=1`, so an overflow reports itself. A size in the config wins:

```js
targetSpecs: [{ platform: 'wasm', specs: { binary: { emccFlags: ['-sSTACK_SIZE=4MB'] } } }],
```

## Editor types

Generated declarations never live in your source tree — everything sits under
`.crossbind/`, and the shared `@crossbind/typescript-config` package wires all of it.
Install it as a direct devDependency and extend it once:

```jsonc
// tsconfig.json (TS 5.5+; array form when you already extend another config)
{ "extends": "@crossbind/typescript-config" }
{ "extends": ["@react-native/typescript-config", "@crossbind/typescript-config"] }
```

Running with `initNative({ useWorker: true })`? Set `dts: 'promise'` in
`crossbind.config.js` so generated signatures match the async runtime — see
[`lifecycle-and-types.md`](./lifecycle-and-types.md).

Under the hood the fragment carries two different mechanisms: `cargo:` crates
are non-relative module names, so their declarations are ambient
(`declare module 'cargo:<name>'`, under `.crossbind/rust-crates/types/`, pulled in
via `include`); `./x.rs` imports are relative and typed by path resolution
(TypeScript does not allow ambient declarations for relative names), so their
declarations mirror the project-relative path under `.crossbind/types/` and
`rootDirs` overlays the two roots. Caveats: `include` is overridden (not
merged) when your tsconfig defines its own — keep
`.crossbind/rust-crates/types/**/*.d.ts` in yours in that case; and if you
override `paths.cache`, copy the two settings with your custom path instead.

## See also

- [`crossbind-config.md`](./crossbind-config.md) — `cargoDependencies`, `export.type: 'cargo'`, `export.crate`.
- [`cpp-binding-rules.md`](./cpp-binding-rules.md) — the C++ counterpart of this page.
- Canonical demos: `e2e/web-vite` (all three models on web), `e2e/mobile-reactnative-cli` (the same surface on devices), `core/embind-rust/demo` (a cargo-type package).
