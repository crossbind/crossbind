#pragma once

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

// The JSON the app wrappers return to the pages. Objects are built here, in a header the binder
// does not scan, so the bound headers carry no brace inside a string literal.
namespace projapp {

inline std::string number(double value) {
    if (!std::isfinite(value)) return "null";
    char text[40];
    std::snprintf(text, sizeof text, "%.17g", value);
    return text;
}

inline std::string quote(const char* value) {
    std::string out = "\"";
    for (const char* at = value ? value : ""; *at; at += 1) {
        const unsigned char character = static_cast<unsigned char>(*at);
        if (character == '"' || character == '\\') {
            out += '\\';
            out += static_cast<char>(character);
        } else if (character < 0x20) {
            char escaped[8];
            std::snprintf(escaped, sizeof escaped, "\\u%04x", character);
            out += escaped;
        } else {
            out += static_cast<char>(character);
        }
    }
    return out + "\"";
}

inline std::string quote(const std::string& value) { return quote(value.c_str()); }

inline std::string boolean(bool value) { return value ? "true" : "false"; }

// [a,b,c] from values that are JSON already.
inline std::string array(const std::vector<std::string>& values) {
    std::string json = "[";
    for (size_t index = 0; index < values.size(); index += 1) json += (index ? "," : "") + values[index];
    return json + "]";
}

// One JSON object, field by field: JsonObject().text("name", name).number("x", x).json().
class JsonObject {
public:
    JsonObject& raw(const char* key, const std::string& json) {
        body += (body.empty() ? "" : ",") + quote(key) + ":" + json;
        return *this;
    }
    JsonObject& text(const char* key, const std::string& value) { return raw(key, quote(value)); }
    JsonObject& text(const char* key, const char* value) { return raw(key, quote(value)); }
    JsonObject& number(const char* key, double value) { return raw(key, projapp::number(value)); }
    JsonObject& flag(const char* key, bool value) { return raw(key, boolean(value)); }
    std::string json() const { return "{" + body + "}"; }

private:
    std::string body;
};

// A run is one unbroken line of projected points, flattened as [x, y, x, y, ...]. Seven significant
// digits keep every drawing far below a pixel of error.
using Run = std::vector<double>;

inline std::string runs(const std::vector<Run>& lines) {
    std::string json = "[";
    char text[32];
    for (size_t line = 0; line < lines.size(); line += 1) {
        json += line ? ",[" : "[";
        for (size_t index = 0; index < lines[line].size(); index += 1) {
            std::snprintf(text, sizeof text, index ? ",%.7g" : "%.7g", lines[line][index]);
            json += text;
        }
        json += "]";
    }
    return json + "]";
}

}  // namespace projapp
