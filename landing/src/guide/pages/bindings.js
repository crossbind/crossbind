import { REPO_URL } from '../../data.js';

export default {
    slug: 'bindings',
    title: 'C++',
    description: 'The subset of C++ that binds automatically, the type table, and how to wrap the rest.',
    lede: 'There are no binding macros to write: the generator reads your header and writes the bridge. It handles a subset of C++. Inside it everything binds; outside it, wrap the API in something that does.',
    blocks: [
        { type: 'h2', id: 'rules', text: 'The rules' },
        { type: 'h3', text: 'The public surface belongs in the header' },
        {
            type: 'p',
            text: 'The binder reads only headers: a class defined only in the `.cpp`, an anonymous namespace around the API or a file-scope `static` function is invisible to it. Public members bind; private ones do not.',
        },
        { type: 'h3', text: 'A class binds with its first base' },
        {
            type: 'p',
            text: 'Single-base inheritance works, `virtual` methods included. A class with several bases still binds, but with its first base only: the members of the others are missing in JavaScript, and the object is not accepted where another base is expected. For such a member, give the class a method of its own that calls it, or use composition.',
        },
        { type: 'h3', text: 'Templates bind through a plain class or function' },
        {
            type: 'p',
            text: 'A template does not bind, and an explicit instantiation or an alias does not change that. Put a plain class or function over the instantiation you want in JavaScript:',
        },
        {
            type: 'code',
            file: 'C++',
            code: `template<typename T> class Buffer { /* ... */ };

class IntBuffer {
public:
    void push(int value) { buffer.push(value); }
    int at(int index) const { return buffer.at(index); }
private:
    Buffer<int> buffer;
};`,
        },
        {
            type: 'p',
            text: 'To bind `Buffer<int>` itself under a name, register it by hand: [the escape hatch](#escape).',
        },
        { type: 'h3', text: 'Overloads differ by argument count' },
        {
            type: 'p',
            text: 'A call reaches the overload that takes as many arguments as it passes. Of two overloads with the same count the first one declared binds, and the build prints `embind cannot bind another overload of …, ignored.` for the other: give it another name.',
        },
        { type: 'h3', text: 'Fields are properties' },
        {
            type: 'p',
            text: 'Public fields of numbers, `bool` and `std::string`, in a class or a C struct, read and write as properties. Fields of vector, `shared_ptr` or class type need accessor methods, and arrays are not bound.',
        },
        {
            type: 'callout',
            tone: 'warn',
            title: 'unique_ptr parameters',
            text: 'A function may return a `std::unique_ptr`: JavaScript gets the object and owns it. A function, method or constructor that takes one is left out, and the build prints a line for it: the call would destroy the object the JavaScript handle still holds. Take a reference, or a `std::shared_ptr` when C++ keeps the object.',
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
                ['`std::optional<T>`', 'the value; when empty, `undefined` on wasm and `null` on React Native and in a Node-API addon', 'C++17; read it with `??`. `T` is a type a [vector](#containers) holds'],
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
            text: 'Vectors bind under generated names: `VectorChar`, `VectorUChar`, `VectorShort`, `VectorInt`, `VectorInt64`, `VectorFloat`, `VectorDouble` and `VectorString`. A vector of objects is a `std::vector<std::shared_ptr<MyClass>>`, which becomes `VectorMyClass`; a vector of a class by value does not bind.',
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
            text: 'To work with plain arrays, convert with two module helpers:',
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
            text: 'Maps bind the same way (`MapIntInt`, `MapStringString`, `MapStringInt`, `MapIntString`). Enums, `enum` and `enum class` alike, arrive as objects keyed by their member names.',
        },
        {
            type: 'p',
            text: 'A function over another type (`std::pair`, `std::tuple`, `std::array`, `std::set`, `std::unordered_map`, `std::variant`, a vector of `bool` or of vectors) still binds, and throws when called: `Cannot call … due to unbound types`. Return a struct or one of the containers above, or register the type [by hand](#escape).',
        },
        {
            type: 'callout',
            tone: 'note',
            title: 'Worker mode returns arrays',
            text: 'In worker mode a returned `std::vector` arrives as a plain array instead of a vector. `m.toArray()` takes both, so code that uses it works either way.',
        },

        { type: 'h2', id: 'pointers', text: 'Pointers' },
        {
            type: 'p',
            text: 'Raw pointers bind. What cannot become an object crosses as a handle: an opaque `NativePointer` that holds the address and owns what crossbind allocated for it.',
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
            text: 'Every module that binds a pointer also exports helpers to make and read handles: `cstring` and `readCString`, `allocBuffer` and `allocPointer` (zero-filled), `allocString` and `readString`, `readNumberAt` and `writeNumberAt`, `readPointerAt` and `writePointerAt`, `readBuffer` (a `Uint8Array` copy) and `writeBuffer`, and `releaseCallback`.',
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
            text: 'Only `const char *` converts to a string. A `char *` result is memory the library hands over: it stays a handle you read and then free the library\'s way. A string passed for a `const char *` lives only for the call; if C keeps the pointer, pass a `cstring` handle and keep it until C is done.',
        },
        {
            type: 'p',
            text: 'A JavaScript function passed for a function pointer holds a slot in the module until `releaseCallback(fn)` frees it. With `useWorker: true`, handles are proxies and JavaScript functions cannot cross into the worker.',
        },

        { type: 'h2', id: 'constants', text: 'Constants and macros' },
        {
            type: 'p',
            text: 'A `#define` with a number, character, string or boolean value, and a `const` or `constexpr` global of those types, bind as module constants. Only the names you import bind, so thousands of macros cost nothing until you use one:',
        },
        {
            type: 'code',
            file: 'src/main.js',
            code: "import { deflateInit2_, Z_DEFLATED, MAX_WBITS, ZLIB_VERSION } from '@crossbind/port-zlib/zlib.h';",
        },
        {
            type: 'p',
            text: `A function-like macro that calls one bound function, a macro that renames one, a variadic function and a mutable global bind as well, but only when you name them in an \`import { ... }\`; \`import * as\` reaches none of them. Details: [cpp-binding-rules.md](${REPO_URL}/blob/main/docs/api/cpp-binding-rules.md).`,
        },

        { type: 'h2', id: 'imports', text: 'What a library header binds' },
        {
            type: 'p',
            text: "Your own headers bind every function and class. A dependency's header (a [port](/guide/libraries/) or a [ConanCenter](/guide/conan/) package) binds its enums, the functions you import and the classes they reach, with their bases. What nothing you import reaches is left out, and so is the library code only it uses.",
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
            text: 'Report a failure by throwing in C++ and catching in JavaScript, rather than with status codes or out-parameters.',
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
            text: 'A handle frees only what crossbind allocated for it. When objects are freed, and when to call `.delete()`: [Object lifetime](/guide/runtime-api/#lifecycle).',
        },

        { type: 'h2', id: 'wrapper', text: 'Wrapping what does not fit' },
        {
            type: 'p',
            text: 'For a library full of templates, multiple inheritance or pointer-heavy calls, put a clean class in front of it. The wrapper binds; the upstream type stays inside it.',
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
            text: 'An app keeps its wrappers in `src/native`. A published package carries its own, so everyone who installs it gets them.',
        },

        { type: 'h2', id: 'typescript', text: 'TypeScript' },
        {
            type: 'p',
            text: "Types for every header and Rust import are generated under `.crossbind/`. Setting them up, and `dts: 'promise'` for worker mode: [Runtime API](/guide/runtime-api/#types).",
        },

        { type: 'h2', id: 'escape', text: 'The escape hatch' },
        {
            type: 'p',
            text: 'When neither the rules nor a wrapper fit, hand-write a SWIG interface file next to the header and import it from JavaScript. It is also how you bind a template instantiation under a name, or register a container the generator does not cover:',
        },
        {
            type: 'code',
            file: 'src/native/boxes.i',
            code: `#pragma once

%module boxes

%{
#include <map>
#include <string>
#include "box.h"

EMSCRIPTEN_BINDINGS(boxes) {
    emscripten::class_<Box<int>>("BoxInt")
        .constructor<>()
        .function("set", &Box<int>::set)
        .function("get", &Box<int>::get);
    emscripten::register_map<std::string, double>("MapStringDouble");
}
%}

%feature("shared_ptr");
%feature("polymorphic_shared_ptr");`,
        },
        { type: 'code', file: 'src/index.js', code: "import './native/boxes.i';" },
        {
            type: 'p',
            text: 'The module `initNative()` resolves to then has `BoxInt` and `MapStringDouble`, and a function that takes or returns a `Box<int>` can be called.',
        },
    ],
};
