#pragma once

#include <curl/curl.h>

#include <string>

// curl_version_info reports what this libcurl was built with, so code can check for a protocol or
// a feature before relying on it.
class BuildInfo {
public:
    static std::string version() { return curl_version(); }

    static std::string protocols() { return join(info()->protocols); }

    static std::string features() { return join(info()->feature_names); }

    static bool supports(const std::string& feature) {
        for (const char* const* item = info()->feature_names; item && *item; ++item) {
            if (feature == *item) return true;
        }
        return false;
    }

private:
    static const curl_version_info_data* info() { return curl_version_info(CURLVERSION_NOW); }

    static std::string join(const char* const* items) {
        std::string text;
        for (; items && *items; ++items) text += (text.empty() ? "" : " ") + std::string(*items);
        return text;
    }
};
