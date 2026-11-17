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

## Caveats

1. **Manual `.i` overrides the auto-gen entirely.** You're responsible for `%feature("shared_ptr")` and the rest. Forget them, and `shared_ptr` returns become opaque pointers in JS.
2. **`%include "myheader.h"` is what tells SWIG about your symbols.** Without it, the `.i` is empty even with the `%{ #include ... %}` block (that one only injects into the generated wrapper, not into SWIG's symbol table).
3. **Build cache** keys on header hash, not `.i` hash. If you only edit the `.i` and not the header, you may need to clear `.crossbind/cache.json` or touch the header to retrigger the binding regen.

## When you're past `.i`

If a `.i` file isn't enough either, the only remaining option is to **wrap in C++** (see [`cpp-binding-rules.md`](./cpp-binding-rules.md) "Wrapper pattern"). Anything reachable from a clean wrapper class with binding-friendly types will bind.

## See also

- [`cpp-binding-rules.md`](./cpp-binding-rules.md) — what auto-generated bindings can and can't handle.
- [`crossbind-config.md`](./crossbind-config.md) — `paths.module` and `ext.module` fields.
- Source: `core/crossbind/src/actions/createInterface.js` — auto-generation logic.
- The type table: `https://crossbind.dev/guide/bindings/#types`.
