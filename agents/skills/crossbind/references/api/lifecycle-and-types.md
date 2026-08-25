<!-- GENERATED from docs/api/lifecycle-and-types.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Lifecycle & TypeScript notes

> Two short topics in one doc, because each is small enough not to deserve its own.

## Memory & object lifecycle: there's nothing to manage in JS

crossbind doesn't expose raw pointers across the JS↔C++ boundary (see [`cpp-binding-rules.md`](./cpp-binding-rules.md) Rule 1). Because of that, **you don't call `m.delete()` or release any C++ object from JS**. The lifecycle is entirely C++-side:

- Objects passed by value to JS get copied; the C++ original is destroyed normally.
- Objects returned as `std::shared_ptr<T>` are reference-counted. JS holds a strong reference; when JS-side reference goes out of scope (garbage collected), the shared_ptr count drops, and C++ destructor runs when the count hits zero.
- `std::vector<T>`, `std::string`, `std::map<K,V>` and similar containers are converted to JS-side equivalents on the boundary; their C++ memory is reclaimed at conversion time.
- Embind objects (when JS holds a vector/struct proxy) are auto-released when the JS reference is GC'd. You don't track them.

### Things you do NOT do

```js
const v = m.someFunc()    // returns a vector
const arr = m.toArray(v)
v.delete()                 // ❌ NOT a thing in crossbind
```

The auto-binder doesn't expose `.delete()` because there's no raw pointer to clean up. If you see `.delete()` patterns in stock embind tutorials, ignore them — those are for raw embind, not crossbind.

### When C++ has a long-lived resource

If your C++ class wraps a file handle, GPU buffer, network socket, etc., model it C++-side with RAII:

```cpp
class FileReader {
  public:
    FileReader(const std::string& path) : fp_(std::fopen(path.c_str(), "r")) {}
    ~FileReader() { if (fp_) std::fclose(fp_); }   // RAII closes on destruction
    std::string readAll();
  private:
    FILE* fp_;
};
```

JS:

```js
const reader = new m.FileReader('/memfs/myapp/data.txt')
const text = reader.readAll()
// reader is GC'd later → C++ destructor runs → fclose runs.
```

If you need deterministic close (don't wait for GC), expose an explicit `close()` method on the C++ class and call it from JS. That's the binding-friendly pattern.

### Reference cycles

Standard JS rules apply. If a JS proxy of a C++ shared_ptr captures a closure that holds the same proxy, you have a cycle that GC won't break. Solution: same as in regular JS — don't capture self-references in long-lived closures, or break the cycle explicitly when done.

## TypeScript: `.d.ts` is generated for your imports

crossbind emits declaration files for the native modules you import — C++ headers
(`./native/native.h`), app-local Rust files (`./native/x.rs`) and `cargo:`
crate imports — under `.crossbind/types/` and `.crossbind/rust-crates/types/`, never
next to your sources. Wire them once by extending the shared config
(`npm i -D @crossbind/typescript-config`, TS 5.5+):

```jsonc
// tsconfig.json
{ "extends": "@crossbind/typescript-config" }
```

What you get per import: classes with constructor/method signatures for the
supported binding surface (primitives, `std::string`, `shared_ptr<Class>` on
the C++ side; the full idiom table on the Rust side — see
[`rust.md`](./rust.md)). Anything the surface parser does not understand is
skipped with a log line and the exported symbol falls back to `any` — the
export list itself always comes from the bridge, so names are never missing.

### Caveats

1. **Worker mode wraps calls in Promises — set `dts: 'promise'`.** By default
   generated signatures describe the direct (sync) surface; with
   `useWorker: true` every call returns a Promise at runtime. Declare it in
   `crossbind.config.js`:

   ```js
   export default { dts: 'promise', /* ... */ }
   ```

   Every generated method/function return becomes `Promise<...>`; write
   `await` per call, and `await new X(...)` for construction (TS cannot
   express async constructors — the await is a no-op on sync runtimes and
   required under a worker). A hand-written facade remains useful only when
   you want richer domain types than the generated surface.

2. **Package headers are not mirrored on the consumer side** — the package
   itself publishes them: set `types: true` in the package's
   `crossbind.config.js` and its build emits one combined declaration over every
   public header into `dist/types/index.d.ts`, wiring `types` +
   `typesVersions` in package.json automatically (worker-first packages
   combine it with `dts: 'promise'`). Only the runtime module surface
   (`m.FS` helpers, custom module interfaces) still warrants hand-written
   typings.

3. **`any` fallback is deliberate.** Vector classes and unparsed members
   degrade to `any` rather than blocking — tighten them with a facade where
   it matters.

## See also

- [`cpp-binding-rules.md`](./cpp-binding-rules.md) — why no raw pointers means no manual deletion.
- [`init.md`](./init.md) — `Module` shape, helper methods.
- [`filesystem.md`](./filesystem.md) — long-lived FS resources (mounts, OPFS handles).
