import { REPO_URL } from '../../data.js';

export default {
    slug: 'bindings',
    title: 'C++',
    description: 'The subset of C++ that binds automatically, the type table, and how to wrap the rest.',
    lede: 'There are no binding macros to write: the generator reads your header and produces the bridge. In exchange it handles a constrained subset of C++. Stay inside it and everything binds for free; step outside and you wrap the offending API in something that does.',
    blocks: [
        { type: 'h2', id: 'rules', text: 'The rules' },
        { type: 'h3', text: 'The public surface belongs in the header' },
        {
            type: 'p',
            text: 'The binder reads headers. A class declared in the `.h` but defined only in the `.cpp`, an anonymous namespace around the API, or a file-scope `static` function is invisible to it. Public members bind; private ones stay internal, which is fine.',
        },
        { type: 'h3', text: 'Single inheritance only' },
        {
            type: 'p',
            text: 'Single-base `virtual` polymorphism is supported. Multiple inheritance - diamonds especially - breaks the auto-binder; refactor to composition or wrap it.',
        },
        { type: 'h3', text: 'Templates need explicit instantiation' },
        {
            type: 'code',
            file: 'C++',
            code: `template<typename T> class Buffer { /* ... */ };

// name the instantiations you want in JavaScript
template class Buffer<int>;
template class Buffer<float>;`,
        },
        { type: 'h3', text: 'Fields are properties' },
        {
            type: 'p',
            text: 'Public fields of numbers, `bool` and `std::string`, in a class or a C struct, read and write as properties. Fields of vector, `shared_ptr` or class type need accessor methods, and arrays are not bound.',
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'Returning unique_ptr',
            text: 'A `std::unique_ptr` returned across the boundary fails silently - the call comes back `null` or `undefined`. Use `std::shared_ptr` for anything JavaScript will own a handle to.',
        },

        { type: 'h2', id: 'types', text: 'Primitive types' },
        {
            type: 'table',
            head: ['C++', 'JavaScript', 'Note'],
            rows: [
                ['`void`', '`undefined`', ''],
                ['`bool`', '`true` / `false`', ''],
                ['`char`, `short`, `int` and unsigned forms', '`Number`', 'a `char` parameter also takes a one-character string'],
                ['`float`, `double`', '`Number`', ''],
                ['`int64_t`, `uint64_t`, `long long`', '`BigInt`', 'takes a `BigInt` or a safe-integer `Number`'],
                ['`long`, `size_t`', '`Number` on wasm32, `BigInt` on React Native', ''],
                ['`std::string`', '`String`', ''],
                ['`const char *`', '`String`', 'see [pointers](#pointers)'],
                ['`std::optional<T>`', 'the value or `null`', 'C++17, supported on every runtime'],
                ['`emscripten::val`', 'anything', 'the untyped escape hatch'],
            ],
        },
        {
            type: 'p',
            text: 'An argument of the wrong type throws a `TypeError` instead of crossing as 0. An enum parameter takes a member of the enum or its number.',
        },

        { type: 'h2', id: 'containers', text: 'Vectors, maps and enums' },
        {
            type: 'p',
            text: 'Vectors of the primitive types are bound under generated names - `VectorInt`, `VectorDouble`, `VectorString`, `VectorInt64` and friends. A vector of your own class follows the same rule: `std::vector<MyClass>` becomes `VectorMyClass`.',
        },
        {
            type: 'code',
            file: 'JavaScript',
            code: `const myVector = getMyVector();

for (let i = 0; i < myVector.size(); i += 1) {
    console.log(myVector.get(i));
}

const next = new VectorInt();
next.push_back(9);
setMyVector(next);`,
        },
        {
            type: 'p',
            text: 'Two module helpers convert between the two worlds when you would rather work with plain arrays:',
        },
        {
            type: 'code',
            file: 'JavaScript',
            code: `const values = m.toArray(getMyVector());    // vector -> Array
values.push(9);
setMyVector(m.toVector(VectorInt, values)); // Array -> vector`,
        },
        {
            type: 'p',
            text: 'Maps bind the same way (`MapIntInt`, `MapStringString`, `MapStringInt`, `MapIntString`), enums arrive as objects with the enumerator names as keys, and both `enum` and `enum class` are supported.',
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'Worker runtimes differ slightly',
            text: 'On direct runtimes a `std::vector` return is a real vector proxy; through a worker bridge it arrives as a plain JavaScript array. `m.toArray()` accepts both shapes, so code written against it works either way.',
        },

        { type: 'h2', id: 'pointers', text: 'Pointers' },
        {
            type: 'p',
            text: 'Raw pointers bind. What the generator cannot turn into an object crosses as a handle: an opaque `NativePointer` that carries the address and owns whatever crossbind allocated for it.',
        },
        {
            type: 'table',
            head: ['C++', 'JavaScript'],
            rows: [
                ['`const char *` parameter', 'a string, a handle or `null`'],
                ['`const char *` return', 'a string or `null`'],
                ['`char *`, `void *`, `T **`, pointers to numbers', 'a handle'],
                ['`T *` to a class or struct the header binds', 'an instance'],
                ['`T *` to a type the header only declares (`sqlite3`, `PJ`)', 'a handle'],
                ['`int &`, `double &`, `std::string &` out-parameters', 'a handle from `allocPointer` or `allocString`, read back afterwards'],
                ['function pointer', 'a JavaScript function, a handle or `null`'],
            ],
        },
        {
            type: 'p',
            text: 'Every module that binds a pointer also exports the helpers that make and read handles: `cstring` and `readCString`, `allocBuffer` and `allocPointer` (zero-filled), `allocString` and `readString`, `readNumberAt` and `writeNumberAt`, `readPointerAt` and `writePointerAt`, `readBuffer` (a `Uint8Array` copy) and `writeBuffer`, and `releaseCallback`.',
        },
        {
            type: 'code',
            file: 'C++',
            code: `void process(int* data, size_t len);
char* getName();
size_t encode(unsigned char* out, size_t cap);`,
        },
        {
            type: 'code',
            file: 'JavaScript',
            code: `const data = allocBuffer(3 * 4);
[7, 8, 9].forEach((n, i) => writeNumberAt(data, i, 'int32', n));
process(data, 3);

const name = readCString(getName());

const out = allocBuffer(1024);
const bytes = readBuffer(out, encode(out, 1024));`,
        },
        {
            type: 'p',
            text: 'Only `const char *` converts. A `char *` result is memory the library handed over, so it stays a handle you read and then free the library\'s way. A string passed for a `const char *` lives for the call; when C keeps the pointer, pass a `cstring` handle and keep it until C is done.',
        },
        {
            type: 'p',
            text: 'A JavaScript function passed for a function pointer holds a slot in the module until `releaseCallback(fn)` frees it. With `useWorker: true`, handles are proxies and JavaScript functions cannot cross into the worker.',
        },

        { type: 'h2', id: 'constants', text: 'Constants and macros' },
        {
            type: 'p',
            text: 'A `#define` with a number, character, string or boolean value, and a `const` or `constexpr` global of those types, bind as module constants. Only the names you import bind, so a header with thousands of macros costs nothing until one is used:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: "import { deflateInit2_, Z_DEFLATED, MAX_WBITS, ZLIB_VERSION } from '@crossbind/port-zlib/zlib.h';",
        },
        {
            type: 'p',
            text: `A function-like macro that calls one bound function, a macro that renames one, a variadic function and a mutable global bind as well, but only when you name them in an \`import { ... }\`; \`import * as\` reaches none of them. [cpp-binding-rules.md](${REPO_URL}/blob/main/docs/api/cpp-binding-rules.md) has the details.`,
        },

        { type: 'h2', id: 'imports', text: 'What a library header binds' },
        {
            type: 'p',
            text: 'Your own headers bind every function and class. A header from a dependency - a [port](/guide/libraries/) or a [ConanCenter](/guide/conan/) package - binds its enums, the free functions you import from it and the classes those reach, with their bases and the classes their methods use; a function or class nothing you import reaches is left out, and so is the library code only it reaches.',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: "import { GDALAllRegister, GDALOpenEx, GDALClose } from '@crossbind/port-gdal/gdal.h';",
        },
        {
            type: 'p',
            text: '`import * as`, `import()`, `require`, a bare `import \'x.h\'` and an import of `initNative` alone bind the whole header. Otherwise a function you call through the module object (`m.GDALVersionInfo()`) still needs a named import; without one the call fails with `m.GDALVersionInfo is not a function`. Dev servers bind a newly imported function when you save the file.',
        },

        { type: 'h2', id: 'exceptions', text: 'Exceptions' },
        {
            type: 'p',
            text: 'Throw from C++ and catch in JavaScript - that is the binding-friendly way to report failure, rather than status codes or out-parameters.',
        },
        {
            type: 'code',
            file: 'C++',
            code: `double squareRoot(double x) {
    if (x < 0) throw std::invalid_argument("sqrt of negative");
    return std::sqrt(x);
}`,
        },
        {
            type: 'code',
            file: 'JavaScript',
            code: `try {
    m.squareRoot(-1);
} catch (e) {
    console.error(e.message);   // "std::invalid_argument: sqrt of negative"
}`,
        },
        {
            type: 'p',
            text: 'On wasm the message is `"<type>: <what()>"`, with the halves also available as `e.cppType` and `e.cppMessage`. On React Native (JSI) and in a Node-API addon it is the plain `what()` text.',
        },

        { type: 'h2', id: 'memory', text: 'Memory' },
        {
            type: 'p',
            text: 'An instance made with `new`, a struct or vector a call returns and a vector `toVector` builds are freed when the garbage collector reclaims their handle, and `.delete()` frees one at once: call it on an object that holds a lot of memory, and on objects made in a loop. On React Native before 0.88, whose Hermes has no `FinalizationRegistry`, `.delete()` is the only way. A handle frees what crossbind allocated for it. An object a function returns through a raw pointer, and memory a library returns through one, stay the library\'s: free them with the library\'s own function.',
        },

        { type: 'h2', id: 'wrapper', text: 'Wrapping what does not fit' },
        {
            type: 'p',
            text: 'A library full of templates, multiple inheritance or pointer-heavy calls you would rather not drive through handles? Put a clean class in front of it. The wrapper is what binds; the upstream type stays internal.',
        },
        {
            type: 'code',
            file: 'src/native/wrapper.h',
            code: `#pragma once
#include "upstream/upstream.h"
#include <memory>
#include <vector>

class CleanWrapper {
public:
    CleanWrapper();
    std::vector<float> process(const std::vector<float>& input);
private:
    std::shared_ptr<upstream::RawType> raw_;
};`,
        },
        {
            type: 'p',
            text: 'App-side wrappers live in your own `src/native`; if you are publishing a package, put the wrapper inside the package so every consumer benefits.',
        },

        { type: 'h2', id: 'typescript', text: 'TypeScript' },
        {
            type: 'p',
            text: 'Declarations are generated for every header and Rust import, outside your source tree under `.crossbind/`. Add the shared config as a dev dependency and extend it once:',
        },
        {
            type: 'code',
            file: 'tsconfig.json',
            code: '{ "extends": "@crossbind/typescript-config" }',
        },
        {
            type: 'p',
            text: 'Running with `initNative({ useWorker: true })`? Set `dts: \'promise\'` in `crossbind.config.js` so every generated signature returns `Promise<...>`, matching the async runtime - and write `await new X(...)` for construction.',
        },

        { type: 'h2', id: 'escape', text: 'The escape hatch' },
        {
            type: 'p',
            text: 'When neither the rules nor a wrapper fit, hand-write a SWIG interface file next to the header and import it from JavaScript. It is also how you register a container the generator does not cover:',
        },
        {
            type: 'code',
            file: 'src/native/mycustom.i',
            code: `#pragma once

%module mycustom

%{
EMSCRIPTEN_BINDINGS(mycustom) {
    emscripten::register_vector<Abc>("VectorAbc");
}
%}

%feature("shared_ptr");
%feature("polymorphic_shared_ptr");`,
        },
        { type: 'code', file: 'src/index.js', code: "import './native/mycustom.i';" },
    ],
};
