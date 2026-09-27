#pragma once

#include <curl/curl.h>

#include <ctime>
#include <string>

// curl_getdate, the date parser curl uses for Last-Modified, Expires, cookie expiry and the tool's
// -z option. It reads the three HTTP date formats and many variations, and a date without a time
// zone is taken as GMT.
class HttpDates {
public:
    // Seconds since 1970-01-01 UTC, or -1 when curl cannot read the text as a date.
    static double seconds(const std::string& text) { return static_cast<double>(curl_getdate(text.c_str(), nullptr)); }

    // The same instant written as ISO 8601 in UTC.
    static std::string iso(const std::string& text) {
        const time_t when = curl_getdate(text.c_str(), nullptr);
        if (when == -1) return "not a date";
        std::tm parts{};
        gmtime_r(&when, &parts);
        char buffer[32];
        std::strftime(buffer, sizeof buffer, "%Y-%m-%dT%H:%M:%SZ", &parts);
        return buffer;
    }
};
