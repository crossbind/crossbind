# C++ Binding Rules — write C++ that crossbind can auto-bind

> crossbind generates the JavaScript bindings: there are no `EMSCRIPTEN_BINDINGS` macros to write. The generator handles a subset of C++. Inside it everything binds; outside it, write a wrapper or a SWIG interface ([`swig-escape.md`](./swig-escape.md)).

This page holds the **rules** for C++ that crossbind binds. The type table, with `toArray` and `toVector` examples, is in the guide: `https://crossbind.dev/guide/bindings/#types`.

## The hard rules

### 1. Pointers cross as handles, `const char *` as strings

Raw pointers bind. What the generator cannot turn into an object crosses as a `NativePointer` handle: an opaque JS object that carries the address and owns whatever crossbind allocated for it.

- `const char *` parameter: a `string`, a handle or `null`.
- `const char *` return, or callback argument without a following integer: a `string` or `null`.
- `const char *` callback argument immediately followed by an integer: a handle or `null`; read it with `readBuffer(pointer, length)`.
- `char *`, `unsigned char *`, `void *`, `T **`, and pointers to numbers, enums or types the bridge does not know: a handle.
- `T *` returning a class the bridge knows: an instance.
- `T *` parameter of a struct the imported header defines, `extern "C"` or not: an instance.
- `T *` parameter of a struct the bridge only sees declared (`sqlite3`, `PJ`): a handle.
- `T *` field of a struct: reads as an instance when `T` is a struct the same header binds, otherwise as a handle; takes either, or `null`.
- `int &`, `double &`, `std::string &` out-parameters: a handle from `allocPointer` or `allocString`, read back afterwards.
- Function pointer parameter or field: a JavaScript function, a handle another binding returned, or `null`; a field reads as a handle.
- Any other pointer argument inside a callback: always a handle.

Every module that binds a pointer also exports these helpers:

- `cstring(text)` and `readCString(handle)`;
- `allocBuffer(bytes)` and `allocPointer(count)`, both zero-filled;
- `allocString(text)` and `readString(handle)`;
- `readNumberAt(handle, index, kind)` and `writeNumberAt(handle, index, kind, value)`, with kinds `int8` … `uint64`, `float32` and `float64`;
- `readPointerAt` and `writePointerAt`;
- `readBytes(handle, length)` and `writeBytes(handle, u16string)`, one byte per character;
- `readBuffer(handle, length)`, which returns a `Uint8Array` copy, and `writeBuffer(handle, bytes)`, which copies any `ArrayBuffer` or view of one (a `Uint8Array`, a Node `Buffer`);
- `releaseCallback(fn)`, which frees a callback slot.

```cpp
void process(int* data, size_t len);            // handle in, e.g. from allocBuffer
char* getName();                                // handle out: read it, then free it the library's way
int parse(const char* text);                    // takes a JS string
size_t encode(unsigned char* out, size_t cap);  // bytes out through a buffer
```

```js
const data = allocBuffer(3 * 4);
[7, 8, 9].forEach((n, i) => writeNumberAt(data, i, 'int32', n));
process(data, 3);
const name = readCString(getName());
parse('x=1');
const out = allocBuffer(1024);
const bytes = readBuffer(out, encode(out, 1024)); // Uint8Array
```

Only the const form converts: C APIs copy a `const char *` input, while a `char *` result is memory the library handed over, so it stays a handle you read and free explicitly. On worker-backed browser builds handles and instances are proxies, `instanceof NativePointer` holds only on direct runtimes, and JS functions cannot cross into a worker.

A string passed for a `const char *` is a copy that lives for the call. When C keeps the pointer afterwards (`sqlite3_bind_text` with `SQLITE_STATIC`), pass a `cstring` handle and keep it until C is done with it, or let C take its own copy (`SQLITE_TRANSIENT`).

A callback's `const char *` followed by an integer may describe bytes with embedded NULs or no terminator. It stays a handle, so Expat's character-data handler can read exactly `readBuffer(text, length)`. If that integer is a status rather than a length and the library guarantees a terminated string, use `readCString(text)`. Read the data while the callback runs; the handle does not keep the library's buffer alive.

Integer and enum parameters take numbers. An enum parameter also takes a member (`await Mode.Fast`), an integer parameter takes an enum member as its value, and a `char` parameter takes a one-character string as its code; anything else throws a `TypeError` instead of crossing as 0. A 64-bit integer (`int64_t`, `long long`, and on React Native also `long` and `size_t`) crosses as a BigInt and takes a BigInt or a safe-integer Number; on wasm32 `long` and `size_t` are 32-bit Numbers.

### 2. C++11 minimum, C++17 recommended

Build defaults assume modern C++. Use:

- `std::string`
- `std::vector` of `char`, `unsigned char`, `short`, `int`, `int64_t`, `float`, `double` or `std::string`, and of `std::shared_ptr<T>` for a class the header binds
- `std::map` from `int` or `std::string` to `int` or `std::string`
- `std::shared_ptr<T>` for heap-allocated objects you return to JS
- `std::optional<T>` (C++17) of a type the vector line names
- Range-based for, `auto`, lambdas, `nullptr`

A vector parameter takes a vector instance, which `Module.toVector` builds. A wasm build also
takes a plain array: for every vector parameter in worker mode, and for a module function's or
constructor's in direct mode. A `std::vector` returned by value is a vector on direct runtimes
(wasm and JSI), freed like any value JavaScript owns (`lifecycle-and-types.md`), and a plain array
on worker runtimes; `Module.toArray` takes both.

An empty `std::optional` arrives as `undefined` on wasm and as `null` on React Native and in a
Node-API addon: test it with `== null` or `??`. For an empty optional parameter pass `undefined`,
which every runtime takes; wasm refuses `null` for an optional number.

A function whose signature names another type still binds, and throws when it is called:
`Cannot call minMax due to unbound types`. That goes for `std::pair`, `std::tuple`, `std::array`,
`std::set`, `std::unordered_map` and `std::variant`, and for a vector, map or optional the list
above leaves out, such as a vector of `bool`, of vectors, or of a class by value. Return a struct
or a listed container, or register the type by hand
([`swig-escape.md`](./swig-escape.md#registering-a-type-by-hand)).

Avoid:

- A `std::unique_ptr` parameter. C++ frees the object when the call ends while the JavaScript handle still claims it, so freeing that handle afterwards, with `.delete()` or by the garbage collector, destroys the object a second time: a Node-API addon and a debug wasm build abort there, and a release wasm build runs the destructor again and goes on. Take a reference, or a `std::shared_ptr` when C++ keeps the object. Returning a `std::unique_ptr` is fine: JavaScript gets the instance and owns it.
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

Private members simply do not appear in JavaScript.

> Public value fields (numbers, `bool`, `std::string`) bind on every runtime as properties, so
> `m.rows` reads and writes from JavaScript on Node.js, in the browser (in worker mode through
> the proxy: `await b.rows`) and on React Native. Fields of vector, `shared_ptr` or class type
> need accessor methods.
>
> The same goes for C structs, `typedef struct { ... } Name;` and
> `typedef struct tag { ... } alias;` included: fields of arithmetic types, directly or
> through a typedef such as `uInt` or `size_t`, are properties, read as the build's
> preprocessor sees them. An enum field reads and writes its underlying integer and also
> takes a member of the enum. A pointer field, `T *` or a pointer typedef such as `voidpf`,
> reads as an instance when it points to a struct the same header binds (`cinfo.comp_info`,
> `marker.next`) and as a handle otherwise (a pointer typedef declared in another header
> reads as a handle), read-only for a pointer to const. The instance
> owns nothing: deleting it leaves the library's memory alone. The field takes a handle,
> `null` or such an instance, so `stream.next_in = input` points zlib at an `allocBuffer`
> block; C keeps only the address, so keep that handle while the library uses it. On worker
> runtimes a field write reaches the worker ahead of the calls made after it. A function-pointer
> field, directly declared or through a typedef, reads as a handle and takes a C function handle,
> a JavaScript function on direct runtimes, or `null`. Clear a retained JavaScript callback from
> the field before calling `releaseCallback(fn)`. Arrays and struct fields are not bound.

### 4. A class binds with its first base

Single-base inheritance binds, `virtual` methods and a `virtual` base included.

Of several bases only the first is bound. The class still binds and the build says nothing, but the members of its other bases are missing in JavaScript (`both.size is not a function`), `instanceof` holds for the first base only, and passing the object where another base is expected throws. A diamond binds the same way, along its first base. For a member of another base, give the class a method of its own that calls it, or use composition.

### 5. Templates bind through a plain class or function

A class or function template does not bind, and naming an instantiation does not change that: an explicit instantiation (`template class Buffer<int>;`) and an alias (`using IntBuffer = Buffer<int>;`) bind nothing, and a class derived from `Buffer<int>` binds with its own members only. The build says nothing. A function that takes or returns a `Buffer<int>` binds, and throws when it is called: `Cannot call makeBuffer due to unbound types`.

Put a plain class or function over the instantiation:

```cpp
// ❌ Won't bind — templates
template<typename T> class Buffer { ... };
template<typename T> T larger(T a, T b) { return a > b ? a : b; }

// ✅ Bind — a plain class and a plain function over them
class IntBuffer {
  public:
    void push(int value) { buffer.push(value); }
    int at(int index) const { return buffer.at(index); }
  private:
    Buffer<int> buffer;
};
int largerInt(int a, int b);
```

To bind `Buffer<int>` itself under a name, register it by hand: [`swig-escape.md`](./swig-escape.md#registering-a-type-by-hand).

### 6. The garbage collector frees what JS owns; `.delete()` frees it now

An instance made with `new`, a value a call returns and a vector `toVector` builds are freed when the garbage collector reclaims their handle, on every runtime with `FinalizationRegistry`; `.delete()` frees one at once, and is the only way on React Native before 0.88, whose Hermes has none. A handle releases what crossbind allocated for it (`allocBuffer`, `allocPointer`, `allocString`, `cstring`) when it goes away. An object reached through a raw pointer, and memory a library returns through one, stay the library's: free it through the library's own function. A pointer a method or a field hands out keeps the object it came from alive while its handle lives. See `lifecycle-and-types.md`.

### 7. Exceptions: thrown C++ exceptions become JS exceptions

`throw std::runtime_error("...")` in C++ arrives as a thrown JavaScript `Error` with the message. Report failures this way rather than with out-parameters or status codes.

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

> The exception arrives as a JavaScript `Error` with its text on every runtime. On wasm,
> `.message` is `"<type>: <what()>"` (e.g. `std::invalid_argument: sqrt of negative`), with the
> parts also in `e.cppType` and `e.cppMessage`. On React Native (JSI) and in a Node-API addon,
> `.message` is the plain `what()` text.

### 8. Constants bind when the app imports them

A `#define` whose value is a number, a character, a string or a boolean, and a `const` or `constexpr` global of those types, bind as module constants. Only the names the app imports from the header bind, so a header with thousands of macros costs nothing until one is used:

```js
import { deflateInit2_, Z_DEFLATED, MAX_WBITS, ZLIB_VERSION } from '@crossbind/port-zlib/zlib.h';
```

- Numbers of every width arrive as Numbers, exact up to 2^53; a `char` arrives as its code (`'A'` is 65), a string as a string, `true` and `false` as booleans.
- In a worker, the browser default, a constant arrives like every name of the module: read it with `await` (`const ok = await Z_OK`). Unread, it is a proxy, so `code === Z_OK` is false and `A | B` is 0.
- A macro the header takes from another header imports through it, as in C: zlib's `MAX_WBITS` comes from `zconf.h`.
- A value with a cast, as in Expat's `#define XML_TRUE ((XML_Bool)1)` or curl's `(((unsigned long)1) << 4)`, binds when the app imports it by name and every cast is to a number type: a built-in one, a standard typedef such as `size_t`, or a typedef of one that the header declares. SWIG itself drops such a `#define`, so `import * as` does not bind it.
- Each platform's compiler reads the macro itself, so a value inside `#if` follows the target.
- `import * as zlib from '@crossbind/port-zlib/zlib.h'` binds every constant SWIG sees in the header, as do `import()`, `import 'x.h'` and `require`, which hand the app the whole module too.
- Macros whose value is a pointer and arrays other than a single string stay unbound: Vite and Rollup reject the import as a missing export, and elsewhere the name is `undefined`. Function-like macros and globals that are not `const` bind as rule 10 describes.
- `crossbind build` output for a plain browser page or an edge runtime binds no constant: those apps import no header. A Node.js app imports headers through the hooks the build writes, so its constants bind as in a bundler app ([Node.js](../playbooks/integration/nodejs.md#importing-headers-and-rust-directly)).
- A constant first imported while a dev server runs binds the way rule 9 describes for a function.

### 9. A dependency's functions and classes bind when the app imports them

A header of a dependency (a port or a `conan:` package) binds the free functions the app imports from it and the classes those names reach, along with all its enums and the constants rule 8 binds. A class is reached when the app imports it by name, when a function bound for the app takes or returns it, or when a class already reached uses it: as a base, or in the signature of a public member, in this header or another. A function or class no import reaches is left out, and so is the library code only it reaches:

```js
import { GDALAllRegister, GDALOpenEx, GDALClose } from '@crossbind/port-gdal/gdal.h';
```

- The project's own headers bind every function and class, as do the headers a package binds whole (`export.bindings.headers`).
- `import * as`, `export *`, `import()`, `import 'x.h'`, `require` and an import of `AllSymbols` hand the app the whole module, so the header binds every function and class. So does a header whose only imports take `initNative` alone. Its constants still follow rule 8.
- A function or class the app reaches only through the module object (`const m = await initNative(); m.GDALVersionInfo()`) needs a named import too. Without one the call fails with `crossbind: GDALVersionInfo is not bound in the native module` in a worker, and with `m.GDALVersionInfo is not a function` on the page thread.
- A header bound only for the types another one uses (`cpl_error.h` for the `CPLErr` of `gdal.h`) registers the classes the app's imports reach in it and all its enums, but none of its functions. Importing a function of GDAL's C++ header `ogrsf_frmts.h` (`RegisterOGRGeoJSON`) binds that function alone, none of the header's classes.
- An object whose own class no import reaches comes to JavaScript as the reached class it derives from, with that class's members; importing its own class by name gives it its own.
- A function declared through a function typedef (OpenSSL's `OSSL_provider_init_fn OSSL_provider_init;`) binds only when imported too, like any free function.
- A Vite or webpack/Rspack dev server binds a newly imported function when the file is saved, and Rollup's watch mode on its next rebuild. Metro binds it when the file is saved too, but the running app gets it only from its next native build (React Native) or a page reload (Expo web), with Metro left running; until then a call fails with `crossbind: compressBound is not bound in the native module`.
- A Node.js app binds it on its next `crossbind build`, which `node --import crossbind/node/dev` runs before the app starts once its imports changed; until then Node stops at the import with `does not provide an export named 'compressBound'`.
- The scan reads JavaScript, TypeScript, Vue, Svelte, HTML scripts, Astro and MDX sources, including nested source folders named `build`, `ios` or `android`. It also follows imports and re-exports through the app's declared dependencies, including their import and browser entry points; it does not scan unrelated installed packages. Root build outputs stay excluded.
- The build warns when a header has no name requested by those sources. An import constructed dynamically from variables cannot be discovered by the scan; import its required functions explicitly or bind the header whole.

### 10. Macros, variadic functions and mutable globals bind when the app imports them by name

SWIG binds none of these; crossbind binds the ones the app names in an `import { … }` from the header, also when another import takes the header whole. `import * as` reaches none of them.

```js
import { deflateInit2, iconv_open, _libiconv_version, TIFFSetField, vaDouble } from '...';
```

- A function-like macro that calls one function the header binds, passing each of its parameters whole (in parentheses or through a cast too), binds as a function taking that function's parameter types at those places: `deflateInit2(strm, level, method, windowBits, memLevel, strategy)` takes what `deflateInit2_` takes for them, and `deflateInit2_` binds too. A macro whose body is any other expression, or that calls a builtin, a type, another function-like macro or an overloaded function, stays unbound, and the build prints a line for it.
- A macro naming a function the header binds (`#define iconv_open libiconv_open`) binds that function under the macro's name.
- A variadic function takes its fixed parameters as declared and each extra argument by its JavaScript type, up to six of them. A function taking a `va_list` stays unbound.

  | Extra argument | Passed as |
  |---|---|
  | an integer Number, a boolean or an enum member | `long` |
  | a fractional Number, or `vaDouble(x)` | `double` |
  | a BigInt | `long long` |
  | a string | `const char *` to a copy that lives for the call |
  | a handle, or `null` | its pointer, or `NULL` |

  `vaDouble`, which the module exports beside the function, marks a double whose value is a whole number: `TIFFSetField(tif, TIFFTAG_XRESOLUTION, vaDouble(72))`. A `float` is read as a `double`, as C promotes it. A `long` is 32 bits on wasm32 and Windows, so a larger integer takes a BigInt, which passes its 64 bits whether the function reads them signed or not. Each variadic function adds about 25 KB to a wasm module.
- A global that is not `const` arrives as a handle to its storage: read and write it with `readNumberAt` and `writeNumberAt`, or `readPointerAt` and `writePointerAt` for a pointer, and keep a handle written into it alive while C uses it.
- The parameters and results of these bindings are numbers, enums, booleans, strings (`const char *`) and pointers; a function taking or returning another type throws when called. An integer out of its parameter's range, a BigInt included, throws instead of wrapping. A string argument is a copy that lives for the call, as in rule 1, so a pointer the function returns into it is not valid afterwards.

### 11. Overloads are told apart by their number of arguments

A call reaches the overload that takes as many arguments as it passes, whatever their types. Of the overloads with the same number of parameters the first one declared binds, and the build prints a line for each of the others:

```text
crossbind: native.h:5: embind cannot bind another overload of describe taking 1 arguments, ignored.
```

```cpp
std::string describe(int value);                           // describe(7)
std::string describe(const std::string &text);             // left out: one parameter, as the first
std::string describe(int value, const std::string &unit);  // describe(7, 'km')
```

That goes for functions, methods, static methods and constructors. A call meant for an overload that was left out reaches the bound one and fails on its argument with a `TypeError`: `describe('seven')` throws `int takes a number, got "seven"` in a release wasm build, and `Cannot convert "seven" to int` in a debug one and in a Node-API addon. Give that overload another name, in the header or in a wrapper.

## Wrapper pattern

If the upstream library you're using has multiple inheritance, templates, pointer-heavy calls you would rather not drive through handles, or other unbindable patterns, you wrap it. Two locations work:

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

The Emscripten `-sJSPI` flag enables JavaScript Promise Integration — letting C++ code call into JS-promising code synchronously (the C++ stack suspends on `await`). The living demos are `e2e/backend-nodejs` and `e2e/backend-nodejs-multithread` (Node), where `CurlProbe.run_JSPI` runs curl transfers against a local server.

You'd opt in via `targetSpecs[].specs.binary.emccFlags` in `crossbind.config.js`:

```js
targetSpecs: [{
    platform: 'wasm',
    specs: { binary: { emccFlags: ['-sJSPI'] } },
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

A module runs its `_JSPI` calls one at a time: a call made while another is pending starts once that one settles. Suspended calls share the module's C stack, so two that resumed out of order would overwrite each other's frames. A `_JSPI` call that a callback of another one starts therefore waits for the outer call to end, and the outer call must not wait for it.

Where JSPI actually works (verified against the playgrounds):

- **Node (st and mt)**: works; Node 26, which crossbind requires, has JSPI on by default and refuses the old `--experimental-wasm-jspi` flag.
- **Browser, st runtime**: Chromium only. Firefox and WebKit ship no `WebAssembly.Suspending`, and a glue linked with `-sJSPI` refuses to boot there even if nothing ever suspends.
- **Browser, mt (pthreads) runtime**: do NOT combine with `-sJSPI`. The pthread mailbox enters wasm outside a promising export, so Chromium throws `SuspendError: trying to suspend without WebAssembly.promising` at boot. The mt web playgrounds deliberately carry no JSPI flag for this reason.

Use cases: callbacks into JS that fetch network data, awaiting JS promises mid-C++. Don't enable it unless you specifically need synchronous cross-boundary `await`. See `performance.md` for override safety.

## Common mistakes (from the build-pipeline source code)

1. **Taking a `std::unique_ptr` parameter** → C++ frees the object while the JavaScript handle still claims it, and freeing the handle afterwards destroys it a second time. Take a reference or a `std::shared_ptr`; returning a `unique_ptr` is fine.
2. **Defining the class in the `.cpp` only** (forward-declared in `.h`, full definition hidden) → binder needs the full definition in the header it scans.
3. **Anonymous namespaces wrapping the public API** → not exposed. Public API stays in named or no namespace.
4. **`extern "C"` decoration on C++ class methods** → invalid. Only use `extern "C"` for C-style free functions.
5. **Returning a reference or pointer to a stack object** → undefined behavior; binder doesn't catch it. Always return by value or by `shared_ptr`.
6. **A static method named `length`, `name` or `prototype`** → a JS class is a function that already owns those names, so the binder skips the method and the build prints `Static method length cannot become a property of a JavaScript class, skipped.` Give it another name in a wrapper (the GEOS example uses `lengthOf`).

## When the rules don't fit

Three escape hatches, in order of preference:

1. **Wrap it in C++** (above) — most maintainable.
2. **Write a `.i` file** for SWIG (`swig-escape.md`) — fine for selective custom types.
3. **Open an issue** — if a common pattern keeps falling outside the auto-binder, the binder itself can be extended.

## See also

- [`swig-escape.md`](./swig-escape.md) — when and how to write a manual SWIG `.i` file.
- [`lifecycle-and-types.md`](./lifecycle-and-types.md) — what the garbage collector frees and when to call `.delete()`.
- [`crossbind-config.md`](./crossbind-config.md) — `targetSpecs[]` for emccFlags overrides like `-sJSPI`.
- Guide: [the type table](https://crossbind.dev/guide/bindings/#types), [classes and functions](https://crossbind.dev/guide/bindings/).
