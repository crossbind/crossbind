#pragma once

#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

// Small helpers the apps share: UTF-8 walking, JSON strings and byte strings. Binary data crosses the
// binding as std::u16string, one code unit (0-255) per byte; std::string would be read as UTF-8.
namespace text {

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

// Length of the UTF-8 sequence a lead byte starts; text from JavaScript is valid UTF-8.
inline size_t sequenceLength(unsigned char lead) { return lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4; }

inline std::vector<char32_t> codePoints(const std::string& utf8) {
    std::vector<char32_t> out;
    for (size_t at = 0; at < utf8.size();) {
        const auto lead = static_cast<unsigned char>(utf8[at]);
        const size_t length = sequenceLength(lead);
        char32_t value = length == 1 ? lead : lead & (0xFF >> (length + 1));
        for (size_t i = 1; i < length && at + i < utf8.size(); i += 1) value = (value << 6) | (static_cast<unsigned char>(utf8[at + i]) & 0x3F);
        out.push_back(value);
        at += length;
    }
    return out;
}

inline std::string utf8(char32_t c) {
    std::string out;
    if (c < 0x80) {
        out += static_cast<char>(c);
    } else if (c < 0x800) {
        out += static_cast<char>(0xC0 | (c >> 6));
        out += static_cast<char>(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
        out += static_cast<char>(0xE0 | (c >> 12));
        out += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (c & 0x3F));
    } else {
        out += static_cast<char>(0xF0 | (c >> 18));
        out += static_cast<char>(0x80 | ((c >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (c & 0x3F));
    }
    return out;
}

inline std::string codeName(char32_t c) {
    char name[16];
    std::snprintf(name, sizeof name, "U+%04X", static_cast<unsigned>(c));
    return name;
}

inline std::string json(const std::string& value) {
    std::string out = "\"";
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += static_cast<char>(c);
        } else if (c < 0x20) {
            static const char* const hex = "0123456789abcdef";
            out += "\\u00";
            out += hex[c >> 4];
            out += hex[c & 15];
        } else {
            out += static_cast<char>(c);
        }
    }
    return out + "\"";
}

inline std::string hex(const std::string& bytes, size_t limit) {
    static const char* const digits = "0123456789abcdef";
    std::string out;
    for (size_t i = 0; i < bytes.size() && i < limit; i += 1) {
        const auto value = static_cast<unsigned char>(bytes[i]);
        if (i) out += ' ';
        out += digits[value >> 4];
        out += digits[value & 15];
    }
    return out;
}

}  // namespace text
