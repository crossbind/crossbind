# node-api-jsi (vendored)

A JSI (`facebook::jsi`) implementation on top of Node-API. It lets the embind runtime in
`@crossbind/core-embind-jsi` run inside a Node.js addon unchanged.

- Upstream: https://github.com/microsoft/node-api-jsi
- Commit: `4b8a4a59c4e1b7b988b809dedffd89a7662aa785` (upstream publishes no releases)
- Archive: `https://codeload.github.com/microsoft/node-api-jsi/tar.gz/4b8a4a5`,
  sha256 `701dfaac5b281b9b67986611ba612d6fe253c434f65459c877b24debf41d3c43`
- License: MIT, see `LICENSE`

Only the files the addon compiles are kept: `src/NodeApiJsiRuntime.*`, the `src/ApiLoaders`
Node-API and JSRuntime loaders, `jsi/jsi/{jsi.h,jsi-inl.h,jsi.cpp,instrumentation.h}` and the
`node-api` headers. `jsi.h` falls back to `JSI_VERSION` 21 when no compile definition sets it, so
no `jsi-version.h` is needed.

## Local patches

- `src/NodeApiJsiRuntime.cpp` includes `<atomic>` and `<utility>`, which GCC and Clang do not
  pull in transitively.
- `jsiHostFunctionCallback` is declared `NAPI_CDECL` instead of `__cdecl`, so the calling
  convention only applies where Node-API defines one (Windows).
- `createStringFromAscii`, `createStringFromUtf8`, `createBigIntFromInt64`,
  `createBigIntFromUint64`, `bigintIsInt64`, `bigintIsUint64`, `truncate`, `utf8(const String&)`
  and `call` skip their own `NodeApiScope` while a pointer value scope is open and has taken fewer
  than `MaxUsesPerOpenScope` (64) such calls. Upstream wraps every primitive they return in an
  object behind a `napi_ref` when that scope closes and reads it back on use; a string-returning
  call went from about 370 to 120 ns and a `const char*` argument, seven emval round trips, from
  4.2 to 1.3 µs. The cap keeps a loop inside one call bounded: without it, a million callbacks
  from one call raised peak memory from 96 to 649 MB. `getProperty`, `instanceOf`,
  `isArrayBuffer`, `size` and `data` of an `ArrayBuffer`, and `callAsConstructor` skip it the same
  way: reading a typed array from C++ opened a Node-API handle scope (a heap allocation in Node)
  for each of these, and a Rust `&[u8]` argument went from 1.16 to 0.94 µs.
- `NodeApiPendingDeletions` keeps an atomic flag, so `deletePointerValues` takes its mutex only
  when something waits for deletion (about 10 to 20 ns off every call).
- `NodeApiRefCountedPointerValue::decRefCount` marks a value released on the JS thread while it
  is still on the value stack and has no `napi_ref` for the stack to delete, which is all the
  pending deletion would do, and skips the recursive mutex it takes twice. embind reads every
  `this` pointer and string argument through such a clone: a four-double method call went from
  384 to 362 ns and a `std::string` argument from 211 to 179 ns.
- `JsiValueViewArgs` constructs each argument in place and destroys only those, instead of
  building `MaxStackArgCount` `jsi::Value`s, move-assigning into them and destroying all of them
  out of line on every call: 369 to 347 ns for the same method call.
- `NodeApiJsiRuntime` answers `castInterface` for `crossbind::IDirectReads`
  (`core/embind-jsi/cpp/src/crossbind/direct_reads.h`). `typedArrayElements` makes one
  `napi_get_typedarray_info` call where reading the view's `buffer`, `byteOffset` and `length`
  through the object API took about 440 ns, most of a Rust `xxh32` call on 32 bytes, which went
  from 591 to 87 ns. `bigIntToUint64` and `bigIntToInt64` read a BigInt argument without cloning
  it into a heap pointer value first; embind-jsi reads `this` and its other 64-bit values through
  them, and a method call such as `vector.size()` went from 61 to 51 ns.
- `NodeApiRefCountedPointerValue` takes its memory from a per-thread list of up to 64 blocks
  instead of malloc: most live for one host call, a string, BigInt or `this` read or made during
  it. A string return went from 75 to 69 ns and a string argument from 95 to 84 ns; together with
  the direct BigInt read, a Rust `xxh64` call on 32 bytes with a BigInt seed and result went from
  141 to 110 ns. A million callbacks in one call peak at the same 70 MB.
