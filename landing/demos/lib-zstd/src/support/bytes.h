#pragma once

#include <stdexcept>
#include <string>

// Binary data crosses the binding as std::u16string, one code unit (0-255) per byte; std::string
// would be decoded as UTF-8 on the way to JavaScript.
namespace bytes {

inline std::u16string toUnits(const std::string& data) {
    std::u16string units(data.size(), u'\0');
    for (size_t index = 0; index < data.size(); index += 1) units[index] = static_cast<unsigned char>(data[index]);
    return units;
}

inline std::string fromUnits(const std::u16string& units) {
    std::string data(units.size(), '\0');
    for (size_t index = 0; index < units.size(); index += 1) {
        if (units[index] > 0xFF) throw std::invalid_argument("not a byte string: a code unit is above 255");
        data[index] = static_cast<char>(units[index]);
    }
    return data;
}

}  // namespace bytes
