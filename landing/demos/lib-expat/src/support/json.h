#pragma once

#include <cstdio>
#include <string>

// Just enough JSON writing for the apps: Expat hands over UTF-8, so strings only need quotes,
// backslashes and control characters escaped.
namespace json {

inline std::string quote(const std::string& value) {
    std::string out = "\"";
    for (const char c : value) {
        const unsigned char byte = static_cast<unsigned char>(c);
        if (c == '"' || c == '\\') {
            out += '\\';
            out += c;
        } else if (byte < 0x20) {
            char escaped[8];
            std::snprintf(escaped, sizeof escaped, "\\u%04x", byte);
            out += escaped;
        } else {
            out += c;
        }
    }
    return out + "\"";
}

inline std::string number(double value, int decimals) {
    char text[64];
    std::snprintf(text, sizeof text, "%.*f", decimals, value);
    return text;
}

inline std::string integer(double value) { return number(value, 0); }

}  // namespace json
