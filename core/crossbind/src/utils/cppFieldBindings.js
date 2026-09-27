// SWIG's -embind backend emits functions and constructors but no member variables, so
// public fields never reach JS from the generated bridge alone. This post-pass injects
// embind .property lines for the fields parseCppSurface captured - the
// same post-processing precedent as bridgeAsyncGuard.

// An enum field crosses as its underlying integer and a pointer field as a handle, as callback arguments do. A
// pointer to a struct the bridge binds reads as an instance instead, as a returned pointer does, through a
// shared_ptr that owns nothing: deleting it leaves the library's memory alone. A pointer field takes a handle, null
// or an instance of the struct it points to.
const FIELD_MARK = '// crossbind field';
const FIELD_HELPERS = [
    '// crossbind field helpers begin',
    'namespace crossbind_fields {',
    'template<typename T> std::shared_ptr<T> view(T *pointer) { return std::shared_ptr<T>(pointer, [](T *) {}); }',
    'template<typename P> P set(const emscripten::val &value) {',
    '  using Q = std::remove_pointer_t<P>;',
    '  if constexpr (crossbind::isRawPointee<std::remove_cv_t<Q>>) return crossbind::fromJsStruct<Q>(value);',
    '  else return value.isNull() || value.isUndefined() ? nullptr : crossbind::fromJs<Q>(value.as<crossbind::PointerHandle>());',
    '}',
    '}',
    '// crossbind field helpers end',
    '',
].join('\n');

function propertyLine(className, { name, kind, pointee }, instances) {
    const member = `${className}::${name}`;
    if (kind === 'enum') {
        const integer = `std::underlying_type_t<decltype(${member})>`;
        return `.property("${name}", +[](const ${className} &s) { return static_cast<${integer}>(s.${name}); }, `
            + `+[](${className} &s, ${integer} v) { s.${name} = static_cast<decltype(${member})>(v); }) ${FIELD_MARK}`;
    }
    if (kind === 'pointer') {
        const read = instances.has(pointee) ? `crossbind_fields::view(s.${name})` : `crossbind::toHandle(s.${name})`;
        return `.property("${name}", +[](const ${className} &s) { return ${read}; }, `
            + `+[](${className} &s, emscripten::val v) { s.${name} = crossbind_fields::set<decltype(${member})>(v); }) ${FIELD_MARK}`;
    }
    return `.property("${name}", &${member})`;
}

// Pointer fields need the pointer runtime the SWIG fork writes into a bridge whose header binds a pointer.
// `instances` names the structs whose pointers read as instances.
export function buildFieldPropertyLines(cls, { pointers = false, instances = new Set() } = {}) {
    return (cls.fields ?? []).filter((field) => pointers || field.kind !== 'pointer')
        .map((field) => propertyLine(cls.name, field, instances));
}

// The structs this bridge registers with a shared_ptr holder, under every name the header gives them.
function sharedStructs(bridgeContent, model) {
    const names = (cls) => [cls.name, ...(cls.aliases ?? [])];
    const isShared = (name) => new RegExp(`\\.smart_ptr<std::shared_ptr<[\\w:]+>>\\("${name}"\\)`).test(bridgeContent);
    return new Set((model.classes ?? []).filter((cls) => names(cls).some(isShared)).flatMap(names));
}

// Every line this pass writes has one of these shapes, so the next pass takes them out first: a cached bridge
// then follows what the header declares now, and a field bound by mistake before goes away.
const INJECTED_LINE = /^[ \t]*\.property\("(\w+)", &[\w:]+::\1\)[ \t]*\n/gm;
const MARKED_LINE = /^[ \t]*\.property\(.*\/\/ crossbind field[ \t]*\n/gm;
const INJECTED_HELPERS = /\/\/ crossbind field helpers begin\n[\s\S]*?\/\/ crossbind field helpers end\n/;
const POINTER_RUNTIME = /\bPointerHandle toHandle\(/;

export function injectFieldBindings(bridgeContent, model) {
    let out = bridgeContent.replace(INJECTED_LINE, '').replace(MARKED_LINE, '').replace(INJECTED_HELPERS, '');
    const pointers = POINTER_RUNTIME.test(out);
    const instances = sharedStructs(out, model);
    for (const cls of model.classes ?? []) {
        const lines = buildFieldPropertyLines(cls, { pointers, instances })
            .filter((line) => !out.includes(line));
        if (!lines.length) continue;
        // SWIG registers `typedef struct tag { ... } alias;` under the alias.
        for (const name of [cls.name, ...(cls.aliases ?? [])]) {
            // Lazy template match still lands on the right opener: the first `>(\s*"Name")`
            // closes the template list even when it contains nested arguments like base<T>.
            const opener = new RegExp(`(emscripten::class_<[\\s\\S]*?>\\s*\\(\\s*"${name}"\\s*\\))`);
            if (!opener.test(out)) continue;
            out = out.replace(opener, `$1\n    ${lines.join('\n    ')}`);
            break;
        }
    }
    const usesHelpers = out.includes('crossbind_fields::set<');
    return usesHelpers ? out.replace(/^EMSCRIPTEN_BINDINGS\(/m, `${FIELD_HELPERS}EMSCRIPTEN_BINDINGS(`) : out;
}
