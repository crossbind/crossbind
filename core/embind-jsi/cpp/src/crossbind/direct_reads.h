// An optional JSI runtime interface: reads an argument's contents straight from the engine value,
// without reading a typed array's buffer, byteOffset and length or cloning a BigInt first. The
// Node-API runtime implements it; a runtime that does not (Hermes) answers castInterface with null,
// and callers take the JSI path.
#pragma once

#include <jsi/jsi.h>
#include <cstddef>
#include <cstdint>

namespace crossbind {

struct IDirectReads : facebook::jsi::ICast {
    static constexpr facebook::jsi::UUID uuid{0xdf916ba1, 0xbbee, 0x46ac, 0x9251, 0xf0fcdcdb3697};

    // False when `value` is not a typed array; `length` counts elements, not bytes.
    virtual bool typedArrayElements(const facebook::jsi::Value& value, void*& data, size_t& length) = 0;

    // False when `value` is not a BigInt. `bits` are its low 64 bits, as jsi::BigInt::getUint64
    // gives; `lossless` says whether it fits, which jsi::BigInt::asUint64 requires.
    virtual bool bigIntToUint64(const facebook::jsi::Value& value, uint64_t& bits, bool& lossless) = 0;

    // The same for int64_t, as jsi::BigInt::getInt64 and asInt64 read it.
    virtual bool bigIntToInt64(const facebook::jsi::Value& value, int64_t& bits, bool& lossless) = 0;

 protected:
    ~IDirectReads() = default;
};

}
