#pragma once

#include <curl/curl.h>

#include <stdexcept>
#include <string>

// Builds URLs with libcurl's URL API instead of string concatenation: references are resolved the
// way curl follows a redirect, and CURLU_URLENCODE escapes what a path or a query cannot hold.
class UrlBuilder {
public:
    // `reference` is resolved against `base`, as curl does with a Location header.
    static std::string resolve(const std::string& base, const std::string& reference) { return edit(base, CURLUPART_URL, reference, 0); }

    // Replaces the path, percent-encoding spaces and other characters a path cannot hold.
    static std::string withPath(const std::string& url, const std::string& path) { return edit(url, CURLUPART_PATH, path, CURLU_URLENCODE); }

    // Appends one name=value pair to the query. The value is encoded: a space becomes +, and a
    // literal + or & becomes %2B or %26.
    static std::string addQuery(const std::string& url, const std::string& pair) {
        return edit(url, CURLUPART_QUERY, pair, CURLU_APPENDQUERY | CURLU_URLENCODE);
    }

private:
    static std::string edit(const std::string& url, CURLUPart part, const std::string& value, unsigned int flags) {
        CURLU* handle = curl_url();
        if (!handle) throw std::runtime_error("out of memory");
        char* result = nullptr;
        CURLUcode code = curl_url_set(handle, CURLUPART_URL, url.c_str(), 0);
        if (code == CURLUE_OK) code = curl_url_set(handle, part, value.c_str(), flags);
        if (code == CURLUE_OK) code = curl_url_get(handle, CURLUPART_URL, &result, 0);
        curl_url_cleanup(handle);
        if (code != CURLUE_OK) throw std::runtime_error(curl_url_strerror(code));
        const std::string text = result;
        curl_free(result);
        return text;
    }
};
