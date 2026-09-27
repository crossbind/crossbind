#pragma once

#include <curl/curl.h>

#include <cstddef>
#include <cstring>
#include <stdexcept>
#include <string>

// curl_easy_escape and curl_easy_unescape: percent-encoding the way curl does it. Every byte except
// A-Z, a-z, 0-9 and - . _ ~ is escaped, so the result is safe in any part of a URL. Since libcurl
// 7.82.0 both functions ignore their handle argument, so no easy handle is needed.
class PercentCodec {
public:
    static std::string escape(const std::string& text) {
        char* escaped = curl_easy_escape(nullptr, text.data(), static_cast<int>(text.size()));
        return take(escaped, escaped ? std::strlen(escaped) : 0);
    }

    // Decodes %XX sequences only: + stays +, and a % that starts no valid sequence is kept.
    static std::string unescape(const std::string& text) {
        int size = 0;
        char* decoded = curl_easy_unescape(nullptr, text.data(), static_cast<int>(text.size()), &size);
        return take(decoded, static_cast<std::size_t>(size));
    }

private:
    static std::string take(char* data, std::size_t size) {
        if (!data) throw std::runtime_error("out of memory");
        const std::string result(data, size);
        curl_free(data);
        return result;
    }
};
