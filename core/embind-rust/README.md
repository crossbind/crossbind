# @crossbind/core-embind-rust

Rust **producer** for the crossbind embind registration protocol. Write an idiomatic Rust
struct, register it, and it surfaces in JS as a real class - on web through emscripten's
embind, on mobile through [`@crossbind/core-embind-jsi`](../core-embind-jsi) - **with no
generated C++ wrapper and no cbindgen header**. The Rust side talks straight to the
registration ABI that both hosts already consume.

> **Status: research / spike.** The architecture is validated end to end (see the matrix
> below), but this is not yet a general-purpose package: a single class shape, hand-rolled
> arities, and registration structures that leak by design. See "Roadmap".

## How it fits

embind is a *protocol*: a producer emits `_embind_register_*` calls, and each host has a
*consumer* that turns them into JS classes (embind-js on web, embind-jsi on mobile). This
package adds a **second producer** - Rust - next to C++. Consumers are untouched.

```
PRODUCERS                    PROTOCOL (flat C-ABI)         CONSUMERS (per host)
C++   (embind macros)  ──┐                            ┌──  web    embind-js
Rust  (this package)   ──┼── crossbind_embind_register_* ─┤
                         │                            └──  mobile embind-jsi
                       adapters/{web,jsi}.cpp
```

- `crate/` - the Rust runtime (`embind-rs`): a `WireType` trait (i32, f64, bool, String) plus a
  builder API mirroring embind's `class_`. See `demo/` for usage.
- `include/crossbind_embind.h` - the stable flat C-ABI the crate binds to (raw function
  pointers, 10-param superset). Producers never touch a host's internals.
- `adapters/web.cpp` - passthrough to emscripten's `_embind_*` (10-param, identical).
- `adapters/jsi.cpp` - wraps the raw invokers into `jsi::Function` (via
  `createFromHostFunction`) and drops `isNonnullReturn` for embind-jsi's 9-param API.
  Compiled inside the React Native native module; shape-validated by `e2e/jsi-shape-check.cpp`.

## Demo: plain Rust in, JS classes out

The user's crate is **plain Rust** - no embind-rs dependency, no macro line, nothing
crossbind-specific. Exactly like C++ (where the `.h` is enough and the toolchain generates the
`.i.cpp` bridge), the engine parses the crate's pub surface and generates a **companion bridge
crate** at `<pkg>/.crossbind/bridge-crate/` that depends on the untouched user crate by path:

```rust
// demo/src/lib.rs - nothing else needed.
pub struct RustyCounter { value: i64, log: Vec<String> }

impl RustyCounter {
    pub fn new(start: i32) -> Self { /* constructor  */ }
    pub fn increment(&mut self, by: i32) -> i32 { /* method */ }
    pub fn add_span(&mut self, from: i32, to: i32) -> i32 { /* JS name: addSpan */ }
    pub fn describe(&mut self, prefix: String) -> String { /* String in AND out */ }
}

pub struct Widget { size: i32 }
impl Widget {
    pub fn create(size: i32) -> Self { /* factory -> smart_ptr + Widget.create(n) in JS */ }
    pub fn area(&mut self) -> i32 { /* .. */ }
}
```

```ts
// Typed package import - the exact .h experience, for Rust (React Native / metro):
import { initNative, RustyCounter, Widget, Mode, RustIntVector } from '@crossbind/embind-rust-demo';

await initNative();      // boots once app-wide, then binds this module's exports
const c = new RustyCounter(10);
c.increment(5); c.increment(27);
c.addSpan(2, 10);       // +8 - JS names are camelCased automatically
c.describe('count');    // "count=50 (log: +5 +27 span 2..10)"
c.setMode(Mode.Fast);
c.delete();
const w = Widget.create(6); w.area(); // 36 ; w.delete() frees the Rust Box
```

How the import works (mirrors the C++ `.h` flow): the metro resolver maps the bare package
name to the crate's `src/lib.rs`; the transformer parses that surface and emits the same
proxy-module shape as a `.h` import (`export let` per symbol, bound when an `init()` resolves).
The package build also emits `dist/js/index.d.ts` (wired via package.json `types`), so the
import is fully typed in the editor. Booting is guarded app-wide: every proxy module registers
its bindings on import, so one `init()` from `crossbind` starts the JSI lib once and binds all of
them. Calling another module's `initNative` is a no-op after the first call.

### App-local .rs files (no package needed)

An app can also import its own Rust file, exactly like its own header:

```ts
import { initNative, Counter } from './native/counter.rs';
```

On import the toolchain synthesizes a self-contained bridge crate under
`<project>/.crossbind/rust-bridges/<name>/` (the user file is embedded via `#[path] mod user;` -
no copy) plus a `counter.rs.d.ts` next to the source for full editor typing. The native builds
bundle every app-local surface into ONE super staticlib (`rust-bridges/_app_super`) and link it
into the app lib (iOS: merged into the force_loaded react-native-crossbind.a; Android: whole-archive).

App-local surfaces can use UPSTREAM crates directly - the C++-style model where the app writes
its own thin surface over a linked library and no crossbind package is involved. Declare the crates
in the app config and just `use` them:

```js
// crossbind.config.mjs
export default {
    export: { bindings: { cargoDependencies: { geo: '0.29', wkt: '0.11' } } },
    ...
};
```

```rust
// src/native/geo_surface.rs - cargo fetches geo/wkt from crates.io, no package needed.
use geo::{ConvexHull, ...};
pub struct Hull { ... }
```

This packageless flow is the canonical model (a Rust user writes their own surface, exactly
like writing native.h over a linked C library). Packaging a curated surface as a
`@crossbind/port-*-rs` stays possible for JS-only consumers - it is four files
(package.json + crossbind.config.mjs + crate/Cargo.toml + crate/src/lib.rs) - but this repo
ships none.

### Direct crate import (no surface file at all)

When an upstream crate's own API already fits the grammar, skip even the surface file: any
name declared in `cargoDependencies` can be imported through the `cargo:` scheme (the
node:/npm:/jsr: convention for a non-npm store), and the bridge is generated from the crate's
OWN multi-file source (types from lib.rs; inherent impls and `impl Display` collected across
its `mod` files, following the cargo-resolved feature set):

```js
// crossbind.config.mjs
export default {
    export: { bindings: { cargoDependencies: { uuid: '{ version = "1", features = ["v4"] }' } } },
};
```

```js
import { initNative, Uuid } from 'cargo:uuid';   // the crates.io crate, untouched
await initNative();
const u = Uuid.newV4();                         // v4.rs (feature-gated module)
`${u}`;                                         // impl Display -> toString()
Uuid.parseStr('nope');                          // Result::Err -> throws
```

The scheme makes the store explicit, so npm packages of the same name (`uuid`, `semver`)
never collide with the crate import, the ambient types (`declare module 'cargo:uuid'`) never
clash with `@types/*`, and an undeclared crate is a hard error instead of a silent npm
fallthrough.

Root re-exports are followed too - `pub use path::{X, Y};` marks module types as surface, and
`pub use path::*;` makes that module root-like - so re-export-style crates work as well:
`cargo:semver` yields `Version`/`VersionReq` with `req.matches(version)` (a class-typed
parameter), and `cargo:regex` yields `new Regex(pat)` (throws on a bad pattern) plus `isMatch`.

Out-of-grammar items are skipped with a log line (uuid's `as_u128`, slice APIs, ...), so the
generated class is the crate's *bindable subset*. The first import runs `cargo metadata`
(which fetches the crate).

### Rust archive linking rule (why no force_load)

Every Rust staticlib bundles its own libstd, so FULLY loading two of them into one binary
duplicates thousands of std symbols. The rule: **at most one Rust archive is fully loaded**
(the app super staticlib); every generated package bridge instead exports a
`crossbind_keep_<libName>()` symbol, is built with `codegen-units = 1` (keep symbol and init-array
constructor share one object), and is linked lazily with that symbol pinned
(iOS `-Wl,-u,_crossbind_keep_<lib>`, Android `-Wl,--undefined=crossbind_keep_<lib>`) - the registration
object is pulled, libstd stays lazy and deduplicates. Manual-bindings crates (no keep symbol)
still fall back to force_load/whole-archive and are therefore safe only as the app's single
Rust archive.

Web specifics: wasm-ld's `-u` does NOT pull archive members, so the wasm link pins keep symbols
with `-Wl,--export=crossbind_keep_<lib>` instead; and any Rust archive in the link makes `buildWasm`
compile `adapters/web.cpp` into the app wasm (it provides the flat `crossbind_embind_*` C-ABI - on
mobile the RN native module plays that role). Worker mode works for classes too: comlink's
construct support plus the runtime's embind transfer handlers proxy instances across the
boundary, so the usage is simply `const c = await new RustyCounter(10); await c.increment(5);`
- every binding returns a Promise in worker mode, exactly like C++ classes.

Generation rules (`crossbind/src/utils/rustBridgeGen.js`, run by `buildCargo` before cargo):

| you write | you get |
|---|---|
| `#[repr(i32)] pub enum Mode { Slow = 0, .. }` | embind enum |
| `#[repr(C)] #[derive(..Default, Copy..)] pub struct Point { pub x: i32, .. }` | value object `{x, ..}` |
| `pub fn new(..) -> Self` | constructor (max 3 args) |
| other `pub fn ..(..) -> Self` | `smart_ptr` + static factory (max 2 args) |
| `pub fn m(&mut self / &self, ..) -> R` | method (max 4 args), JS name camelCased |
| `text: &str` / `text: &String` parameter | `string` on the wire, borrowed at the call site |
| `i64` / `u64` param, return or field | JS **BigInt** (full 64-bit range, sign-correct) |
| top-level `pub fn f(..) -> R` | module-level free function (max 4 args), camelCased |
| `impl Display for C` | `toString()` on the class (so `` `${obj}` `` formats) |
| `-> Result<T, E>` (ctor, factory, method or free fn; `E: Display`) | Err becomes a **thrown JS exception** |
| `-> Option<Self>` (factory) | None becomes **JS null** (typed `X \| null`) |
| `-> Option<i32 / f64 / bool / String>` (method or free fn) | Some -> value, None -> **undefined** (typed `T \| undefined`) |
| `Option<i32 / f64 / bool / String>` parameter | JS undefined/null -> None (typed `T \| null \| undefined`) |
| `other: &SomeClass` parameter | pass another bound instance (borrowed for the call) |
| `export.bindings.vectors: [{ of: 'i32', name: '..' }]` in crossbind.config.mjs | `register_vector` |

Anything outside this surface is skipped **with a log line** (e.g. `Option` of an enum or a
value object, `Option` parameters, `Result<Option<..>>`). The bridge crate dodges the orphan rule with
`#[repr(transparent)]` newtype wrappers + shim fns, so the user's types never need to
implement `WireType`. A crate that calls `embind_rs::bindings!` itself opts out of generation
and is built directly (the manual API below stays fully supported).

`constructorN` / `functionN` (N = 0..4) are generated by `macro_rules!`; registration data
(typeids, argType arrays, signature strings) lives in one process-lifetime arena rather than
scattered `Box::leak`.

## Test

`pnpm e2e:prod` runs two legs (needs Rust + the emscripten target + a local emsdk):

1. **web** - `demo` crate → wasm, linked with `adapters/web.cpp` + `-lembind`, called from
   node. The class is materialized by **unmodified embind-js**.
2. **mobile-shape** - same crate compiled native, run against a jsi-*shaped* mock consumer
   that mirrors embind-jsi's real signatures. Validates the adapter's wrapping /
   marshalling / param-dropping.

## Status matrix

| Path | State |
|---|---|
| web: Rust → flat ABI → embind-js (emsdk 5.0.3, 6.0.2 & 6.0.9) | ✅ tested, runs (full demo incl. f64 + string) |
| mobile: adapter shape vs real embind-jsi signatures | ✅ shape-validated (native mock) |
| mobile: real Hermes / device smoke (iOS simulator, RN app) | ✅ GREEN 32/32 — ctor, N-arity, bool, enum, string both ways, value object both ways, vector, smart_ptr factory, f64 both ways, delete, app-local .rs, idioms, BigInt, Display, free fns, Option both ways, class params, semver/regex imports |
| mobile: real Hermes / device smoke (Android emulator, same RN app) | ✅ GREEN 32/32 — same demo, same adapter; cargo dep joins the cmake depends graph, keep-symbol linked; a NEW bare-crate import now links in the FIRST build (rust set busts the CMake configure) |
| app-local `.rs` import (`./native/counter.rs`, both mobile platforms) | ✅ GREEN — synthesized bridge crate + app super staticlib + typed `counter.rs.d.ts` |
| typed package import (`import { X } from '@crossbind/embind-rust-demo'`) | ✅ GREEN on iOS, Android AND web (vite) — resolver + proxy module + generated d.ts; web verified by playwright on chromium/firefox/webkit |
| real-world upstream crate, packageless (`geo` via `cargoDependencies` + app-local surface) | ✅ GREEN — Hull (ConvexHull) on iOS + Android (26/26 smoke) AND in the browser (worker-mode playwright, 3 browsers): the same surface .rs serves all three platforms — a wasm output upstream geo never shipped |
| Rust idioms: `&str`/`&String` params, `Result` → JS exception, `Option<Self>` → null | ✅ GREEN — e2e (web + jsi-mock legs), worker-mode playwright on 3 browsers, iOS sim + Android emulator (throw message, null, borrowed str all asserted) |
| i64/u64 → BigInt, `impl Display` → toString(), top-level free functions | ✅ GREEN — same full bar (e2e both legs, 3-browser worker playwright, both devices); u64::MAX round-trips exactly, free `Result` fns throw |
| DIRECT crate import (`import { Uuid } from 'cargo:uuid'` — untouched crates.io source, multi-file parse, feature-gated modules) | ✅ GREEN — worker-mode playwright on 3 browsers + iOS sim + Android emulator 26/26 (newV4 format, parse roundtrip, Display toString, Err throws) |
| `Option<i32/f64/bool/String>` returns → value-or-undefined | ✅ GREEN — e2e both legs (mock reads the nullable cell natively), 3-browser worker playwright, both devices |
| Option params + `&SomeClass` params + re-export following (`semver` matches, `regex` throwing ctor as DIRECT imports) | ✅ GREEN — e2e both legs, 3-browser worker playwright, Android 32/32 + iOS 32/32 — via the explicit cargo: scheme, so npm names never collide |
| Rust crate → real mobile archives (android/ios arm64) | ✅ compiles; iOS and Android linked+run |

### Wire contract notes (native vs wasm)

- Sliced invokers: embind's `getDynCaller(slice=true)` drops the leading target-fn arg for
  constructor/method/static invokers, so the jsi adapter bakes the target at registration and
  prepends it when dispatching. Direct fns (getActualType/dtor/smart_ptr/value_object) map 1:1.
- `'s'` (std::string): embind-jsi passes strings as `jsi::String`, not a pointer — the jsi adapter
  marshals jsi::String ↔ the crate's `[u32 len][bytes]` buffer. On wasm the wire IS that pointer,
  so the web adapter maps `'s'`→`'p'` in dynCall signatures (`sigForWasm`).
- `'d'` (f64): on native the crate carries doubles as bit patterns in `u64`
  (`f64::to_bits`/`from_bits`, cfg-gated), keeping every invoker C signature integer-class — so the
  adapter's uint64-slot bounded dispatch is ABI-correct on every native ABI with no libffi and no
  per-arch assembly (Apple ships libffi as private API on iOS, so this also stays App-Store-safe).
  On wasm the wire stays a real f64 (embind-js dyncalls the invoker directly).
- Errors (`Result::Err`): Rust cannot unwind across the C-ABI, so shims call
  `embind_rs::raise_err(msg)` → the adapter-owned `crossbind_embind_raise_error`. On wasm that import
  is an `EM_JS` that throws a real JS `Error` immediately (the invoker never returns); on native
  the jsi adapter parks the message in a thread-local and throws `jsi::JSError` right after the
  invoker returns its dead sentinel value. `Option<Self>` needs no escape: a null pointee maps to
  JS null by embind's own smart-pointer rules on both consumers.
- `'j'`/`'u'` (i64/u64): both are 64-bit integer-class slots, so bounded dispatch holds; the jsi
  adapter converts BigInt ↔ raw 64 bits (signed read for 'j', unsigned for 'u' — sign lives in
  the sig char, the registered typeid carries it for embind itself). emscripten's dynCall alphabet
  only has 'j', so `sigForWasm` maps 'u' → 'j' on web.
- JSON values (`serde_json::Value`): the registered arg/ret type is emval (`typeid(val)` on both
  consumers), so the host marshals a real JS value to a handle; the bridge's `__CrossbindJson` wire
  turns the handle into `[u32 len][bytes]` JSON text through the adapter's host-JSON codec
  (`crossbind_emval_json_to_handle` / `crossbind_emval_handle_to_json`) and serde maps text ↔ `Value`.
  A deep copy by design (JSON semantics: `undefined`/functions cross as null); the handle slot is
  integer-class (`'i'`), so wasm dynCall and native bounded dispatch both hold unchanged.
- Shared ownership (`Arc<T>`): Arc-as-intrusive - the smart-pointer wire IS the `Arc::into_raw`
  pointer, one strong count per JS handle. `.smart_ptr_shared` registers sharing INTRUSIVE with
  share = `Arc::increment_strong_count` and destructor = `Arc::from_raw` drop; `Arc<T>`
  params/returns cross through per-class `TShared` wrappers (give a count on to_wire, add one
  on from_wire). Shared classes allocate only via Arc factories and keep `&self` methods - the
  generator hard-errors on Box-allocating shapes that would corrupt the shared delete().
- Live JS values (`embind_rs::JsValue`/`JsFunction`): the registered type is emval, the wire is
  an OWNED handle (params arrive owned - Drop decrefs; returns transfer the count). The crate
  talks to the host through `crossbind_v_*` hooks: EM_JS over `Emval` on web, fork-JS helpers with
  BigInt handles on native (never the fork's wasm-heap emval string plumbing). `JsFunction`
  calls catch the JS throw host-side and surface it as `Err(message)`; handles are
  thread-affine, so retained callbacks stay on the JS thread (`thread_local!` storage).
  Worker-backed runtimes (wasm `mt` default / `useWorker: true`) are out: functions cannot
  cross the worker boundary and identity does not survive structured cloning - the JSON
  value surface is the worker-safe alternative.
- Free functions ride `_embind_register_function` (argTypes = `[ret, args..]`, no `this`); both
  consumers slice the target like methods, so the jsi adapter bakes + prepends there too.
- Public names are a single embind namespace shared with every linked C++ package — demos must not
  claim generic names (`VectorInt` collided with a linked package; the demo uses `RustIntVector`).

## Roadmap (toward C++/embind parity)

1. ~~Ownership: replace `Box::leak` with a real registration-lifetime store.~~ ✅ arena.
2. ~~Arities: N args.~~ ✅ `macro_rules!` generates `constructorN`/`functionN` (0..4).
   ~~Ergonomics~~ ✅ superseded by toolchain generation: plain Rust in, companion bridge crate
   out (`rustBridgeGen`), so no proc-macro is needed.
3. Type universe: ~~primitives (i32, f64, bool, String, void)~~ ✅, ~~smart_ptr / `.create`~~ ✅
   (sharing NONE, identity-over-Box), ~~C-like enums~~ ✅ (`enum_::<E>().value(..)`),
   ~~value objects~~ ✅ (`value_object_::<T>().field::<F>(name, offset_of!(..))`),
   ~~vector~~ ✅ (`register_vector::<T>(name)`), ~~`&str`/`&String` params~~ ✅,
   ~~`Result<T, E>` → JS exception~~ ✅ (`raise_err` + adapter error escape),
   ~~`Option<Self>` factories → null~~ ✅ (null smart pointer, no `register_optional` needed),
   ~~i64/u64 → BigInt~~ ✅ ('j'/'u' slots), ~~free functions~~ ✅ (`embind_rs::fnN` +
   `crossbind_embind_register_function`), ~~`impl Display` → toString()~~ ✅,
   ~~scalar/String `Option` returns~~ ✅ (wasm: emval handle into embind's own optional type;
   native: nullable heap cell + the fork's identity jsiValue type - no fork JS changes),
   ~~`Option` parameters~~ ✅ (wasm: `val::take_ownership` readers; native: adapter-owned
   cells), ~~class-typed parameters~~ ✅ (per-class Ref wrappers over the class pointer wire),
   ~~`serde_json::Value` params/returns~~ ✅ (deep JSON copy through the host JSON codec; web
   e2e + iOS/Android device smoke 36/36 each).
   ~~shared ownership (`Arc<T>`)~~ ✅ (Arc-as-intrusive: `.smart_ptr_shared` registers embind's
   INTRUSIVE policy, share bumps the strong count and delete() drops one; factories return
   `Arc<Self>`, methods stay `&self`; web e2e + iOS/Android device smoke 40/40 each),
   ~~live JS values~~ ✅ (`embind_rs::JsValue`/`JsFunction`: identity-preserving emval handles,
   get/set/prims, callbacks with JS-throw -> `Err` and retained callbacks; web e2e +
   iOS/Android device smoke 45/45 each - the one deliberate embind-rs import in user code).
   Still open: proc-macro ergonomics superseded by toolchain generation.
4. ~~Trigger: move registration into an `.init_array` ctor; shrink the C++ shim.~~ ✅
   `embind_rs::bindings! { .. }` registers from a platform init-array constructor (no C++
   trigger); the shim is now just typeid getters + passthroughs. The consumer staticlib is
   whole-archived so the constructor is pulled in.
5. ~~Real device smoke via React Native.~~ ✅ iOS simulator AND Android emulator, full demo 23/23
   each (see status matrix). Still open: version discipline, `#[crossbind::bind]` proc-macro ergonomics.

## Distribution (version discipline)

The producer crate and both adapters ship in THIS npm package, so the whole binding contract
(generator JS in `crossbind`, `embind-rs`, `adapters/*.cpp`) moves on a single npm version axis -
no cross-registry skew. The engine never depends on this package (same direction rule as
`core-embind-jsi`): the consumer declares it and the engine only resolves it -

- React Native apps get it transitively via `@crossbind/plugin-react-native`;
- web apps via `@crossbind/plugin-vite` / `@crossbind/plugin-rollup`;
- standalone cargo packages declare `@crossbind/core-embind-rust` in their devDependencies
  (see `demo/package.json`).

Generated bridge manifests carry a `# embind-rs from @crossbind/core-embind-rust <version>`
stamp and a machine-local path into the resolved install; they are per-machine build
artifacts under `.crossbind/` and are regenerated on every build. A crates.io release of the
crate is a 1.0-era option for hand-written `bindings!` crates; the toolchain path stays
npm-resolved either way.

## Building as a crossbind package

Rust is a first-class crossbind package via the engine's `buildType: 'cargo'` (no per-project
script). A package declares `export: { type: 'cargo', libName: ['demo'], crate: '.' }`; crossbind
runs `cargo build` on the host for each platform's triple (`crossbind build -p ios` →
aarch64-apple-ios + -sim), stages the `.a` as a normal prebuilt, and its usual pipeline
produces the xcframework / links it. `demo/crossbind.config.mjs` is the working example. (iOS is
clean on the host; wasm needs a sourced emsdk, android an NDK / cargo-ndk.)
