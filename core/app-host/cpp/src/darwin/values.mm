#include "values.h"

#include <cstdint>

namespace {

// As deep as the host reads JSON, and of as many values at most: what another device hands over goes no further, as a
// property list's containers may share their members, which then count each time.
constexpr int MAX_DEPTH = 64;
constexpr size_t MAX_VALUES = 10000;

crossbind::Value valueOf(id object, int depth, size_t &left) {
    using crossbind::Value;
    if (depth > MAX_DEPTH || left == 0) return Value();
    left -= 1;
    if ([object isKindOfClass:NSString.class]) return Value(textOf(object));
    // A boolean is a number of its own type.
    if ([object isKindOfClass:NSNumber.class]) {
        return CFGetTypeID((__bridge CFTypeRef)object) == CFBooleanGetTypeID() ? Value(static_cast<bool>([object boolValue])) : Value([object doubleValue]);
    }
    if ([object isKindOfClass:NSArray.class] || [object isKindOfClass:NSSet.class]) {
        Value::Array items;
        for (id item in object) items.push_back(valueOf(item, depth + 1, left));
        return Value(std::move(items));
    }
    // JSON names its members by text alone, so a member of another key's is left out.
    if ([object isKindOfClass:NSDictionary.class]) {
        Value::Object members;
        for (id key in object) {
            if ([key isKindOfClass:NSString.class]) members.emplace_back(textOf(key), valueOf(object[key], depth + 1, left));
        }
        return Value(std::move(members));
    }
    if ([object isKindOfClass:NSData.class]) {
        const auto *bytes = static_cast<const std::uint8_t *>([object bytes]);
        return Value(Value::Bytes(bytes, bytes + [object length]));
    }
    if ([object isKindOfClass:NSDate.class]) return Value(textOf([[NSISO8601DateFormatter new] stringFromDate:object]));
    if ([object isKindOfClass:NSURL.class]) return Value(textOf([object absoluteString]));
    if ([object isKindOfClass:NSUUID.class]) return Value(textOf([object UUIDString]));
    return Value();
}

}  // namespace

std::string textOf(NSString *text) {
    const char *utf8 = text.UTF8String;
    return utf8 ? utf8 : "";
}

crossbind::Value valueOfPlist(id object) {
    size_t left = MAX_VALUES;
    return valueOf(object, 0, left);
}

std::string hexOf(NSData *bytes) {
    static const char DIGITS[] = "0123456789abcdef";
    const auto *data = static_cast<const std::uint8_t *>(bytes.bytes);
    std::string hex;
    hex.reserve(bytes.length * 2);
    for (NSUInteger index = 0; index < bytes.length; ++index) {
        hex += DIGITS[data[index] >> 4];
        hex += DIGITS[data[index] & 0xf];
    }
    return hex;
}
