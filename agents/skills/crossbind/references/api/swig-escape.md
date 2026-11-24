<!-- GENERATED from docs/api/swig-escape.md by scripts/build-agent-skill.mjs. Do not edit. -->

# SWIG escape hatch — manual `.i` files

> crossbind generates a SWIG `.i` interface file for every header. Write one by hand only when the generated one is not enough.

## How auto-generation works

For each header in `paths.header` (defaults to `paths.native`, defaults to `src/native`), crossbind generates an `.i` file with:

```swig
%module FILENAME_UPPER

%feature("shared_ptr")
%feature("polymorphic_shared_ptr")
%include "path/to/header.h"
```

The header is included as it is, `shared_ptr` support is on, and the module is named after the file. That is right for almost every header.

## When you need to write your own

Write your own `.i` only for one of these:

1. **Custom type mappings** (`%typemap` directives) — e.g. converting an exotic upstream type to a JS-friendly one.
2. **Selective symbol export** — your header has 100 symbols and you want to expose 10. Auto-generated `.i` exposes everything.
3. **Renaming** (`%rename`) — your C++ symbol clashes with a JS reserved word, or you want a more idiomatic JS name.
4. **Ignoring members** (`%ignore`) — a declaration the library never defines, or a member you do not want exposed, and you can't refactor the upstream header. For whole names, `export.ignoredDeclarations` in the config does the same without a `.i` file.
5. **Custom directors** for cross-language polymorphism (rare).
6. **A type the generator leaves out** — a template instantiation, or a container outside the type table, registered by hand ([below](#registering-a-type-by-hand)).
7. **A method or a constructor the class does not have** (`%extend`) — written in the `.i` and called from JavaScript as one of the class's own ([below](#adding-a-method-to-a-class)).

For everything else: write a C++ wrapper instead. Wrappers are easier to reason about and won't drift if SWIG semantics change.

## How to wire a manual `.i` into your project

crossbind finds a hand-written `.i` file in one of two ways, in this order:

### Option 1 — sibling next to header

If `src/native/foo.h` has a `src/native/foo.i` beside it, crossbind uses that file instead of generating one.

```
src/native/
├── foo.h         # the header
└── foo.i         # YOUR custom interface — overrides auto-gen
```

### Option 2 — `paths.module` override

If your `.i` files live elsewhere, point `crossbind.config.js` at them:

```js
export default {
    general: { name: 'myapp' },
    paths: {
        config: import.meta.url,
        native: ['src/native'],
        module: ['src/swig'],   // .i files live here
    },
}
```

crossbind reads `paths.module` (defaults to `paths.native`) for `.i` files. The `ext.module` field controls extensions to recognize (defaults to `['i']`).

## Minimal `.i` template

```swig
%module mymodule

%{
#include "myheader.h"
%}

%feature("shared_ptr")
%feature("polymorphic_shared_ptr")

// Optional: rename a method to be JS-idiomatic
%rename(processData) MyClass::process_data;

// Optional: ignore an unbindable method
%ignore MyClass::raw_pointer_method;

// Include the header (so SWIG sees the declarations)
%include "myheader.h"
```

Name the module after the file in upper case (`FILENAME_UPPER`), as generated files do, and save it as `src/native/myheader.i` beside `myheader.h`.

## Registering a type by hand

A `.i` file can carry embind registrations of its own, for a type the generator leaves out: a template instantiation, or a container outside the type table. This one stands beside `box.h`, whose `Box<T>` is a template, as `src/native/boxes.i`:

```swig
#pragma once

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
%feature("polymorphic_shared_ptr");
```

Import it from JavaScript, beside the header:

```js
import { initNative } from './native/box.h';
import './native/boxes.i';

const m = await initNative();   // m.BoxInt, m.MapStringDouble
```

The module then has the classes `BoxInt` and `MapStringDouble`, and a function of `box.h` that takes or returns a `Box<int>` can be called. A template instance also binds through SWIG's own `%template`, in the `.i` beside its header after the `%include`: `%template(BoxInt) Box<int>;` binds the class `BoxInt`, and `%template(largerInt) larger<int>;` the function `largerInt`.

## Adding a method to a class

`%extend` gives a class methods its header does not have. A method's body is C++ and reaches the object as `$self`. This one stands beside `reading.h` as `src/native/reading.i`. `Reading::as<T>()` is a member template, which the generator leaves out, and the added methods call it with a type:

```swig
%module READING

%{
#include <memory>
#include <string>
#include "reading.h"
%}

%feature("shared_ptr");
%feature("polymorphic_shared_ptr");

%extend Reading {
    int rounded() { return $self->as<int>(); }
    std::string label(const std::string &unit) { return std::to_string($self->as<int>()) + " " + unit; }
    static std::shared_ptr<Reading> fromFahrenheit(double fahrenheit) {
        return std::make_shared<Reading>((fahrenheit - 32) / 1.8);
    }
}

%include "reading.h"
```

```js
import { initNative } from './native/reading.h';

const m = await initNative();
const reading = new m.Reading(21.6);
reading.rounded();                       // 21
reading.label('°C');                     // '21 °C'
m.Reading.fromFahrenheit(212).value();   // 100
```

An added method takes strings, numbers and objects as a method of the class does, may be `static`, and may overload a method the class has itself under another argument count.

A constructor is added the same way, as a function that returns the new object: with `Reading(int whole, int tenths) { return new Reading(whole + tenths / 10.0); }` in the block, `new m.Reading(21, 6).value()` is `21.6`. Its argument count must be one that no constructor of the class has. When the class has a constructor of the same argument count, the build leaves the added one out with a line; give the class a static method that returns the object instead, as `fromFahrenheit` does.

## Caveats

1. **Manual `.i` overrides the auto-gen entirely.** You're responsible for `%feature("shared_ptr")` and the rest. Forget them, and `shared_ptr` returns become opaque pointers in JS.
2. **`%include "myheader.h"` is what tells SWIG about your symbols.** Without it, the `.i` is empty even with the `%{ #include ... %}` block (that one only injects into the generated wrapper, not into SWIG's symbol table).
3. **The `.i` is part of the build cache.** Edit it alone and the next build makes its bridge again; the header need not change.

## When you're past `.i`

If a `.i` file isn't enough either, the only remaining option is to **wrap in C++** (see [`cpp-binding-rules.md`](./cpp-binding-rules.md) "Wrapper pattern"). Anything reachable from a clean wrapper class with binding-friendly types will bind.

## See also

- [`cpp-binding-rules.md`](./cpp-binding-rules.md) — what auto-generated bindings can and can't handle.
- [`crossbind-config.md`](./crossbind-config.md) — `paths.module` and `ext.module` fields.
- Source: `core/crossbind/src/actions/createInterface.js` — auto-generation logic.
- The type table: `https://crossbind.dev/guide/bindings/#types`.
