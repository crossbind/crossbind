import { ALL_NAMES } from './headerImports.js';
import { parseMacroDump, stripComments, declaresAtFileScope } from './swigInterface.js';

// SWIG binds no function-like macro, variadic function or mutable global. crossbind binds them for the names an app
// imports by name: a function-like macro takes the parameter types of the one function it calls, a macro naming a
// function binds that function under its own name, a variadic function takes its extra arguments by their JavaScript
// type, and a mutable global binds as a handle to its address. A macro binds only through a function SWIG bound, the
// one place that proves the name is a single declared function.

const C_IDENTIFIER = /^[A-Za-z_]\w*$/;
const MACRO_LINE = /^\/\/ crossbind:macro ([A-Za-z_]\w*) (#define .*)$/gm;
const ALIAS_LINE = /^\/\/ crossbind:alias ([A-Za-z_]\w*) ([A-Za-z_]\w*)$/gm;
const NOTE_MARKER = '// crossbind:note ';
const EXTRA_LINES = /^(?:\/\/ crossbind:(?:macro|alias|note) .*\n)+\n/m;
// The arguments one call may add to a variadic function: each registration count dispatches over 2^n argument kinds.
const MAX_VARIADIC_ARGUMENTS = 6;
const VARIADIC_WARNING = /^Variable length arguments are not supported by embind, (\S+) skipped\.$/;
const GLOBAL_WARNING = /^Global (\S+) is not const, so embind cannot bind it as a constant; skipped\.$/;
const CAST = /^\(\s*[A-Za-z_]\w*(?:\s+[A-Za-z_]\w*)*\s*\**\s*\)\s*(.+)$/;
const C_KEYWORDS = new Set([
    'auto', 'bool', 'char', 'const', 'double', 'enum', 'extern', 'float', 'int', 'long', 'register', 'restrict', 'short',
    'signed', 'static', 'struct', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'inline', 'true', 'false', 'nullptr',
]);
export const POINTER_RUNTIME_ANCHOR = 'crossbindPointerRuntime';

// The index of the quote that closes the string or character literal opening at `at`.
function literalEnd(text, at) {
    let end = at + 1;
    while (end < text.length && text[end] !== text[at]) end += text[end] === '\\' ? 2 : 1;
    return end;
}

function closingParen(text, open) {
    let depth = 0;
    for (let at = open; at < text.length; at += 1) {
        if (text[at] === '"' || text[at] === "'") at = literalEnd(text, at);
        else if (text[at] === '(') depth += 1;
        else if (text[at] === ')' && (depth -= 1) === 0) return at;
    }
    return -1;
}

const isWrapped = (text) => text.startsWith('(') && closingParen(text, 0) === text.length - 1;

function splitArguments(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let at = 0; at < text.length; at += 1) {
        if (text[at] === '"' || text[at] === "'") at = literalEnd(text, at);
        else if (text[at] === '(') depth += 1;
        else if (text[at] === ')') depth -= 1;
        else if (text[at] === ',' && depth === 0) {
            parts.push(text.slice(start, at));
            start = at + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((part) => part.trim());
}

// `(pp)`, `(char *)(pp)` and `(void *)pp` all pass pp whole.
function wholeArgument(argument) {
    let text = argument;
    for (;;) {
        if (isWrapped(text)) {
            text = text.slice(1, -1).trim();
        } else {
            const cast = text.match(CAST);
            if (!cast) return text;
            text = cast[1].trim();
        }
    }
}

// The one function a function-like macro calls, and where each of its parameters goes in that call; null for any
// other body.
export function macroCall(macro) {
    if (!macro?.params || macro.params.some((param) => !C_IDENTIFIER.test(param))) return null;
    let body = macro.body.trim();
    while (isWrapped(body)) body = body.slice(1, -1).trim();
    const open = body.indexOf('(');
    const callee = body.slice(0, Math.max(open, 0)).trim();
    if (open < 0 || !C_IDENTIFIER.test(callee) || closingParen(body, open) !== body.length - 1) return null;
    const args = body.slice(open + 1, -1).trim() ? splitArguments(body.slice(open + 1, -1)) : [];
    const positions = macro.params.map((param) => args.findIndex((arg) => wholeArgument(arg) === param));
    return positions.every((position) => position >= 0) ? { callee, positions } : null;
}

// The identifier an object-like macro stands for, as in `#define iconv_open libiconv_open`.
const identifierOf = (macro) => (macro && !macro.params && C_IDENTIFIER.test(macro.body) ? macro.body : null);

// What the interface carries for the names an app imports by name, read by the bridge once SWIG has run: their
// function-like macros and their macros naming a function, and the functions they reach, which SWIG has to bind.
export function interfaceExtras(names, macros) {
    if (names === ALL_NAMES || !names.length) return { lines: [], functions: [] };
    const lines = [];
    const functions = [];
    for (const name of names) {
        const macro = macros.get(name);
        if (!macro) continue;
        if (!macro.params) {
            const target = identifierOf(macro);
            if (target && target !== name && !macros.has(target) && !C_KEYWORDS.has(target)) {
                lines.push(`// crossbind:alias ${name} ${target}`);
                functions.push(target);
            }
            continue;
        }
        const call = macroCall(macro);
        const callee = call && macros.get(call.callee);
        if (callee?.params) {
            lines.push(`${NOTE_MARKER}${name}: a function-like macro binds only when it calls a function, not the macro ${call.callee}; skipped.`);
        } else {
            // The compiler expands a callee that is an object-like macro, while SWIG knows the function by its target.
            const declared = (call && identifierOf(callee)) ?? call?.callee ?? name;
            lines.push(`// crossbind:macro ${declared} ${macro.line}`);
            if (call) functions.push(declared);
        }
    }
    return { lines, functions };
}

// A function SWIG registered once; one it bound for a single argument count of several overloads warns about the rest.
const bindsOneFunction = (bridgeText, warnings, name) => bridgeText.split(`emscripten::function("${name}",`).length === 2
    && !warnings.some((line) => line.includes(`another overload of ${name} taking`));

// A function whose extra arguments arrive as a va_list cannot be called with them.
const takesVaList = (headerText, name) => new RegExp(`\\b${name}\\b[^;{}]*\\bva_list\\b`).test(stripComments(headerText));

function warningsAbout(warnings, pattern, imported) {
    const found = new Map();
    for (const line of warnings) {
        const name = line.match(/^.*:\d+: (.*)$/)?.[1].match(pattern)?.[1];
        if (name && imported.has(name)) found.set(name, line);
    }
    return found;
}

const macroStruct = (name, params) => (params.length ? `struct crossbind_macro_${name} {
  template<${params.map((_, i) => `typename A${i}`).join(', ')}>
  static auto call(${params.map((_, i) => `A${i} a${i}`).join(', ')}) { return ${name}(${params.map((_, i) => `a${i}`).join(', ')}); }
};` : `struct crossbind_macro_${name} {
  static auto call() { return ${name}(); }
};`);

// What the bridge of `interfaceText` adds to SWIG's output in `bridgeText` for the names the app imports by name: the C++
// to append, the names it exports, the warnings it answers and the ones it adds.
export function bridgeExtras({ interfaceText = '', named = [], bridgeText = '', warnings = [], headerText = '', module }) {
    const imported = new Set(named);
    const notes = interfaceText.split('\n').filter((line) => line.startsWith(NOTE_MARKER)).map((line) => line.slice(NOTE_MARKER.length));
    const macros = [];
    for (const [, declared, line] of interfaceText.matchAll(MACRO_LINE)) {
        const [[name, macro]] = parseMacroDump(line);
        const call = macroCall(macro);
        if (!call) notes.push(`${name}: a function-like macro binds only when its body calls one function with each of its parameters as a whole argument; skipped.`);
        else if (!bindsOneFunction(bridgeText, warnings, declared)) notes.push(`${name}: a function-like macro binds only when it calls one function the header binds, which ${declared} is not; skipped.`);
        else macros.push({ name, params: macro.params, ...call });
    }
    const aliases = [];
    for (const [, name, target] of interfaceText.matchAll(ALIAS_LINE)) {
        if (bindsOneFunction(bridgeText, warnings, target)) aliases.push({ name, target });
        // A macro naming an enum member SWIG binds as a constant already.
        else if (!bridgeText.includes(`bindConstant("${name}"`)) notes.push(`${name}: a macro naming ${target} binds only when ${target} is one function the header binds; skipped.`);
    }
    const variadicWarnings = warningsAbout(warnings, VARIADIC_WARNING, imported);
    const variadics = [...variadicWarnings.keys()].filter((name) => !takesVaList(headerText, name));
    const globalWarnings = warningsAbout(warnings, GLOBAL_WARNING, imported);
    const globals = [...globalWarnings.keys()].filter((name) => declaresAtFileScope(headerText, name));
    const answered = new Set([...variadics.map((name) => variadicWarnings.get(name)), ...globals.map((name) => globalWarnings.get(name))]);
    if (!macros.length && !aliases.length && !variadics.length && !globals.length) return { code: '', exports: [], answered, notes };

    // The macros register ahead of the fallbacks below, which would make a function a variadic shares its name with an
    // overload set.
    const code = [
        EXTRAS_RUNTIME,
        ...macros.map(({ name, params }) => macroStruct(name, params)),
        `EMSCRIPTEN_BINDINGS(CrossbindMacros_${module}) {`,
        ...macros.map(({ name, callee, positions }) => `  crossbind::bindMacro<crossbind_macro_${name}, decltype(&${callee})${positions.map((p) => `, ${p}`).join('')}>("${name}");`),
        ...aliases.map(({ name, target }) => `  crossbind::bindAlias<decltype(&${target}), &${target}>("${name}");`),
        '}',
        // A name SWIG reported only for a class member reaches this fallback, which binds nothing.
        ...variadics.map((name) => `inline crossbind::Unbound (${name})(crossbind::Unbound) { return {}; }`),
        `EMSCRIPTEN_BINDINGS(CrossbindExtras_${module}) {`,
        ...variadics.map((name) => `  { using F = decltype(crossbind::variadicType(&${name}, 0)); crossbind::bindVariadic<F, static_cast<F>(&${name}), ${MAX_VARIADIC_ARGUMENTS}>("${name}"); }`),
        ...globals.map((name) => `  crossbind::bindGlobal("${name}", &${name});`),
        '}',
        '',
    ].join('\n');
    const exports = [...macros.map(({ name }) => name), ...aliases.map(({ name }) => name), ...variadics, ...globals, ...(variadics.length ? ['vaDouble'] : [])];
    return { code, exports, answered, notes };
}

export const hasPointerRuntime = (bridgeText) => bridgeText.includes('struct NativePointer {');

// SWIG writes its pointer runtime only into a bridge with a pointer binding, so a bridge whose extras need it binds
// this function too, and the export list leaves it out.
const POINTER_RUNTIME_BINDING = `%rename("%s") ${POINTER_RUNTIME_ANCHOR};
%inline %{
static void ${POINTER_RUNTIME_ANCHOR}(void *) {}
%}

`;
export const withPointerRuntimeAnchor = (interfaceText) => interfaceText.replace(/^%include\b/m, `${POINTER_RUNTIME_BINDING}%include`);

// What the interface carries for the bridge alone, which a SWIG run over the whole header for the editor leaves out.
export const withoutBridgeExtras = (interfaceText) => interfaceText.replace(EXTRA_LINES, '').replace(POINTER_RUNTIME_BINDING, '');

export const EXTRAS_RUNTIME = `// crossbind extras
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>
namespace crossbind {
struct Unbound {};
template<size_t> using JsValue = emscripten::val;

// A number, a boolean, or an enum member, which embind hands over as an object with a numeric value.
inline bool readNumber(const emscripten::val &value, double &number) {
  if (value.isNumber()) number = value.as<double>();
  else if (value.isTrue() || value.isFalse()) number = value.isTrue() ? 1 : 0;
  else if (value.isNull() || value.isUndefined() || value.typeOf().as<std::string>() != "object" || !value["value"].isNumber()) return false;
  else number = value["value"].as<double>();
  return true;
}

// A BigInt is compared as one: converting first would wrap a value beyond 64 bits.
template<typename Wide> Wide bigIntFromJs(const emscripten::val &value, Wide min, Wide max) {
  if (value < emscripten::val(min) || value > emscripten::val(max)) throw std::range_error("crossbind: an integer argument is out of range");
  return value.as<Wide>();
}

// 2^digits is one past the largest value of I, and the negative of its smallest when it is signed; a double holds both.
template<typename I> bool fitsInteger(double number) {
  const double limit = std::ldexp(1.0, std::numeric_limits<I>::digits);
  return number < limit && number >= (std::is_signed_v<I> ? -limit : 0.0);
}

template<typename I> I integerFromJs(const emscripten::val &value) {
  double number = 0;
  if (!value.isNumber() && value.typeOf().as<std::string>() == "bigint") {
    using Wide = std::conditional_t<std::is_signed_v<I>, long long, unsigned long long>;
    return static_cast<I>(bigIntFromJs<Wide>(value, std::numeric_limits<I>::min(), std::numeric_limits<I>::max()));
  }
  if (!readNumber(value, number) || std::trunc(number) != number) throw std::invalid_argument("crossbind: an integer argument takes an integer, a BigInt or an enum member");
  if (!fitsInteger<I>(number)) throw std::range_error("crossbind: an integer argument is out of range");
  return static_cast<I>(number);
}

template<typename T> constexpr bool isJsArgument = std::is_pointer_v<std::remove_cv_t<T>> || std::is_enum_v<std::remove_cv_t<T>>
  || (std::is_arithmetic_v<std::remove_cv_t<T>> && !std::is_same_v<std::remove_cv_t<T>, long double>);
template<typename R> constexpr bool isJsResult = std::is_void_v<R> || isJsArgument<R>;

// What converts to the parameter: a CStringArg keeps a string's copy alive for the call.
template<typename T> auto argumentFromJs(const emscripten::val &value) {
  using U = std::remove_cv_t<T>;
  if constexpr (std::is_same_v<U, const char *>) return fromJsCString<const char>(value);
  else if constexpr (std::is_pointer_v<U>) return fieldFromJs<U>(value);
  else if constexpr (std::is_same_v<U, bool>) {
    double number = 0;
    if (!readNumber(value, number)) throw std::invalid_argument("crossbind: a bool argument takes a boolean or a number");
    return number != 0;
  } else if constexpr (std::is_enum_v<U>) return static_cast<U>(integerFromJs<std::underlying_type_t<U>>(value));
  else if constexpr (std::is_integral_v<U>) return integerFromJs<U>(value);
  else {
    double number = 0;
    if (!readNumber(value, number)) throw std::invalid_argument("crossbind: a floating-point argument takes a number");
    return static_cast<U>(number);
  }
}

template<typename R> auto resultToJs(R result) {
  using U = std::remove_cv_t<R>;
  if constexpr (std::is_same_v<U, const char *>) return toJsCString(result);
  else if constexpr (std::is_pointer_v<U>) return toJs(result);
  else if constexpr (std::is_enum_v<U>) return static_cast<std::underlying_type_t<U>>(result);
  else return result;
}

template<typename Call, size_t... I> void registerCall(const char *name, std::index_sequence<I...>) {
  if (!claimFunction(name, sizeof...(I))) return;
  emscripten::function(name, +[](JsValue<I>... args) { return Call::invoke(std::array<emscripten::val, sizeof...(I)>{args...}); }, emscripten::allow_raw_pointers());
}

template<size_t... I> void registerUnconvertible(const char *name, std::index_sequence<I...>) {
  if (!claimFunction(name, sizeof...(I))) return;
  emscripten::function(name, +[](JsValue<I>...) {
    throw std::invalid_argument("crossbind: this binding takes or returns a type only a C++ wrapper reaches (numbers, enums, booleans, strings and pointers cross)");
  });
}

template<typename F> struct Signature;
template<typename R, typename... A> struct Signature<R (*)(A...)> { using Result = R; using Params = std::tuple<A...>; };
template<typename R, typename... A> struct Signature<R (*)(A..., ...)> { using Result = R; using Params = std::tuple<A...>; };
template<typename R, typename... A> struct Signature<R (*)(A...) noexcept> : Signature<R (*)(A...)> {};
template<typename R, typename... A> struct Signature<R (*)(A..., ...) noexcept> : Signature<R (*)(A..., ...)> {};
template<typename Params, size_t P, typename = void> struct ParamAt { using type = Unbound; };
template<typename Params, size_t P> struct ParamAt<Params, P, std::enable_if_t<(P < std::tuple_size_v<Params>)>> { using type = std::tuple_element_t<P, Params>; };
template<typename Tuple> struct AllJsArguments;
template<typename... A> struct AllJsArguments<std::tuple<A...>> : std::bool_constant<(isJsArgument<A> && ...)> {};

// A function under another name, a macro's.
template<auto f, typename Params> struct FunctionCall;
template<auto f, typename... A> struct FunctionCall<f, std::tuple<A...>> {
  template<size_t... I> static auto call(const std::array<emscripten::val, sizeof...(A)> &args, std::index_sequence<I...>) {
    auto converted = std::make_tuple(argumentFromJs<A>(args[I])...);
    using R = decltype(f(static_cast<A>(std::get<I>(converted))...));
    if constexpr (std::is_void_v<R>) f(static_cast<A>(std::get<I>(converted))...);
    else return resultToJs(f(static_cast<A>(std::get<I>(converted))...));
  }
  static auto invoke(const std::array<emscripten::val, sizeof...(A)> &args) { return call(args, std::index_sequence_for<A...>{}); }
};

template<typename F, F f> void bindAlias(const char *name) {
  using S = Signature<F>;
  constexpr size_t arity = std::tuple_size_v<typename S::Params>;
  if constexpr (AllJsArguments<typename S::Params>::value && isJsResult<typename S::Result>) registerCall<FunctionCall<f, typename S::Params>>(name, std::make_index_sequence<arity>{});
  else registerUnconvertible(name, std::make_index_sequence<arity>{});
}

// A function-like macro called with the parameter types of the function it calls, read at the positions it passes them.
template<typename Macro, typename Params, size_t... P> struct MacroCall {
  template<size_t... I> static auto call(const std::array<emscripten::val, sizeof...(P)> &args, std::index_sequence<I...>) {
    auto converted = std::make_tuple(argumentFromJs<typename ParamAt<Params, P>::type>(args[I])...);
    using R = decltype(Macro::call(static_cast<typename ParamAt<Params, P>::type>(std::get<I>(converted))...));
    if constexpr (std::is_void_v<R>) Macro::call(static_cast<typename ParamAt<Params, P>::type>(std::get<I>(converted))...);
    else return resultToJs(Macro::call(static_cast<typename ParamAt<Params, P>::type>(std::get<I>(converted))...));
  }
  static auto invoke(const std::array<emscripten::val, sizeof...(P)> &args) { return call(args, std::make_index_sequence<sizeof...(P)>{}); }
};

template<typename Macro, typename Params, size_t... P> constexpr bool macroResultConverts() {
  return isJsResult<decltype(Macro::call(std::declval<typename ParamAt<Params, P>::type>()...))>;
}

template<typename Macro, typename Callee, size_t... P> void bindMacro(const char *name) {
  using Params = typename Signature<Callee>::Params;
  if constexpr ((isJsArgument<typename ParamAt<Params, P>::type> && ...)) {
    if constexpr (macroResultConverts<Macro, Params, P...>()) registerCall<MacroCall<Macro, Params, P...>>(name, std::make_index_sequence<sizeof...(P)>{});
    else registerUnconvertible(name, std::make_index_sequence<sizeof...(P)>{});
  } else registerUnconvertible(name, std::make_index_sequence<sizeof...(P)>{});
}

// A variadic argument goes where the C ABI puts its type: on wasm32 a long or pointer is one 4-byte slot and a long long
// or double one 8-byte slot, while 64-bit targets pass integers and pointers in general registers and doubles in
// floating-point ones. Each extra argument is one of two kinds, so a call with n of them dispatches over 2^n calls.
#if UINTPTR_MAX == 0xFFFFFFFFu
using VarWord = std::uint32_t;
using VarWide = std::uint64_t;
#else
using VarWord = std::uint64_t;
using VarWide = double;
#endif
struct VarArgument {
  bool wide = false;
  VarWord word = 0;
  VarWide wideValue = 0;
  CStringArg text;
  PointerHandle handle;
  // A short string lives inside its CStringArg, so its address is read where the argument ended up.
  VarWord passed() const { return text.isText ? static_cast<VarWord>(reinterpret_cast<std::uintptr_t>(text.text.c_str())) : word; }
};

inline void setDouble(VarArgument &arg, double number) {
  arg.wide = true;
  if constexpr (std::is_same_v<VarWide, double>) arg.wideValue = number;
  else std::memcpy(&arg.wideValue, &number, sizeof number);
}

inline void setLongLong(VarArgument &arg, long long number) {
  if constexpr (sizeof(VarWord) == sizeof(long long)) {
    arg.word = static_cast<VarWord>(number);
  } else {
    arg.wide = true;
    arg.wideValue = static_cast<VarWide>(static_cast<unsigned long long>(number));
  }
}

// An integer number is a C long, which is 32 bits on wasm32 and Windows; a larger one takes a BigInt (long long).
inline VarArgument varArgumentFromJs(const emscripten::val &value) {
  VarArgument arg;
  if (value.isNull() || value.isUndefined()) return arg;
  if (value.isString()) {
    arg.text = fromJsCString<const char>(value);
    return arg;
  }
  std::string type = value.isNumber() ? "number" : value.typeOf().as<std::string>();
  if (type == "bigint") {
    // A long long or an unsigned one: the same 64 bits either way.
    if (value < emscripten::val(0LL)) setLongLong(arg, bigIntFromJs<long long>(value, std::numeric_limits<long long>::min(), 0));
    else setLongLong(arg, static_cast<long long>(bigIntFromJs<unsigned long long>(value, 0, std::numeric_limits<unsigned long long>::max())));
    return arg;
  }
  if (type == "object" && value["crossbindVaDouble"].isNumber()) {
    setDouble(arg, value["crossbindVaDouble"].as<double>());
    return arg;
  }
  if (type == "object" && value.instanceof(emscripten::val::module_property("NativePointer"))) {
    arg.handle = value.as<PointerHandle>();
    arg.word = static_cast<VarWord>(arg.handle ? arg.handle->address : 0);
    return arg;
  }
  double number = 0;
  if (!readNumber(value, number)) throw std::invalid_argument("crossbind: a variadic argument takes a number, a BigInt, vaDouble(x), a string, a pointer handle, an enum member or null");
  if (!std::isfinite(number) || std::trunc(number) != number) {
    setDouble(arg, number);
    return arg;
  }
  if (!fitsInteger<long>(number) && !fitsInteger<unsigned long>(number)) throw std::range_error("crossbind: a variadic integer beyond a C long takes a BigInt");
  arg.word = static_cast<VarWord>(number < 0 ? static_cast<long long>(number) : static_cast<long long>(static_cast<unsigned long long>(number)));
  return arg;
}

template<size_t N, typename Invoke, typename... Done> decltype(auto) callWithVarArguments(const Invoke &invoke, const VarArgument *extra, Done... done) {
  if constexpr (N == 0) return invoke(done...);
  else if (extra->wide) return callWithVarArguments<N - 1>(invoke, extra + 1, done..., extra->wideValue);
  else return callWithVarArguments<N - 1>(invoke, extra + 1, done..., extra->passed());
}

template<typename F> struct VariadicSignature;
template<typename R, typename... A> struct VariadicSignature<R (*)(A..., ...)> {
  using Result = R;
  using Fixed = std::tuple<A...>;
};
template<typename R, typename... A> struct VariadicSignature<R (*)(A..., ...) noexcept> : VariadicSignature<R (*)(A..., ...)> {};

// Picks the variadic function among a name's overloads, or the fallback that binds nothing. A noexcept one (a C
// library declared with __THROW) needs its own pattern, or the call is ambiguous.
template<typename R, typename... A> auto variadicType(R (*)(A..., ...), int) -> R (*)(A..., ...);
template<typename R, typename... A> auto variadicType(R (*)(A..., ...) noexcept, int) -> R (*)(A..., ...) noexcept;
inline auto variadicType(Unbound (*)(Unbound), long) -> Unbound (*)(Unbound);

template<auto f, size_t Extra> struct VariadicCall {
  using S = VariadicSignature<decltype(f)>;
  static constexpr size_t fixedCount = std::tuple_size_v<typename S::Fixed>;
  template<size_t... I, size_t... J> static auto call(const std::array<emscripten::val, fixedCount + Extra> &args, std::index_sequence<I...>, std::index_sequence<J...>) {
    auto fixed = std::make_tuple(argumentFromJs<std::tuple_element_t<I, typename S::Fixed>>(args[I])...);
    std::array<VarArgument, Extra> extra{varArgumentFromJs(args[fixedCount + J])...};
    auto invoke = [&](auto... va) { return f(static_cast<std::tuple_element_t<I, typename S::Fixed>>(std::get<I>(fixed))..., va...); };
    if constexpr (std::is_void_v<typename S::Result>) callWithVarArguments<Extra>(invoke, extra.data());
    else return resultToJs(callWithVarArguments<Extra>(invoke, extra.data()));
  }
  static auto invoke(const std::array<emscripten::val, fixedCount + Extra> &args) {
    return call(args, std::make_index_sequence<fixedCount>{}, std::make_index_sequence<Extra>{});
  }
};

template<auto f, size_t... K> void registerVariadic(const char *name, std::index_sequence<K...>) {
  using S = VariadicSignature<decltype(f)>;
  constexpr size_t fixedCount = std::tuple_size_v<typename S::Fixed>;
  if constexpr (AllJsArguments<typename S::Fixed>::value && isJsResult<typename S::Result>) {
    (registerCall<VariadicCall<f, K>>(name, std::make_index_sequence<fixedCount + K>{}), ...);
  } else {
    (registerUnconvertible(name, std::make_index_sequence<fixedCount + K>{}), ...);
  }
}

inline void bindVaDouble() {
  if (!claimFunction("vaDouble", 1)) return;
  emscripten::function("vaDouble", +[](double number) {
    emscripten::val marked = emscripten::val::object();
    marked.set("crossbindVaDouble", number);
    return marked;
  });
}

template<typename F, F f, size_t MaxExtra> void bindVariadic(const char *name) {
  if constexpr (!std::is_same_v<F, Unbound (*)(Unbound)>) {
    registerVariadic<f>(name, std::make_index_sequence<MaxExtra + 1>{});
    bindVaDouble();
  }
}

template<typename T> void bindGlobal(const char *name, T *address) {
  if (!claimRegistration(std::string("name ") + name)) return;
  if constexpr (std::is_array_v<T>) emscripten::constant(name, toHandle(&(*address)[0]));
  else emscripten::constant(name, toHandle(address));
}
}
`;
