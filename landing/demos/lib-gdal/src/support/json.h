#pragma once

#include <cstdio>
#include <string>
#include <vector>

// JSON text for the app wrappers' results. It lives here, outside src/native, because the binding
// generator reads the headers there and miscounts braces inside string literals.
namespace json {

inline std::string quote(const std::string& text) {
    std::string out = "\"";
    for (const unsigned char c : text) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char escaped[8];
                    std::snprintf(escaped, sizeof escaped, "\\u%04x", c);
                    out += escaped;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out + "\"";
}

inline std::string number(double value) {
    char text[40];
    std::snprintf(text, sizeof text, "%.10g", value);
    return text;
}

inline std::string array(const std::vector<std::string>& items) {
    std::string out = "[";
    for (size_t i = 0; i < items.size(); ++i) out += (i ? "," : "") + items[i];
    return out + "]";
}

// Members are added in order; values are JSON text, so objects nest.
class Object {
public:
    Object& raw(const std::string& key, const std::string& value) {
        body_ += (body_.empty() ? "" : ",") + quote(key) + ":" + value;
        return *this;
    }
    Object& text(const std::string& key, const std::string& value) { return raw(key, quote(value)); }
    Object& number(const std::string& key, double value) { return raw(key, json::number(value)); }
    Object& flag(const std::string& key, bool value) { return raw(key, value ? "true" : "false"); }
    std::string str() const { return "{" + body_ + "}"; }

private:
    std::string body_;
};

}  // namespace json
