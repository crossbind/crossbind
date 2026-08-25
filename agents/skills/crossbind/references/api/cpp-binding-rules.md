<!-- GENERATED from docs/api/cpp-binding-rules.md by scripts/build-agent-skill.mjs. Do not edit. -->

# C++ Binding Rules — write C++ that crossbind can auto-bind

> crossbind generates JS bindings automatically. There are no `EMSCRIPTEN_BINDINGS` macros to hand-write. But the generator only handles a constrained subset of C++. Stay inside that subset and you get binding-for-free; step outside and you'll need a wrapper or a SWIG escape (`swig-escape.md`).

This doc tells you the rules. **For the canonical type table** (which JS type maps to which C++ type, with `toArray`/`toVector` examples), use the website:

- `https://crossbind.dev/docs/api/cpp-bindings/overview`
- `https://crossbind.dev/docs/api/cpp-bindings/data-types`

This page covers what the website doesn't: the **rules** an agent must follow when writing C++ that crossbind will bind.

## The hard rules

### 1. No raw pointers in public API

```cpp
// ❌ Won't bind
MyClass* getInstance();
void process(int* data, size_t len);
char* getName();

// ✅ Bind cleanly
std::shared_ptr<MyClass> getInstance();
void process(const std::vector<int>& data);
std::string getName();
```

crossbind doesn't expose pointer arithmetic, lifetime, or aliasing semantics to JS. If your library uses raw pointers, you have two options:

- **Wrap it** (preferred — see [§ Wrapper pattern](#wrapper-pattern) below).
- **Hide it behind a SWIG `.i` file** (escape hatch — see `swig-escape.md`).

### 2. C++11 minimum, C++17 recommended

Build defaults assume modern C++. Use:

- `std::string`, `std::vector<T>`, `std::map<K,V>`, `std::unordered_map<K,V>`
- `std::shared_ptr<T>` for heap-allocated objects you return to JS
- `std::optional<T>` (C++17), `std::variant<...>` (C++17) — supported via website type table
- Range-based for, `auto`, lambdas, `nullptr`

Runtime notes from the cross-runtime conformance suite: vector PARAMETERS take a vector
instance on direct runtimes (build one from a method returning `std::vector`); plain JS
arrays are coerced only by the worker proxy. By-value `std::vector` RETURNS are real vector
proxies on direct runtimes (wasm and jsi) and arrive as plain JS arrays on worker-backed
runtimes - that array conversion is the worker contract (`Module.toArray` accepts both
shapes). `std::optional<T>` binds on every leg (the jsi fork registers optionals alongside
each `register_vector<T>`, mirroring upstream embind).

Avoid:

- `std::unique_ptr` returned by value across the binding (use `shared_ptr` for cross-boundary ownership)
- C-style strings (`char*`) and C-style arrays (`int[]`) in public API
- Custom allocators, placement new, manual `malloc`/`free` exposed to JS

### 3. Class members must be public to bind

```cpp
class Matrix {
  public:
    int rows;            // ✅ accessible from JS
    int cols;
    int get(int i, int j) const;
  private:
    std::vector<int> data;  // ❌ not exposed (still works internally)
};
```

Private members are fine — they just won't appear in JS. Don't try to hide everything `private` and expect JS to call into your class.

> Reality check (cross-runtime conformance suite): public VALUE fields (numbers, `bool`,
> `std::string`) are bound on every leg — the pipeline injects embind `.property` lines for
> them, so `m.rows` reads and writes from JS on node, browser (worker runtimes go through
> the proxy: `await b.rows`) and React Native alike. Fields of vector, `shared_ptr` or
> class type still need accessor methods.

### 4. Inheritance + virtual works; multiple inheritance doesn't

Single-base `virtual` polymorphism is supported. Multiple inheritance (especially diamond) breaks the auto-binder. Refactor to composition or use a `.i` wrapper.

### 5. Templates must be explicitly instantiated

```cpp
// ❌ Won't bind — template only
template<typename T> class Buffer { ... };

// ✅ Bind these specific instantiations
template class Buffer<int>;
template class Buffer<float>;
```

The auto-binder needs concrete types. Add `template class Buffer<T>;` declarations for every instantiation you want to expose.

### 6. Memory + lifecycle is C++-side

You **don't** call `m.delete()` in JS. crossbind doesn't expose raw pointers, so JS-side manual cleanup isn't required. C++ destructors and `shared_ptr` reference counting handle it. See `lifecycle-and-types.md`.

### 7. Exceptions: thrown C++ exceptions become JS exceptions

`throw std::runtime_error("...")` in C++ surfaces as a thrown JS `Error` with the message. Use this rather than out-parameters or status codes — it's the binding-friendly path.

```cpp
double sqrt(double x) {
    if (x < 0) throw std::invalid_argument("sqrt of negative");
    return std::sqrt(x);
}
```

In JS:

```js
try {
    m.sqrt(-1);
} catch (e) {
    console.error(e.message);  // "sqrt of negative"
}
```

> Reality check (cross-runtime conformance suite): the thrown exception surfaces as a JS
> `Error` carrying the text on every leg. On wasm legs `.message` is
> `"<type>: <what()>"` (e.g. `std::invalid_argument: sqrt of negative`), with the parts
> also available as `e.cppType` / `e.cppMessage` — the runtime decodes the raw
> `WebAssembly.Exception` via the exported `getExceptionMessage` helper. On the jsi (React
> Native) path the fork rethrows `std::exception` as a `JSError`, so `.message` is the
> plain `what()` text.

## Wrapper pattern

If the upstream library you're using has raw pointers, multiple inheritance, templates, or other unbindable patterns, you wrap it. Two locations work:

### A. App-side wrapper (preferred for one-off integration)

You're building an app that uses an unwrapped C++ library. Write the wrapper in your `src/native/` folder:

```
my-app/
└── src/native/
    ├── upstream/         # vendored upstream lib
    │   └── upstream.h    # has raw pointers
    └── wrapper.h         # YOUR clean API
    └── wrapper.cpp
```

```cpp
// wrapper.h
#include "upstream/upstream.h"

class CleanWrapper {
  public:
    CleanWrapper();
    std::vector<float> process(const std::vector<float>& input);
  private:
    std::shared_ptr<upstream::RawType> raw_;
};
```

crossbind binds `CleanWrapper`; the raw type stays internal.

### B. Lib-side wrapper (when authoring a `ports/*`)

If you're writing a reusable `@crossbind/port-X`, put the wrapper inside the package's source folder so all consumers benefit:

```
ports/mylib/
└── wasm/
    └── src/native/
        └── wrapper.h        # exposed binding API
```

App-side wrapper is the default; lib-side only when you're publishing a package.

## Advanced: JSPI flag (experimental)

The Emscripten `-sJSPI` flag enables JavaScript Promise Integration — letting C++ code call into JS-promising code synchronously (the C++ stack suspends on `await`). The living demos are `e2e/backend-nodejs` and `e2e/backend-nodejs-multithread` (Node, run with `--experimental-wasm-jspi`), where a `_JSPI` method performs a curl request over the network.

You'd opt in via `targetSpecs[].specs.emccFlags` in `crossbind.config.js`:

```js
targetSpecs: [{
    platform: 'wasm',
    specs: { emccFlags: ['-sJSPI'] },
}]
```

### Naming rule: `_JSPI` suffix

Once `-sJSPI` is enabled, **any C++ method or function that should be JSPI-wrapped must end with `_JSPI`**. The crossbind auto-binder detects the suffix and emits `emscripten::async()` on the binding so the call returns a `Promise` on the JS side and the C++ stack can suspend mid-execution.

```cpp
// native.h
class Native {
public:
  static std::string sample();          // regular sync binding
  static void ops_JSPI();               // JSPI-wrapped — async on JS side
  static std::vector<std::string> listVirtualFiles_JSPI();
};
```

The auto-generated bridge becomes:

```cpp
.class_function("sample", &Native::sample)
#ifdef CROSSBIND_JSPI
.class_function("ops_JSPI", &Native::ops_JSPI, emscripten::async())
#endif
#ifdef CROSSBIND_JSPI
.class_function("listVirtualFiles_JSPI", &Native::listVirtualFiles_JSPI, emscripten::async())
#endif
```

Every async registration is guarded behind `CROSSBIND_JSPI`, which crossbind defines only for targets whose `emccFlags` include `-sJSPI`. One bridge file serves every target of a package, so on a target **without** the flag a `_JSPI` binding is simply absent on the JS side — the build logs `_JSPI bindings skipped: this target links without -sJSPI` — instead of aborting emsdk DEBUG builds at embind registration time ("Async bindings are only supported with JSPI").

On the JS side, call the function with the suffix preserved and `await` it:

```js
await m.Native.ops_JSPI();
const files = await m.Native.listVirtualFiles_JSPI();
```

If you forget the suffix, the binding stays synchronous; calls into JS promises from inside that C++ function will then crash with `Cannot suspend without JSPI` at runtime.

Where JSPI actually works (verified against the playgrounds):

- **Node (st and mt)**: works behind `node --experimental-wasm-jspi`; without the flag a JSPI-linked module aborts at boot ("JSPI not supported by current environment").
- **Browser, st runtime**: Chromium only. Firefox and WebKit ship no `WebAssembly.Suspending`, and a glue linked with `-sJSPI` refuses to boot there even if nothing ever suspends.
- **Browser, mt (pthreads) runtime**: do NOT combine with `-sJSPI`. The pthread mailbox enters wasm outside a promising export, so Chromium throws `SuspendError: trying to suspend without WebAssembly.promising` at boot. The mt web playgrounds deliberately carry no JSPI flag for this reason.

Use cases: callbacks into JS that fetch network data, awaiting JS promises mid-C++. Don't enable it unless you specifically need synchronous cross-boundary `await`. See `performance.md` for override safety.

## Common mistakes (from the build-pipeline source code)

1. **Returning a `unique_ptr` from a bindable function** → binding silently fails or returns null. Use `shared_ptr`.
2. **Defining the class in the `.cpp` only** (forward-declared in `.h`, full definition hidden) → binder needs the full definition in the header it scans.
3. **Anonymous namespaces wrapping the public API** → not exposed. Public API stays in named or no namespace.
4. **`extern "C"` decoration on C++ class methods** → invalid. Only use `extern "C"` for C-style free functions.
5. **Returning a reference or pointer to a stack object** → undefined behavior; binder doesn't catch it. Always return by value or by `shared_ptr`.

## When the rules don't fit

Three escape hatches, in order of preference:

1. **Wrap it in C++** (above) — most maintainable.
2. **Write a `.i` file** for SWIG (`swig-escape.md`) — fine for selective custom types.
3. **Open an issue** — if a common pattern keeps falling outside the auto-binder, the binder itself can be extended.

## See also

- [`swig-escape.md`](./swig-escape.md) — when and how to write a manual SWIG `.i` file.
- [`lifecycle-and-types.md`](./lifecycle-and-types.md) — why JS-side `m.delete()` isn't a thing in crossbind.
- [`crossbind-config.md`](./crossbind-config.md) — `targetSpecs[]` for emccFlags overrides like `-sJSPI`.
- Website: [Type table](https://crossbind.dev/docs/api/cpp-bindings/data-types), [Classes & functions](https://crossbind.dev/docs/api/cpp-bindings/overview).
