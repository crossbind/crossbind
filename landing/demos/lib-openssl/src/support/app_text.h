#pragma once

#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/evp.h>

#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

// What the app wrappers share: text in and out (JSON for the page, hex, base64 for binary files,
// PEM from any paste) and OpenSSL's error queue turned into exceptions.
namespace sslapp {

inline std::string quote(const std::string& value) {
    std::string out = "\"";
    for (const unsigned char character : value) {
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

// A JSON object, written field by field.
class Json {
public:
    Json& text(const char* key, const std::string& value) { return raw(key, quote(value)); }
    Json& number(const char* key, long long value) { return raw(key, std::to_string(value)); }
    Json& flag(const char* key, bool value) { return raw(key, value ? "true" : "false"); }
    Json& raw(const char* key, const std::string& json) {
        body += (body.empty() ? "" : ",") + quote(key) + ":" + json;
        return *this;
    }
    std::string str() const { return "{" + body + "}"; }

private:
    std::string body;
};

inline std::string array(const std::vector<std::string>& items) {
    std::string out = "[";
    for (size_t i = 0; i < items.size(); i += 1) out += (i ? "," : "") + items[i];
    return out + "]";
}

// The text a memory BIO collected; frees the BIO.
inline std::string drain(BIO* out) {
    char* data = nullptr;
    const long size = BIO_get_mem_data(out, &data);
    std::string text(data, size > 0 ? static_cast<size_t>(size) : 0);
    BIO_free(out);
    return text;
}

// The first error OpenSSL queued, "error:...:reason", and an empty queue after.
inline std::string takeError() {
    const unsigned long code = ERR_get_error();
    char reason[256] = "";
    if (code) ERR_error_string_n(code, reason, sizeof reason);
    ERR_clear_error();
    return reason;
}

[[noreturn]] inline void fail(const std::string& what) {
    const std::string reason = takeError();
    throw std::runtime_error(reason.empty() ? what : what + " (" + reason + ")");
}

inline std::string toHex(const unsigned char* data, size_t size, bool upper = false, char separator = 0) {
    const char* digits = upper ? "0123456789ABCDEF" : "0123456789abcdef";
    std::string out;
    for (size_t i = 0; i < size; i += 1) {
        if (separator && i) out += separator;
        out += digits[data[i] >> 4];
        out += digits[data[i] & 0x0F];
    }
    return out;
}

inline std::string toHex(const std::string& data) { return toHex(reinterpret_cast<const unsigned char*>(data.data()), data.size()); }

inline std::string fromHex(const std::string& hex) {
    const auto nibble = [](char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        throw std::invalid_argument("not hex");
    };
    if (hex.size() % 2) throw std::invalid_argument("hex has an odd length");
    std::string out(hex.size() / 2, '\0');
    for (size_t i = 0; i < out.size(); i += 1) out[i] = static_cast<char>(nibble(hex[2 * i]) * 16 + nibble(hex[2 * i + 1]));
    return out;
}

inline std::string toBase64(const std::string& bytes) {
    std::string out(4 * ((bytes.size() + 2) / 3) + 1, '\0');
    const int size = EVP_EncodeBlock(reinterpret_cast<unsigned char*>(&out[0]), reinterpret_cast<const unsigned char*>(bytes.data()), static_cast<int>(bytes.size()));
    out.resize(size > 0 ? static_cast<size_t>(size) : 0);
    return out;
}

// Whitespace and line breaks are skipped, so base64 pasted from anywhere reads.
inline std::string fromBase64(const std::string& text) {
    std::string compact;
    for (const char character : text) {
        if (character != ' ' && character != '\n' && character != '\r' && character != '\t') compact += character;
    }
    if (compact.size() % 4) throw std::invalid_argument("not base64");
    std::string out(compact.size() / 4 * 3, '\0');
    const int size = EVP_DecodeBlock(reinterpret_cast<unsigned char*>(&out[0]), reinterpret_cast<const unsigned char*>(compact.data()), static_cast<int>(compact.size()));
    if (size < 0) throw std::invalid_argument("not base64");
    size_t padding = 0;
    while (padding < 2 && padding < compact.size() && compact[compact.size() - 1 - padding] == '=') padding += 1;
    out.resize(static_cast<size_t>(size) - padding);
    return out;
}

// PEM lines must start in the first column; text pasted from YAML, JSON or a mail often does not.
inline std::string unindent(const std::string& text) {
    std::string out;
    bool lineStart = true;
    for (const char character : text) {
        if (lineStart && (character == ' ' || character == '\t')) continue;
        if (character == '\r') continue;
        out += character;
        lineStart = character == '\n';
    }
    return out;
}

}  // namespace sslapp
