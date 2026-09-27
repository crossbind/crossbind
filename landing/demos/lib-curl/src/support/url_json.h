#pragma once

#include <curl/curl.h>

#include <cstdio>
#include <stdexcept>
#include <string>

// JSON for the URL apps. Kept out of src/native so the bound header has no braces or URLs in its
// string literals.
namespace curlapp {

inline std::string quote(const std::string& value) {
    std::string out = "\"";
    for (const unsigned char c : value) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += static_cast<char>(c);
        } else if (c < 0x20) {
            char escaped[8];
            std::snprintf(escaped, sizeof escaped, "\\u%04x", c);
            out += escaped;
        } else {
            out += static_cast<char>(c);
        }
    }
    return out + "\"";
}

inline std::string failure(CURLUcode code) {
    return "{\"ok\":false,\"code\":" + std::to_string(code) + ",\"error\":" + quote(curl_url_strerror(code)) + "}";
}

// A part as a JSON string, or null when the URL has none (CURLUE_NO_SCHEME ... CURLUE_NO_ZONEID).
inline std::string part(CURLU* url, CURLUPart which, unsigned int flags) {
    char* value = nullptr;
    if (curl_url_get(url, which, &value, flags) != CURLUE_OK) return "null";
    const std::string text = quote(value);
    curl_free(value);
    return text;
}

// The flags libcurl 8.22.0 itself passes: lib/url.c parses CURLOPT_URL with these before a transfer,
// and lib/http.c parses a Location header with REDIRECT when it follows a redirect.
constexpr unsigned int TRANSFER = CURLU_GUESS_SCHEME | CURLU_NON_SUPPORT_SCHEME;
constexpr unsigned int REDIRECT = CURLU_URLENCODE | CURLU_ALLOW_SPACE;

// Every part of `url`, or of `reference` resolved against it when `reference` is not empty.
inline std::string parse(const std::string& url, const std::string& reference) {
    CURLU* handle = curl_url();
    if (!handle) throw std::runtime_error("out of memory");
    CURLUcode code = curl_url_set(handle, CURLUPART_URL, url.c_str(), TRANSFER);
    if (code == CURLUE_OK && !reference.empty()) code = curl_url_set(handle, CURLUPART_URL, reference.c_str(), REDIRECT);
    if (code != CURLUE_OK) {
        curl_url_cleanup(handle);
        return failure(code);
    }
    const struct {
        const char* key;
        CURLUPart which;
        unsigned int flags;
    } parts[] = {
        {"url", CURLUPART_URL, 0},
        {"scheme", CURLUPART_SCHEME, 0},
        {"user", CURLUPART_USER, 0},
        {"password", CURLUPART_PASSWORD, 0},
        {"options", CURLUPART_OPTIONS, 0},
        {"host", CURLUPART_HOST, 0},
        {"port", CURLUPART_PORT, 0},
        {"connectPort", CURLUPART_PORT, CURLU_DEFAULT_PORT},
        {"path", CURLUPART_PATH, 0},
        {"query", CURLUPART_QUERY, 0},
        {"fragment", CURLUPART_FRAGMENT, 0},
        {"zoneid", CURLUPART_ZONEID, 0},
    };
    std::string json = "{\"ok\":true";
    for (const auto& entry : parts) json += ",\"" + std::string(entry.key) + "\":" + part(handle, entry.which, entry.flags);
    curl_url_cleanup(handle);
    return json + "}";
}

}  // namespace curlapp
