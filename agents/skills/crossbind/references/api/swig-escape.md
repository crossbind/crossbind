<!-- GENERATED from docs/api/swig-escape.md by scripts/build-agent-skill.mjs. Do not edit. -->

# SWIG escape hatch — manual `.i` files

> crossbind auto-generates SWIG `.i` interface files for every header it sees. You only write a manual `.i` file when the auto-generated one isn't enough. **Default to letting crossbind generate** — fall back to manual only when forced.

## How auto-generation works

For each header in `paths.header` (defaults to `paths.native`, defaults to `src/native`), crossbind generates an `.i` file with:

```swig
%module FILENAME_UPPER

%feature("shared_ptr")
%feature("polymorphic_shared_ptr")
%include "path/to/header.h"
```

That's it. Header included verbatim, `shared_ptr` features enabled, module name derived from filename. For 95% of cases this is correct.

## When you need to write your own

You're forced into manual `.i` only when one of these is true:

1. **Custom type mappings** (`%typemap` directives) — e.g. converting an exotic upstream type to a JS-friendly one.
2. **Selective symbol export** — your header has 100 symbols and you want to expose 10. Auto-generated `.i` exposes everything.
3. **Renaming** (`%rename`) — your C++ symbol clashes with a JS reserved word, or you want a more idiomatic JS name.
4. **Ignoring members** (`%ignore`) — a method takes a raw pointer that the auto-binder would choke on, and you can't refactor the upstream header.
5. **Custom directors** for cross-language polymorphism (rare).

For everything else: write a C++ wrapper instead. Wrappers are easier to reason about and won't drift if SWIG semantics change.

## How to wire a manual `.i` into your project

crossbind looks for an `.i` file using two mechanisms (in order):

### Option 1 — sibling next to header

If `src/native/foo.h` has a sibling `src/native/foo.i`, crossbind uses the `.i` instead of auto-generating. Same path + `.i` extension is the trigger.

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

Replace `mymodule` with `FILENAME_UPPER` (the convention auto-gen uses). Drop into `src/native/myheader.i` next to `myheader.h`.

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
- Website type table: `https://crossbind.dev/docs/api/cpp-bindings/data-types`.
