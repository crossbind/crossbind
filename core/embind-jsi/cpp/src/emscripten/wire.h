/*
 * Copyright 2012 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

#pragma once

#if __cplusplus < 201103L
#error Including <./wire.h> requires building with -std=c++11 or newer!
#endif

// A value moving between JavaScript and C++ has three representations:
// - The original JS value: a String
// - The native on-the-wire value: a stack-allocated char*, say
// - The C++ value: std::string
//
// We'll call the on-the-wire type WireType.

#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>

#include <jsi/jsi.h>

// embind registers std::basic_string<unsigned char> as the raw-byte counterpart to UTF-8
// std::string, but the standard has never defined std::char_traits for unsigned char. libc++ used
// to instantiate the primary template anyway; from the release NDK r30 ships it static_asserts
// instead, so merely naming the type stops compiling. Supplying the traits keeps the binding and
// costs nothing on the toolchains that did not need it.
namespace std {
template <>
struct char_traits<unsigned char> {
    using char_type = unsigned char;
    using int_type = int;
    using off_type = streamoff;
    using pos_type = streampos;
    using state_type = mbstate_t;

    static constexpr void assign(char_type& a, const char_type& b) noexcept { a = b; }
    static constexpr bool eq(char_type a, char_type b) noexcept { return a == b; }
    static constexpr bool lt(char_type a, char_type b) noexcept { return a < b; }

    static int compare(const char_type* a, const char_type* b, size_t n) {
        return n == 0 ? 0 : __builtin_memcmp(a, b, n);
    }
    static size_t length(const char_type* s) {
        size_t n = 0;
        while (s[n]) ++n;
        return n;
    }
    static const char_type* find(const char_type* s, size_t n, const char_type& c) {
        for (size_t i = 0; i < n; ++i)
            if (s[i] == c) return s + i;
        return nullptr;
    }
    static char_type* move(char_type* d, const char_type* s, size_t n) {
        return n == 0 ? d : static_cast<char_type*>(__builtin_memmove(d, s, n));
    }
    static char_type* copy(char_type* d, const char_type* s, size_t n) {
        return n == 0 ? d : static_cast<char_type*>(__builtin_memcpy(d, s, n));
    }
    static char_type* assign(char_type* d, size_t n, char_type c) {
        for (size_t i = 0; i < n; ++i) d[i] = c;
        return d;
    }

    static constexpr int_type not_eof(int_type c) noexcept { return eq_int_type(c, eof()) ? ~eof() : c; }
    static constexpr char_type to_char_type(int_type c) noexcept { return char_type(c); }
    static constexpr int_type to_int_type(char_type c) noexcept { return int_type(c); }
    static constexpr bool eq_int_type(int_type a, int_type b) noexcept { return a == b; }
    static constexpr int_type eof() noexcept { return int_type(EOF); }
};
} // namespace std

// #include <android/log.h>
// #define APPNAME "react-native-crossbind"

#define EMSCRIPTEN_ALWAYS_INLINE __attribute__((always_inline))

#ifndef EMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES
#define EMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES 1
#endif

namespace emscripten {

#if EMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES
constexpr bool has_unbound_type_names = true;
#else
constexpr bool has_unbound_type_names = false;
#endif

namespace internal {

// JS hands native pointers over as BigInt addresses, but a null pointer arrives as the number 0
// and enum values as plain numbers: take both spellings.
inline uint64_t addressFromValue(facebook::jsi::Runtime& rt, const facebook::jsi::Value& v) {
    if (v.isNumber()) return static_cast<uint64_t>(v.asNumber());
    if (v.isNull() || v.isUndefined()) return 0;
    return v.asBigInt(rt).asUint64(rt);
}

inline int64_t integerFromValue(facebook::jsi::Runtime& rt, const facebook::jsi::Value& v) {
    if (v.isNumber()) return static_cast<int64_t>(v.asNumber());
    return v.asBigInt(rt).asInt64(rt);
}

typedef const void* TYPEID;

// Defined in bind.cpp: registers a JS-side ArrayBuffer window covering `ptr` so
// heap reads on values we hand out by pointer cannot miss every window.
void ensureWindowFor(uint64_t ptr);

// We don't need the full std::type_info implementation.  We
// just need a unique identifier per type and polymorphic type
// identification.

template<typename T>
struct CanonicalizedID {
    static char c;
    static constexpr TYPEID get() {
        return &c;
    }
};

template<typename T>
char CanonicalizedID<T>::c;

template<typename T>
struct Canonicalized {
    typedef typename std::remove_cv<typename std::remove_reference<T>::type>::type type;
};

template<typename T>
struct LightTypeID {
    static constexpr TYPEID get() {
        if (has_unbound_type_names) {
#if __has_feature(cxx_rtti)
            return &typeid(T);
#else
            static_assert(!has_unbound_type_names,
                "Unbound type names are illegal with RTTI disabled. "
                "Either add -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 to or remove -fno-rtti "
                "from the compiler arguments");
#endif
        }

        typedef typename Canonicalized<T>::type C;
        return CanonicalizedID<C>::get();
    }
};

template<typename T>
constexpr TYPEID getLightTypeID(const T& value) {
    if (has_unbound_type_names) {
#if __has_feature(cxx_rtti)
        return &typeid(value);
#else
        static_assert(!has_unbound_type_names,
            "Unbound type names are illegal with RTTI disabled. "
            "Either add -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 to or remove -fno-rtti "
            "from the compiler arguments");
#endif
    }
    return LightTypeID<T>::get();
}

// The second typename is an unused stub so it's possible to
// specialize groups of classes via SFINAE.
template<typename T, typename = void>
struct TypeID {
    static constexpr TYPEID get() {
        return LightTypeID<T>::get();
    }
};

template<typename T>
struct TypeID<std::unique_ptr<T>> {
    static constexpr TYPEID get() {
        return TypeID<T>::get();
    }
};

template<typename T>
struct TypeID<T*> {
    static_assert(!std::is_pointer<T*>::value, "Implicitly binding raw pointers is illegal.  Specify allow_raw_pointer<arg<?>>");
};

template<typename T>
struct AllowedRawPointer {
};

template<typename T>
struct TypeID<AllowedRawPointer<T>> {
    static constexpr TYPEID get() {
        return LightTypeID<T*>::get();
    }
};

// ExecutePolicies<>

template<typename... Policies>
struct ExecutePolicies;

template<>
struct ExecutePolicies<> {
    template<typename T, int Index>
    struct With {
        typedef T type;
    };
};

template<typename Policy, typename... Remaining>
struct ExecutePolicies<Policy, Remaining...> {
    template<typename T, int Index>
    struct With {
        typedef typename Policy::template Transform<
            typename ExecutePolicies<Remaining...>::template With<T, Index>::type,
            Index
        >::type type;
    };
};

// TypeList<>

template<typename...>
struct TypeList {};

// Cons :: T, TypeList<types...> -> Cons<T, types...>

template<typename First, typename TypeList>
struct Cons;

template<typename First, typename... Rest>
struct Cons<First, TypeList<Rest...>> {
    typedef TypeList<First, Rest...> type;
};

// Apply :: T, TypeList<types...> -> T<types...>

template<template<typename...> class Output, typename TypeList>
struct Apply;

template<template<typename...> class Output, typename... Types>
struct Apply<Output, TypeList<Types...>> {
    typedef Output<Types...> type;
};

// MapWithIndex_

template<template<size_t, typename> class Mapper, size_t CurrentIndex, typename... Args>
struct MapWithIndex_;

template<template<size_t, typename> class Mapper, size_t CurrentIndex, typename First, typename... Rest>
struct MapWithIndex_<Mapper, CurrentIndex, First, Rest...> {
    typedef typename Cons<
        typename Mapper<CurrentIndex, First>::type,
        typename MapWithIndex_<Mapper, CurrentIndex + 1, Rest...>::type
        >::type type;
};

template<template<size_t, typename> class Mapper, size_t CurrentIndex>
struct MapWithIndex_<Mapper, CurrentIndex> {
    typedef TypeList<> type;
};

template<template<typename...> class Output, template<size_t, typename> class Mapper, typename... Args>
struct MapWithIndex {
    typedef typename internal::Apply<
        Output,
        typename MapWithIndex_<Mapper, 0, Args...>::type
    >::type type;
};


template<typename ArgList>
struct ArgArrayGetter;

template<typename... Args>
struct ArgArrayGetter<TypeList<Args...>> {
    static const TYPEID* get() {
        static constexpr TYPEID types[] = { TypeID<Args>::get()... };
        return types;
    }
};

// WithPolicies<...>::ArgTypeList<...>

template<typename... Policies>
struct WithPolicies {
    template<size_t Index, typename T>
    struct MapWithPolicies {
        typedef typename ExecutePolicies<Policies...>::template With<T, Index>::type type;
    };

    template<typename... Args>
    struct ArgTypeList {
        unsigned getCount() const {
            return sizeof...(Args);
        }

        const TYPEID* getTypes() const {
            return ArgArrayGetter<
                typename MapWithIndex<TypeList, MapWithPolicies, Args...>::type
            >::get();
        }
    };
};

// BindingType<T>

// The second typename is an unused stub so it's possible to
// specialize groups of classes via SFINAE.
template<typename T, typename = void>
struct BindingType;

#define EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(type)                              \
template<>                                                                              \
struct BindingType<type> {                                                              \
    typedef type WireType;                                                              \
    typedef const facebook::jsi::Value WireType2;                                       \
                                                                                        \
    static WireType toWireType(type b) {                                                \
        return b;                                                                       \
    }                                                                                   \
    static type fromWireType(WireType wt) {                                             \
        return wt;                                                                      \
    }                                                                                   \
                                                                                        \
    static WireType2 toWireType2(facebook::jsi::Runtime& rt, WireType b) {              \
        return WireType2((double) b);                                                   \
    }                                                                                   \
    static WireType fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {          \
        return (WireType) wt.getNumber();                                               \
    }                                                                                   \
};


EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(char);
EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(signed char);
EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(unsigned char);
EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(signed short);
EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(unsigned short);
EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(int);
// EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(signed int);
EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(unsigned int);
// EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(signed long);
// EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(unsigned long);
EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(float);
EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE_NUMBER(double);
// EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE(int64_t);
// EMSCRIPTEN_DEFINE_NATIVE_BINDING_TYPE(uint64_t);

template<>
struct BindingType<void> {
    typedef void WireType;
    typedef void WireType2;
};

template<>
struct BindingType<bool> {
    typedef bool WireType;
    typedef const facebook::jsi::Value WireType2;
    static WireType toWireType(bool b) {
        return b;
    }
    static bool fromWireType(WireType wt) {
        return wt;
    }

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, WireType b) {
        return WireType2(b);
    }
    static WireType fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {
        return wt.getBool();
    }
};

template<>
struct BindingType<int64_t> {
    typedef int64_t WireType;
    typedef const facebook::jsi::Value WireType2;

    static WireType toWireType(WireType b) {
        return b;
    }
    static WireType fromWireType(WireType wt) {
        return wt;
    }

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, WireType b) {
        return facebook::jsi::BigInt::fromInt64(rt, b);
    }
    static WireType fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {
        return wt.asBigInt(rt).asInt64(rt);
    }
};

template<>
struct BindingType<uint64_t> {
    typedef uint64_t WireType;
    typedef const facebook::jsi::Value WireType2;

    static WireType toWireType(WireType b) {
        return b;
    }
    static WireType fromWireType(WireType wt) {
        return wt;
    }

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, WireType b) {
        return facebook::jsi::BigInt::fromUint64(rt, b);
    }
    static WireType fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {
        return wt.asBigInt(rt).asUint64(rt);
    }
};

    template<>
    struct BindingType<facebook::jsi::Value> {
        typedef const facebook::jsi::Value WireType;
        typedef const facebook::jsi::Value WireType2;

        static WireType2 toWireType2(facebook::jsi::Runtime& rt, WireType& b) {
            return WireType2(rt, b);
        }
        static WireType fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {
            return WireType(rt, wt);
        }
    };

// jsi strings cross as UTF-8, so a std::u16string (embind's byte-preserving string) is transcoded; every code unit of
// well-formed UTF-16 survives the round trip.
inline std::string utf16ToUtf8(const std::u16string& text) {
    std::string out;
    out.reserve(text.size());
    for (size_t i = 0; i < text.size(); ++i) {
        char32_t cp = text[i];
        if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < text.size() && text[i + 1] >= 0xDC00 && text[i + 1] <= 0xDFFF) {
            cp = 0x10000 + ((cp - 0xD800) << 10) + (text[++i] - 0xDC00);
        } else if (cp >= 0xD800 && cp <= 0xDFFF) {
            cp = 0xFFFD;
        }
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else if (cp < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }
    return out;
}

inline std::u16string utf8ToUtf16(const std::string& text) {
    std::u16string out;
    out.reserve(text.size());
    size_t i = 0;
    while (i < text.size()) {
        unsigned char lead = static_cast<unsigned char>(text[i]);
        size_t extra = lead < 0x80 ? 0 : (lead >> 5) == 0x6 ? 1 : (lead >> 4) == 0xE ? 2 : (lead >> 3) == 0x1E ? 3 : 4;
        char32_t cp = extra == 0 ? lead : extra == 1 ? (lead & 0x1F) : extra == 2 ? (lead & 0x0F) : (lead & 0x07);
        bool valid = extra < 4 && i + extra < text.size();
        for (size_t k = 1; valid && k <= extra; ++k) {
            unsigned char next = static_cast<unsigned char>(text[i + k]);
            valid = (next >> 6) == 0x2;
            cp = (cp << 6) | (next & 0x3F);
        }
        if (!valid) {
            out.push_back(0xFFFD);
            ++i;
            continue;
        }
        i += extra + 1;
        if (cp >= 0x10000) {
            cp -= 0x10000;
            out.push_back(static_cast<char16_t>(0xD800 + (cp >> 10)));
            out.push_back(static_cast<char16_t>(0xDC00 + (cp & 0x3FF)));
        } else {
            out.push_back(static_cast<char16_t>(cp));
        }
    }
    return out;
}

template<typename T>
struct BindingType<std::basic_string<T>> {
    using String = std::basic_string<T>;
    static_assert(std::is_trivially_copyable<T>::value, "basic_string elements are memcpy'd");
    typedef struct {
        size_t length;
        T data[1]; // trailing data
    }* WireType;
    typedef const facebook::jsi::Value WireType2;
    static WireType toWireType(const String& v) {
        WireType wt = (WireType)malloc(sizeof(size_t) + v.length() * sizeof(T));
        wt->length = v.length();
        memcpy(wt->data, v.data(), v.length() * sizeof(T));
        return wt;
    }
    static String fromWireType(WireType v) {
        return String(v->data, v->length);
    }

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, String v) {
        if constexpr (std::is_same_v<T, char16_t>) {
            return facebook::jsi::String::createFromUtf8(rt, utf16ToUtf8(v));
        } else {
            return facebook::jsi::String::createFromUtf8(rt, v);
        }
    }
    static String fromWireType2(facebook::jsi::Runtime& rt, WireType2& v) {
        if constexpr (std::is_same_v<T, char16_t>) {
            return utf8ToUtf16(v.getString(rt).utf8(rt));
        } else {
            return v.getString(rt).utf8(rt);
        }
    }
};

template<typename T>
struct BindingType<std::optional<T>> {
    typedef std::optional<T> WireType;
    typedef const facebook::jsi::Value WireType2;

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, const std::optional<T>& v) {
        if (!v.has_value()) return facebook::jsi::Value::undefined();
        return WireType2(rt, BindingType<T>::toWireType2(rt, *v));
    }
    static std::optional<T> fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {
        if (wt.isUndefined() || wt.isNull()) return std::nullopt;
        return BindingType<T>::fromWireType2(rt, wt);
    }
};

template<typename T>
struct BindingType<const T> : public BindingType<T> {
};

template<typename T>
struct BindingType<T&> : public BindingType<T> {
};

template<typename T>
struct BindingType<const T&> : public BindingType<T> {
};

template<typename T>
struct BindingType<T&&> {
    typedef typename BindingType<T>::WireType WireType;
    typedef const facebook::jsi::Value WireType2;

    static WireType toWireType(const T& v) {
        return BindingType<T>::toWireType(v);
    }
    static T fromWireType(WireType wt) {
        return BindingType<T>::fromWireType(wt);
    }

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, const T& v) {
        return BindingType<T>::toWireType2(rt, v);
    }
    static T fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {
        return BindingType<T>::fromWireType2(rt, wt);
    }
};

template<typename T>
struct BindingType<T*> {
    typedef T* WireType;
    typedef const facebook::jsi::Value WireType2;

    static WireType toWireType(T* p) {
        return p;
    }
    static T* fromWireType(WireType wt) {
        return wt;
    }

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, WireType b) {
        return facebook::jsi::BigInt::fromUint64(rt, reinterpret_cast<uint64_t>(b));
    }
    static WireType fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {
        return (WireType) addressFromValue(rt, wt);
    }
};

template<typename T>
struct GenericBindingType {
    typedef typename std::remove_reference<T>::type ActualT;
    typedef ActualT* WireType;
    typedef const facebook::jsi::Value WireType2;

    static WireType toWireType(const T& v) {
        return new T(v);
    }

    static WireType toWireType(T&& v) {
        return new T(std::forward<T>(v));
    }

    static ActualT& fromWireType(WireType p) {
        return *p;
    }

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, const T& v) {
        // By-value returns allocate fresh heap blocks; without a covering window JS-side
        // memory reads on the new object die with "Heap error ... no covering window".
        uint64_t ptr = reinterpret_cast<uint64_t>(new T(v));
        ensureWindowFor(ptr);
        return facebook::jsi::BigInt::fromUint64(rt, ptr);
    }
    static WireType2 toWireType2(facebook::jsi::Runtime& rt, T&& v) {
        uint64_t ptr = reinterpret_cast<uint64_t>(new T(std::forward<T>(v)));
        ensureWindowFor(ptr);
        return facebook::jsi::BigInt::fromUint64(rt, ptr);
    }

    static ActualT& fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {
        return *reinterpret_cast<WireType>(wt.getBigInt(rt).getUint64(rt));
    }
};

template<typename T>
struct GenericBindingType<std::unique_ptr<T>> {
    typedef typename BindingType<T*>::WireType WireType;
    typedef const facebook::jsi::Value WireType2;

    static WireType toWireType(std::unique_ptr<T> p) {
        return BindingType<T*>::toWireType(p.release());
    }

    static std::unique_ptr<T> fromWireType(WireType wt) {
        return std::unique_ptr<T>(BindingType<T*>::fromWireType(wt));
    }

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, std::unique_ptr<T> p) {
        return BindingType<T*>::toWireType2(rt, p.release());
    }

    static std::unique_ptr<T> fromWireType2(facebook::jsi::Runtime& rt, WireType2& wt) {
        return std::unique_ptr<T>(BindingType<T*>::fromWireType2(rt, wt));
    }
};

template<typename Enum>
struct EnumBindingType {
    typedef Enum WireType;
    typedef const facebook::jsi::Value WireType2;

    static WireType toWireType(Enum v) {
        return v;
    }
    static Enum fromWireType(WireType v) {
        return v;
    }

    static WireType2 toWireType2(facebook::jsi::Runtime& rt, Enum v) {
        return WireType2((int) v);
    }
    static Enum fromWireType2(facebook::jsi::Runtime& rt, WireType2& v) {
        return (WireType) integerFromValue(rt, v);
    }
};

// catch-all generic binding
template<typename T, typename>
struct BindingType : std::conditional<
    std::is_enum<T>::value,
    EnumBindingType<T>,
    GenericBindingType<T> >::type
{};

template<typename T>
auto toWireType(T&& v) -> typename BindingType<T>::WireType {
    return BindingType<T>::toWireType(std::forward<T>(v));
}

template<typename T>
constexpr bool typeSupportsMemoryView() {
    return (std::is_floating_point<T>::value &&
                (sizeof(T) == 4 || sizeof(T) == 8)) ||
            (std::is_integral<T>::value &&
                (sizeof(T) == 1 || sizeof(T) == 2 ||
                 sizeof(T) == 4 || sizeof(T) == 8));
}

} // namespace internal

template<typename ElementType>
struct memory_view {
    memory_view() = delete;
    explicit memory_view(size_t size, const ElementType* data)
        : size(size)
        , data(data)
    {}

    const size_t size; // in elements, not bytes
    const void* const data;
};

// Note that 'data' is marked const just so it can accept both
// const and nonconst pointers.  It is certainly possible for
// JavaScript to modify the C heap through the typed array given,
// as it merely aliases the C heap.
template<typename T>
inline memory_view<T> typed_memory_view(size_t size, const T* data) {
    static_assert(internal::typeSupportsMemoryView<T>(),
        "type of typed_memory_view is invalid");
    return memory_view<T>(size, data);
}

namespace internal {

template<typename ElementType>
struct BindingType<memory_view<ElementType>> {
    // This non-word-sized WireType only works because I
    // happen to know that clang will pass aggregates as
    // pointers to stack elements and we never support
    // converting JavaScript typed arrays back into
    // memory_view.  (That is, fromWireType is not implemented
    // on the C++ side, nor is toWireType implemented in
    // JavaScript.)
    typedef memory_view<ElementType> WireType;
    static WireType toWireType(const memory_view<ElementType>& mv) {
        return mv;
    }
};

} // namespace internal

} // namespace emscripten