// jsi ADAPTER (mobile): stable flat C-ABI -> @crossbind/core-embind-jsi.
//
// Wraps each raw Rust invoker into a jsi::Function via bounded-dispatch: because every wire kind
// is integer-class in the invoker's C signature (doubles travel as bit patterns in u64 - see the
// crate's WireType for f64), uint64-slot casts dispatch correctly on every native ABI with no
// libffi and no per-arch assembly. (Apple ships libffi as private API on iOS - no header - so
// staying libffi-free is also the App-Store-safe choice.) The only bound is the arity cap below.
//
// KEY FINDING (embind.js craftInvokerFunction + getDynCaller): embind builds each invoker call as
// `invoker(targetFn, [thisWired,] argsWired...)`, then getDynCaller wraps our jsi::Function with
// slice=true for constructors/methods/static/free functions and DROPS the leading targetFn before
// calling us. So our jsi::Function receives ONLY `([thisWired,] argsWired...)` - the target pointer
// never arrives. But our Rust invoker takes that target as its first C parameter, so the adapter
// BAKES the target (known at registration) and prepends it when dispatching. Direct functions
// (getActualType, destructor, smart-ptr ops, value-object ctor/dtor/fields) are registered with
// slice=false and called with their real args, so those map 1:1 with no prepend.
//
// Wire kinds (embind.js marshals before calling us): int/bool/enum -> jsi number, pointer
// (this/handle/value-object wire) -> jsi::BigInt(uint64), std::string -> jsi::String (SIG 's',
// marshalled to/from the crate's [u32 len][bytes] buffer in readArg / wireStringToJsi).
//
// Compiled ONLY inside the RN native module (jsi + embind-jsi headers exist there via build_ios.js).

#include <jsi/jsi.h>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <optional>
#include <string>
#include <typeinfo>
#include <unordered_set>
// Real embind-jsi declarations (correct namespaces/linkage/signatures): jsRuntime lives in
// `emscripten`, the _embind_register_* functions and InitFunc in `emscripten::internal` with C++
// linkage and jsi::Function& slots. Including its header avoids any hand-declaration mismatch.
#include <emscripten/bind.h>
#include "../include/crossbind_embind.h"

namespace jsi = facebook::jsi;
using emscripten::jsRuntime;
using namespace emscripten::internal; // InitFunc + the _embind_register_* functions

// Defined in embind-jsi's bind.cpp but not declared in its header: the identity value type.
// Optional returns register through it because THIS adapter already converts the nullable
// heap cell to the final jsi value (undefined or the inner) before embind-jsi sees it.
namespace emscripten { namespace internal {
void _embind_register_jsiValue(TYPEID jsiValueType, const char* name);
} }
// embind-jsi's TYPEID is `const void*` (wire.h) - identical to our CrossbindTid, so no conversion.

extern "C" {
const void* crossbind_tid_int() { return &typeid(int); }
const void* crossbind_tid_double() { return &typeid(double); }
const void* crossbind_tid_bool() { return &typeid(bool); }
const void* crossbind_tid_void() { return &typeid(void); }
const void* crossbind_tid_std_string() { return &typeid(std::string); }
const void* crossbind_tid_int64() { return &typeid(int64_t); }
const void* crossbind_tid_uint64() { return &typeid(uint64_t); }
const void* crossbind_tid_int8() { return &typeid(int8_t); }
const void* crossbind_tid_int16() { return &typeid(int16_t); }
const void* crossbind_tid_uint8() { return &typeid(uint8_t); }
const void* crossbind_tid_uint16() { return &typeid(uint16_t); }
const void* crossbind_tid_uint32() { return &typeid(uint32_t); }
const void* crossbind_tid_float() { return &typeid(float); }
// Adapter-local identities, NOT &typeid(std::optional<T>): linked C++ bindings may register
// the real optional typeids themselves, and these types never interop with C++ signatures.
const void* crossbind_tid_optional_int() { static const char t = 0; return &t; }
const void* crossbind_tid_optional_double() { static const char t = 0; return &t; }
const void* crossbind_tid_optional_bool() { static const char t = 0; return &t; }
const void* crossbind_tid_optional_string() { static const char t = 0; return &t; }

// Idempotent: every Rust archive in the app may ask for the same optional type.
void crossbind_embind_register_optional(const void* opt, const void* /*inner: adapter converts*/) {
    static std::unordered_set<const void*> registered;
    if (!registered.insert(opt).second) return;
    _embind_register_jsiValue(opt, "std::optional");
}

// JSON-value bridge (serde_json::Value): raw JSI into two handle-based fork helpers - the
// fork's emval STRING plumbing reads wasm-heap pointers (none exist natively), so val::global
// style calls die with "Property 'WebAssembly' doesn't exist" on device. Handle refcounts:
// to_handle returns an owned +1; handle_to_json consumes its argument (the JS helper decrefs).
const void* crossbind_tid_emval() { return &typeid(emscripten::val); }

void* crossbind_emval_json_to_handle(uint8_t* w) {
    uint32_t len;
    std::memcpy(&len, w, 4);
    std::string s((const char*)(w + 4), len);
    std::free(w);
    auto r = jsRuntime->global().getPropertyAsFunction(*jsRuntime, "__crossbind_json_to_handle")
        .call(*jsRuntime, jsi::String::createFromUtf8(*jsRuntime, s));
    // Fork emval handles are BigInt end-to-end (Emval.toHandle returns 1n/2n/allocator BigInts).
    return (void*)(uintptr_t)r.asBigInt(*jsRuntime).asUint64(*jsRuntime);
}

uint8_t* crossbind_emval_handle_to_json(void* h) {
    auto r = jsRuntime->global().getPropertyAsFunction(*jsRuntime, "__crossbind_handle_to_json")
        .call(*jsRuntime, jsi::Value(jsi::BigInt::fromUint64(*jsRuntime, (uint64_t)(uintptr_t)h)));
    std::string s = r.asString(*jsRuntime).utf8(*jsRuntime);
    uint8_t* w = (uint8_t*)std::malloc(4 + s.size());
    uint32_t len = (uint32_t)s.size();
    std::memcpy(w, &len, 4);
    std::memcpy(w + 4, s.data(), s.size());
    return w;
}
}

// ---- live JS value hooks (JsValue / JsFunction) ----
// Fork helpers over the emval handle table (BigInt handles end-to-end); strings cross as jsi
// strings, never through the fork's wasm-heap emval string plumbing. Called directly from the
// Rust crate (not through bounded dispatch), so real f64 parameters are fine here.
static jsi::Value crossbindVHandle(uint64_t h) {
    return jsi::Value(jsi::BigInt::fromUint64(*jsRuntime, h));
}
static uint64_t crossbindHandleOf(const jsi::Value& v) {
    return v.asBigInt(*jsRuntime).asUint64(*jsRuntime);
}
static jsi::String crossbindKeyFromWire(uint8_t* w) {
    uint32_t len;
    std::memcpy(&len, w, 4);
    std::string k((const char*)(w + 4), len);
    std::free(w);
    return jsi::String::createFromUtf8(*jsRuntime, k);
}
static uint8_t* crossbindWireFromString(const std::string& s) {
    uint8_t* w = (uint8_t*)std::malloc(4 + s.size());
    uint32_t len = (uint32_t)s.size();
    std::memcpy(w, &len, 4);
    std::memcpy(w + 4, s.data(), s.size());
    return w;
}
static jsi::Function crossbindHelper(const char* name) {
    return jsRuntime->global().getPropertyAsFunction(*jsRuntime, name);
}
static thread_local std::string g_cbError;
static thread_local bool g_hasCbError = false;

extern "C" {
void crossbind_v_ref(size_t h) {
    crossbindHelper("__emval_incref").call(*jsRuntime, crossbindVHandle(h));
}
void crossbind_v_unref(size_t h) {
    crossbindHelper("__emval_decref").call(*jsRuntime, crossbindVHandle(h));
}
// Fork emval constants: undefined = 1n (init_emval seeds 1..4, reserved = 5).
size_t crossbind_v_undef() { return 1; }
size_t crossbind_v_from_f64(double v) {
    return (size_t)crossbindHandleOf(crossbindHelper("__crossbind_v_from_num").call(*jsRuntime, jsi::Value(v)));
}
size_t crossbind_v_from_bool(int v) {
    return (size_t)crossbindHandleOf(crossbindHelper("__crossbind_v_from_bool").call(*jsRuntime, jsi::Value(v)));
}
size_t crossbind_v_from_str(uint8_t* w) {
    return (size_t)crossbindHandleOf(crossbindHelper("__crossbind_v_from_str").call(*jsRuntime, crossbindKeyFromWire(w)));
}
size_t crossbind_v_get_prop(size_t h, uint8_t* w) {
    return (size_t)crossbindHandleOf(crossbindHelper("__crossbind_v_get").call(*jsRuntime, crossbindVHandle(h), crossbindKeyFromWire(w)));
}
void crossbind_v_set_prop(size_t h, uint8_t* w, size_t v) {
    crossbindHelper("__crossbind_v_set").call(*jsRuntime, crossbindVHandle(h), crossbindKeyFromWire(w), crossbindVHandle(v));
}
int crossbind_v_kind(size_t h) {
    return (int)crossbindHelper("__crossbind_v_kind").call(*jsRuntime, crossbindVHandle(h)).getNumber();
}
double crossbind_v_as_f64(size_t h) {
    return crossbindHelper("__crossbind_v_as_num").call(*jsRuntime, crossbindVHandle(h)).getNumber();
}
int crossbind_v_as_bool(size_t h) {
    return (int)crossbindHelper("__crossbind_v_as_bool").call(*jsRuntime, crossbindVHandle(h)).getNumber();
}
uint8_t* crossbind_v_as_str(size_t h) {
    auto r = crossbindHelper("__crossbind_v_as_str").call(*jsRuntime, crossbindVHandle(h));
    return crossbindWireFromString(r.asString(*jsRuntime).utf8(*jsRuntime));
}
size_t crossbind_v_call(size_t f, unsigned argc, const size_t* argv) {
    try {
        jsi::Array args(*jsRuntime, argc);
        for (unsigned i = 0; i < argc; i += 1) args.setValueAtIndex(*jsRuntime, i, crossbindVHandle(argv[i]));
        auto r = crossbindHelper("__crossbind_v_call").call(*jsRuntime, crossbindVHandle(f), args);
        return (size_t)crossbindHandleOf(r);
    } catch (const jsi::JSError& e) {
        g_cbError = e.getMessage();
        g_hasCbError = true;
        return 0;
    } catch (const std::exception& e) {
        g_cbError = e.what();
        g_hasCbError = true;
        return 0;
    }
}
uint8_t* crossbind_v_cb_err_take() {
    if (!g_hasCbError) return nullptr;
    g_hasCbError = false;
    return crossbindWireFromString(g_cbError);
}
}

// Error raised by the producer (embind_rs::raise_err): Rust cannot unwind across the C-ABI, so
// it parks the message here and returns a sentinel; callInvoker below turns it into a JSError.
static thread_local std::string g_pendingError;
static thread_local bool g_hasPendingError = false;

static thread_local std::string g_pendingErrorCode;

// Typed arrays on the native runtime: the adapter builds the JS view and hands back its handle,
// one copy in each direction.
// jsi::Object carries no index setter, so the elements go into a jsi::Array first and the
// TypedArray constructor copies them (`new Uint8Array([...])`).
static jsi::Object typedArrayFrom(jsi::Runtime& rt, const char* ctor, jsi::Array values) {
    return rt.global().getPropertyAsFunction(rt, ctor)
        .callAsConstructor(rt, values).asObject(rt);
}

extern "C" size_t crossbind_v_bytes_to_js(const uint8_t* data, unsigned len) {
    auto& rt = *jsRuntime;
    auto values = jsi::Array(rt, (size_t)len);
    for (unsigned i = 0; i < len; ++i) values.setValueAtIndex(rt, i, jsi::Value((double)data[i]));
    auto array = typedArrayFrom(rt, "Uint8Array", std::move(values));
    return (size_t)crossbindHandleOf(crossbindHelper("__crossbind_v_from_value").call(rt, array));
}

extern "C" size_t crossbind_v_f64s_to_js(const double* data, unsigned len) {
    auto& rt = *jsRuntime;
    auto values = jsi::Array(rt, (size_t)len);
    for (unsigned i = 0; i < len; ++i) values.setValueAtIndex(rt, i, jsi::Value(data[i]));
    auto array = typedArrayFrom(rt, "Float64Array", std::move(values));
    return (size_t)crossbindHandleOf(crossbindHelper("__crossbind_v_from_value").call(rt, array));
}

extern "C" unsigned crossbind_v_typed_len(size_t h) {
    auto& rt = *jsRuntime;
    auto value = crossbindHelper("__crossbind_v_get").call(rt, crossbindVHandle(h), jsi::String::createFromAscii(rt, "length"));
    auto number = crossbindHelper("__crossbind_v_as_num").call(rt, value);
    return number.isNumber() ? (unsigned)number.getNumber() : 0;
}

extern "C" void crossbind_v_bytes_from_js(size_t h, uint8_t* out, unsigned len) {
    auto& rt = *jsRuntime;
    auto array = crossbindHelper("__crossbind_v_to_array").call(rt, crossbindVHandle(h)).asObject(rt).asArray(rt);
    for (unsigned i = 0; i < len; ++i) out[i] = (uint8_t)array.getValueAtIndex(rt, i).getNumber();
}

extern "C" void crossbind_v_f64s_from_js(size_t h, double* out, unsigned len) {
    auto& rt = *jsRuntime;
    auto array = crossbindHelper("__crossbind_v_to_array").call(rt, crossbindVHandle(h)).asObject(rt).asArray(rt);
    for (unsigned i = 0; i < len; ++i) out[i] = array.getValueAtIndex(rt, i).getNumber();
}

extern "C" void crossbind_embind_raise_error(uint8_t* w);

extern "C" void crossbind_embind_raise_error_coded(uint8_t* w, uint8_t* c) {
    crossbind_embind_raise_error(w);
    if (!c) { g_pendingErrorCode.clear(); return; }
    uint32_t len;
    std::memcpy(&len, c, 4);
    g_pendingErrorCode.assign((const char*)(c + 4), (size_t)len);
    std::free(c);
}

extern "C" void crossbind_embind_raise_error(uint8_t* w) {
    uint32_t len;
    std::memcpy(&len, w, 4);
    g_pendingError.assign((const char*)(w + 4), (size_t)len);
    g_hasPendingError = true;
    std::free(w);
}

// embind calls the invoker as `invoker(ctx, [this,] argsWired...)` (craftInvokerFunction:
// `invoker(fn, thisWired, arg0Wired, ...)`), so the incoming jsi args ARE the invoker's full C
// arg list, described 1:1 by sig[1..] (sig[0] is the return). We marshal each and forward.
// Reads the crate's `[u32 len][bytes]` string wire at `w`, builds a jsi::String, and frees the
// buffer (the consumer owns it). embind-jsi's std::string fromWireType passes a jsi::String through.
static jsi::Value wireStringToJsi(jsi::Runtime& rt, uint64_t w) {
    if (!w) return jsi::Value(jsi::String::createFromUtf8(rt, ""));
    uint8_t* buf = (uint8_t*)(uintptr_t)w;
    uint32_t len;
    std::memcpy(&len, buf, 4);
    std::string str((const char*)(buf + 4), (size_t)len);
    std::free(buf);
    return jsi::Value(jsi::String::createFromUtf8(rt, str));
}

static uint64_t readArg(jsi::Runtime& rt, const jsi::Value& v, char c) {
    if (c == 's') {
        // embind-jsi passes std::string args as a jsi::String; build the crate's [u32 len][bytes]
        // wire buffer here (freed by the caller after dispatch - the crate's from_wire only copies).
        if (!v.isString()) return 0;
        std::string str = v.getString(rt).utf8(rt);
        uint32_t len = (uint32_t)str.size();
        uint8_t* buf = (uint8_t*)std::malloc(4 + (size_t)len);
        std::memcpy(buf, &len, 4);
        std::memcpy(buf + 4, str.data(), len);
        return (uint64_t)(uintptr_t)buf;
    }
    if (c == 'd') {
        // The native crate carries a double as its bit pattern in a u64 slot (see WireType for f64),
        // keeping the invoker's C signature integer-class; convert the jsi number to bits here.
        double x = v.getNumber();
        uint64_t bits;
        std::memcpy(&bits, &x, 8);
        return bits;
    }
    // i64/u64 ('j'/'u') arrive as JS BigInt (embind bigint types), Number accepted as a courtesy;
    // both directions are raw 64-bit slots, so the unsigned bit copy is sign-correct either way.
    if (c == 'j' || c == 'u') {
        if (v.isBigInt()) return v.getBigInt(rt).getUint64(rt);
        // A Number is accepted only while it is an exact integer JS can represent; anything
        // else would be truncated silently, and a 64-bit slot deserves the exact value.
        double d = v.isNumber() ? v.getNumber() : 0;
        if (!v.isNumber() || d != std::trunc(d) || std::fabs(d) > 9007199254740991.0) {
            throw jsi::JSError(rt, "a 64-bit integer parameter takes a BigInt or a safe integer Number");
        }
        return (uint64_t)(int64_t)d;
    }
    // Optional args ('I'/'D'/'B'/'S'): undefined/null -> 0 (None); otherwise a heap cell this
    // adapter owns and frees after dispatch ('S' carries a plain string wire).
    if (c == 'I' || c == 'D' || c == 'B' || c == 'S') {
        if (v.isUndefined() || v.isNull()) return 0;
        if (c == 'S') return readArg(rt, v, 's');
        if (c == 'I') { int32_t x = (int32_t)v.getNumber(); void* p = std::malloc(4); std::memcpy(p, &x, 4); return (uint64_t)(uintptr_t)p; }
        if (c == 'D') { double x = v.getNumber(); void* p = std::malloc(8); std::memcpy(p, &x, 8); return (uint64_t)(uintptr_t)p; }
        uint8_t b = v.getBool() ? 1 : 0; void* p = std::malloc(1); std::memcpy(p, &b, 1); return (uint64_t)(uintptr_t)p;
    }
    // Pointers (this/handle/value-object wire) arrive as BigInt, int/bool/enum as Number; accept
    // either kind defensively so a host that boxed a pointer as a Number still dispatches correctly.
    if (c == 'p') return v.isBigInt() ? v.getBigInt(rt).getUint64(rt) : v.isNumber() ? (uint64_t)(int64_t)v.getNumber() : 0;
    // 'i': ints and enums arrive as numbers, bools as booleans (the int wire carries 0/1). Reading
    // a BigInt out of anything else is undefined behaviour (Hermes dies in cloneBigInt), so every
    // other value is 0.
    if (v.isBool()) return v.getBool() ? 1 : 0;
    if (v.isNumber()) return (uint64_t)(int64_t)v.getNumber();
    return v.isBigInt() ? v.getBigInt(rt).getUint64(rt) : 0;
}

// Bounded-dispatch: every wire kind is integer-class in the invoker's C signature (pointers and
// ints natively; doubles as bit patterns in u64 - see WireType for f64), so uint64-slot casts are
// ABI-correct on every native ABI. No FP registers, no libffi; the only bound is the arity cap.
static jsi::Value callInvoker(jsi::Runtime& rt, const std::string& sig, void* invoker,
                              const jsi::Value* a, size_t count, uint64_t ctx, bool prepend) {
    const char ret = sig[0];
    const int total = (int)sig.size() - 1;  // C args the raw invoker takes (sig[1..])

    // s[0..total-1] are the raw invoker's C args. When prepend, sig[1] is the baked target pointer
    // (embind sliced it off), so the jsi args a[0..] fill sig[2..]; otherwise a[0..] fill sig[1..].
    // Widest call: a baked target + `this` + six declared arguments.
    uint64_t s[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    int base = 0;
    if (prepend) { s[0] = ctx; base = 1; }
    // A call with fewer JS args than the signature must not read past the argument array.
    for (int j = base; j < total && j < 8; ++j) s[j] = (size_t)(j - base) < count ? readArg(rt, a[j - base], sig[1 + j]) : 0;

    uint64_t r = 0;
    if (ret == 'v') {
        switch (total) {
            case 0: ((void(*)())invoker)(); break;
            case 1: ((void(*)(uint64_t))invoker)(s[0]); break;
            case 2: ((void(*)(uint64_t, uint64_t))invoker)(s[0], s[1]); break;
            case 3: ((void(*)(uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2]); break;
            case 4: ((void(*)(uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3]); break;
            case 5: ((void(*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3], s[4]); break;
            case 6: ((void(*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3], s[4], s[5]); break;
            case 7: ((void(*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3], s[4], s[5], s[6]); break;
            default: ((void(*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]); break;
        }
    } else {
        switch (total) {
            case 0: r = ((uint64_t(*)())invoker)(); break;
            case 1: r = ((uint64_t(*)(uint64_t))invoker)(s[0]); break;
            case 2: r = ((uint64_t(*)(uint64_t, uint64_t))invoker)(s[0], s[1]); break;
            case 3: r = ((uint64_t(*)(uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2]); break;
            case 4: r = ((uint64_t(*)(uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3]); break;
            case 5: r = ((uint64_t(*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3], s[4]); break;
            case 6: r = ((uint64_t(*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3], s[4], s[5]); break;
            case 7: r = ((uint64_t(*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3], s[4], s[5], s[6]); break;
            default: r = ((uint64_t(*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t))invoker)(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]); break;
        }
    }

    // The consumer owns each incoming std::string arg buffer and optional arg cell; free them
    // now that the crate has copied.
    for (int j = base; j < total && j < 8; ++j) {
        const char cj = sig[1 + j];
        if (cj == 's' || cj == 'S' || cj == 'I' || cj == 'D' || cj == 'B') std::free((void*)(uintptr_t)s[j]);
    }

    // A shim raised (Result::Err): drop the sentinel return and surface a real JS exception.
    // The error is BUILT IN JS, not thrown from here: Hermes re-wraps a C++ exception escaping a
    // host function ("Exception in HostFunction: ..."), which loses both the plain message and the
    // `code` property. The runtime's dyn-caller rethrows what this parks, so the object JS sees is
    // a real Error with the binding's own message and code.
    if (g_hasPendingError) {
        g_hasPendingError = false;
        if (ret == 's' && r) std::free((void*)(uintptr_t)r);
        std::string message = std::move(g_pendingError);
        std::string code = std::move(g_pendingErrorCode);
        g_pendingError.clear();
        g_pendingErrorCode.clear();
        crossbindHelper("__crossbind_park_error").call(
            rt, jsi::String::createFromUtf8(rt, message),
            code.empty() ? jsi::Value::undefined() : jsi::Value(jsi::String::createFromUtf8(rt, code)));
        return jsi::Value::undefined();
    }

    if (ret == 'v') return jsi::Value::undefined();
    if (ret == 's') return wireStringToJsi(rt, r);  // the crate returned a [u32 len][bytes] buffer
    // Optional returns ('I'/'D'/'B'/'S'): nullable heap cell - 0 is None (null), otherwise
    // the malloc'd inner value ('S' points at a plain string wire); freed here after reading.
    if (ret == 'I' || ret == 'D' || ret == 'B' || ret == 'S') {
        if (!r) return jsi::Value::null();
        if (ret == 'S') return wireStringToJsi(rt, r);
        uint8_t* cell = (uint8_t*)(uintptr_t)r;
        jsi::Value out = jsi::Value::undefined();
        if (ret == 'I') { int32_t v; std::memcpy(&v, cell, 4); out = jsi::Value((double)v); }
        else if (ret == 'D') { double v; std::memcpy(&v, cell, 8); out = jsi::Value(v); }
        else { out = jsi::Value(cell[0] != 0); }
        std::free(cell);
        return out;
    }
    if (ret == 'p') return jsi::Value(jsi::BigInt::fromUint64(rt, r));
    if (ret == 'j') return jsi::Value(jsi::BigInt::fromInt64(rt, (int64_t)r));
    if (ret == 'u') return jsi::Value(jsi::BigInt::fromUint64(rt, r));
    if (ret == 'd') { double x; std::memcpy(&x, &r, 8); return jsi::Value(x); }  // bits -> number
    return jsi::Value((double)(int32_t)r); // 'i'
}

// prepend=true bakes `ctx` (the target fn pointer, sliced off by embind) as the invoker's first C
// arg; the jsi args then fill the rest. prepend=false maps the jsi args to sig[1..] directly.
static jsi::Function wrapInvoker(const std::string& name, const char* sigC, void* invoker,
                                 uint64_t ctx = 0, bool prepend = false) {
    std::string sig = sigC;
    auto& rt = *jsRuntime;
    std::string dbg = name + "_" + sig;
    unsigned jsArgc = (unsigned)(sig.size() - 1 - (prepend ? 1 : 0)); // args embind actually passes
    return jsi::Function::createFromHostFunction(
        rt, jsi::PropNameID::forAscii(rt, dbg), jsArgc,
        [sig, invoker, ctx, prepend](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t count) -> jsi::Value {
            return callInvoker(rt, sig, invoker, a, count, ctx, prepend);
        });
}

extern "C" {

void crossbind_embind_register_bindings(void (*init)()) {
    new InitFunc(init); // embind-jsi defers this until the JSI runtime is installed
}

void crossbind_embind_register_class(
    CrossbindTid cls, CrossbindTid ptr_ty, CrossbindTid const_ptr_ty, CrossbindTid base,
    const char* gat_sig, CrossbindFn get_actual_type,
    const char* up_sig, CrossbindFn upcast, const char* down_sig, CrossbindFn downcast,
    const char* name, const char* dtor_sig, CrossbindFn dtor) {
    // Our producer has no base class, so upcast/downcast are never used at runtime; embind-jsi
    // still requires valid jsi::Function& slots with valid signatures. Reuse the getActualType
    // function + its signature for all three (the crate passes null up/down sigs, which would
    // abort in readLatin1String). base stays null.
    (void)up_sig; (void)down_sig; (void)upcast; (void)downcast;
    auto gat = wrapInvoker(std::string(name) + "_gat", gat_sig, get_actual_type);
    auto up = wrapInvoker(std::string(name) + "_up", gat_sig, get_actual_type);
    auto dn = wrapInvoker(std::string(name) + "_dn", gat_sig, get_actual_type);
    auto dt = wrapInvoker(std::string(name) + "_dtor", dtor_sig, dtor);
    _embind_register_class(cls, ptr_ty, const_ptr_ty, base, gat_sig, gat, gat_sig, up, gat_sig, dn, name, dtor_sig, dt);
}

void crossbind_embind_register_class_constructor(
    CrossbindTid cls, unsigned argc, const CrossbindTid* argTypes,
    const char* sig, CrossbindFn invoker, CrossbindFn ctor) {
    auto fn = wrapInvoker("ctor", sig, invoker, (uint64_t)ctor, true); // bake the sliced-off constructor target
    _embind_register_class_constructor(cls, argc, argTypes, sig, fn, ctor);
}

void crossbind_embind_register_class_function(
    CrossbindTid cls, const char* name, unsigned argc, const CrossbindTid* argTypes,
    const char* sig, CrossbindFn invoker, void* ctx,
    unsigned isPureVirtual, bool isAsync, bool /*isNonnullReturn dropped*/) {
    auto fn = wrapInvoker(name, sig, invoker, (uint64_t)ctx, true); // bake the sliced-off method target
    _embind_register_class_function(cls, name, argc, argTypes, sig, fn, ctx, isPureVirtual, isAsync);
}

void crossbind_embind_register_class_class_function(
    CrossbindTid cls, const char* name, unsigned argc, const CrossbindTid* argTypes,
    const char* sig, CrossbindFn invoker, CrossbindFn method, bool isAsync, bool /*isNonnullReturn dropped*/) {
    auto fn = wrapInvoker(name, sig, invoker, (uint64_t)method, true); // bake the sliced-off static target
    _embind_register_class_class_function(cls, name, argc, argTypes, sig, fn, method, isAsync);
}

void crossbind_embind_register_function(
    const char* name, unsigned argc, const CrossbindTid* argTypes,
    const char* sig, CrossbindFn invoker, CrossbindFn function, bool isAsync, bool /*isNonnullReturn dropped*/) {
    auto fn = wrapInvoker(name, sig, invoker, (uint64_t)function, true); // free fns are sliced too
    _embind_register_function(name, argc, argTypes, sig, fn, function, isAsync);
}

void crossbind_embind_register_smart_ptr(
    CrossbindTid ptr_ty, CrossbindTid pointee_ty, const char* name, int sharing,
    const char* gp_sig, CrossbindFn get_pointee, const char* ctor_sig, CrossbindFn constructor,
    const char* share_sig, CrossbindFn share, const char* dtor_sig, CrossbindFn destructor) {
    auto gp = wrapInvoker(std::string(name) + "_gp", gp_sig, get_pointee);
    auto ct = wrapInvoker(std::string(name) + "_ctor", ctor_sig, constructor);
    auto sh = wrapInvoker(std::string(name) + "_share", share_sig, share);
    auto dt = wrapInvoker(std::string(name) + "_dtor", dtor_sig, destructor);
    _embind_register_smart_ptr(ptr_ty, pointee_ty, name, (emscripten::sharing_policy)sharing, gp_sig, gp, ctor_sig, ct, share_sig, sh, dtor_sig, dt);
}

void crossbind_embind_register_enum(CrossbindTid enum_ty, const char* name, size_t size, bool is_signed, int /*policy dropped*/) {
    _embind_register_enum(enum_ty, name, size, is_signed);
}
void crossbind_embind_register_enum_value(CrossbindTid enum_ty, const char* value_name, int value) {
    _embind_register_enum_value(enum_ty, value_name, value);
}

void crossbind_embind_register_class_property(CrossbindTid cls, const char* name,
    CrossbindTid getter_ty, const char* getter_sig, CrossbindFn getter, void* getter_ctx,
    CrossbindTid setter_ty, const char* setter_sig, CrossbindFn setter, void* setter_ctx) {
    // Not sliced: the fork's property accessors call `getter(getterContext, ptr)` and
    // `setter(setterContext, ptr, value)`, so both contexts arrive as ordinary arguments
    // (unlike a method invoker, where embind slices the target off).
    auto get = wrapInvoker(std::string(name) + "_get", getter_sig, getter);
    auto set = wrapInvoker(std::string(name) + "_set", setter_sig, setter);
    _embind_register_class_property(cls, name, getter_ty, getter_sig, get, getter_ctx,
        setter_ty, setter_sig, set, setter_ctx);
}
void crossbind_embind_register_constant(const char* name, CrossbindTid ty, double value) {
    // The fork takes the constant as a jsi::Value; every kind we offer (int, float, bool) reads
    // back through its own fromWireType from a plain number.
    _embind_register_constant(name, ty, jsi::Value(value));
}
void crossbind_embind_register_value_object(CrossbindTid struct_ty, const char* name,
    const char* ctor_sig, CrossbindFn ctor, const char* dtor_sig, CrossbindFn dtor) {
    auto ct = wrapInvoker(std::string(name) + "_ctor", ctor_sig, ctor);
    auto dt = wrapInvoker(std::string(name) + "_dtor", dtor_sig, dtor);
    _embind_register_value_object(struct_ty, name, ctor_sig, ct, dtor_sig, dt);
}
void crossbind_embind_register_value_object_field(CrossbindTid struct_ty, const char* field_name,
    CrossbindTid getter_ret, const char* getter_sig, CrossbindFn getter, void* getter_ctx,
    CrossbindTid setter_arg, const char* setter_sig, CrossbindFn setter, void* setter_ctx) {
    auto g = wrapInvoker(std::string(field_name) + "_get", getter_sig, getter);
    auto s = wrapInvoker(std::string(field_name) + "_set", setter_sig, setter);
    _embind_register_value_object_field(struct_ty, field_name, getter_ret, getter_sig, g, getter_ctx, setter_arg, setter_sig, s, setter_ctx);
}
void crossbind_embind_finalize_value_object(CrossbindTid struct_ty) {
    _embind_finalize_value_object(struct_ty);
}

} // extern "C"
