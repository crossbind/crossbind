# @crossbind/core-embind-rust

## 2.0.0-beta.53

### Patch Changes

- Republished as part of the complete 2.0.0-beta.53 set. beta.52 reached npm only in part.

## 2.0.0-beta.52

### Patch Changes

- Aligned on the 2.0.0-beta.52 baseline. No source change; the version exists so every package in
  the workspace names the same release.

## 2.0.0-beta.50

### Patch Changes

- Aligned on the 2.0.0-beta.50 baseline. No source change; the version exists so every package in
  the workspace names the same release.

## 2.0.0-beta.33

### Minor Changes

- Initial release: the Rust binding layer for crossbind. A pure-Rust producer crate
  (`embind-rs`) speaks a stable flat C ABI (`include/crossbind_embind.h`); per-host
  adapters materialise the registrations in emscripten embind on web
  (`adapters/web.cpp`) and in embind-jsi on iOS/Android (`adapters/jsi.cpp`) —
  the same Rust archive works on every platform.
- Supported surface: structs with `impl` methods (constructors, `Self` returns),
  `&str`/`&String` parameters and `String` returns, `i32`/`f64`/`bool`,
  `i64`/`u64` as `BigInt`, `Option<T>` in both directions, `Result<T, E>` as JS
  throws, `impl Display` as `toString()`, free functions, `&Class` parameters,
  enums, smart pointers and value objects.
- The engine does not depend on this package: apps (or the bundler plugins,
  which carry it as a dependency) declare it, and crossbind resolves it from the
  consumer. Bridge crates are generated from plain Rust source — crates.io
  crates via the `cargo:` import scheme, app-local `.rs` files, or whole-crate
  packages via `export.type: 'cargo'`.
