# Lifecycle & TypeScript notes

> Two short topics in one doc, because each is small enough not to deserve its own.

## Memory & object lifecycle

An object crossbind hands to JavaScript is freed when the garbage collector reclaims its last handle, and `.delete()` frees it at once.

Wherever the runtime has `FinalizationRegistry` (browsers, on the page thread and in a worker, Node.js, in a wasm build and in a Node-API addon, and React Native 0.88 and later), the collector frees:

- an instance of a C++ class made with `new`, which C++ holds through a `std::shared_ptr`;
- a value a function or a method returns, a struct, a class or a `std::vector`, which crosses as a copy;
- a vector `toVector` builds, and an instance of a Rust struct made with `new`;
- in worker mode, the worker's object behind each handle the main thread lets go of. A vector the worker returns arrives as a plain array, and its C++ copy is freed as it crosses.

The collector runs when it chooses, and it weighs only a handle's small JavaScript object, not the C++ memory behind it. Call `.delete()` on an object that holds a lot of memory or a resource, and on objects made in a loop; the handle cannot be used after it. On React Native before 0.88, whose Hermes engine has no `FinalizationRegistry`, `.delete()` is the only way to free an object.

What stays C++'s:

- An object a function returns through a raw pointer (`T *`): the instance points at it and frees nothing, and nor does a `NativePointer` handle for memory a library returns (see [`cpp-binding-rules.md`](./cpp-binding-rules.md) Rule 1). Free that memory with the library's own function. A handle does free what crossbind allocated for it (`allocBuffer`, `allocPointer`, `allocString`, `cstring`).
- An object C++ keeps: a C++ function that stores an object it gets from JavaScript takes it as a `std::shared_ptr`, or the object goes when JavaScript lets go of it.
- The handle a mutable global arrives as (see [`cpp-binding-rules.md`](./cpp-binding-rules.md) Rule 10): the module keeps it while it runs, so letting go of it frees nothing.

A pointer a method or a field hands out can point into the object it came from: a raw pointer or a reference to an object that cannot be copied, a member behind a `std::unique_ptr`, the object itself from a fluent call, or a `NativePointer` into its memory. The pointer's handle keeps that object alive, so the object goes once nothing reaches either handle, and `.delete()` on the object's own handle frees it only after the pointer's handle goes too:

```js
const leaf = new Tree().child();   // the temporary Tree stays as long as leaf does
leaf.value();                      // safe after any number of collections
```

A pointer a free function or a static method returns keeps nothing alive: hold the object it points into for as long as you use the pointer.

### When C++ has a long-lived resource

If your C++ class wraps a file handle, GPU buffer, network socket, etc., release it in the destructor (RAII), so `.delete()` closes it:

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
reader.delete()   // ~FileReader runs now and closes the file
```

### Reference cycles

Standard JS rules apply. If a JS proxy of a C++ shared_ptr captures a closure that holds the same proxy, you have a cycle that GC won't break. Solution: same as in regular JS — don't capture self-references in long-lived closures, or break the cycle explicitly when done.

## TypeScript: `.d.ts` is generated for your imports

crossbind emits declaration files for the native modules you import — C++ headers
(`./native/native.h`), app-local Rust files (`./native/x.rs`), `cargo:` crate
imports and `conan:` header imports — under `.crossbind/types/`,
`.crossbind/rust-crates/types/` and `.crossbind/conan/types/`, never next to your sources. Wire them once by extending the shared config
(`npm i -D @crossbind/typescript-config@beta`, TS 5.5+):

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
