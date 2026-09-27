#pragma once

#include <curl/curl.h>

#include <stdexcept>
#include <string>

// libcurl's URL API, the parser curl runs on a URL before every transfer. Each call parses the URL
// into a fresh CURLU handle, reads one part back and frees the handle.
class UrlParts {
public:
    // The URL as curl stores it: the scheme lowercased and dot segments removed. The host keeps its case.
    static std::string normalize(const std::string& url) { return get(url, CURLUPART_URL, 0); }

    static std::string host(const std::string& url) { return get(url, CURLUPART_HOST, 0); }

    // CURLU_DEFAULT_PORT answers with the scheme's port when the URL does not name one.
    static std::string port(const std::string& url) { return get(url, CURLUPART_PORT, CURLU_DEFAULT_PORT); }

    static std::string path(const std::string& url) { return get(url, CURLUPART_PATH, 0); }

    // CURLU_URLDECODE turns %XX sequences back into the bytes they stand for.
    static std::string query(const std::string& url) { return get(url, CURLUPART_QUERY, CURLU_URLDECODE); }

private:
    static std::string get(const std::string& url, CURLUPart part, unsigned int flags) {
        CURLU* handle = curl_url();
        if (!handle) throw std::runtime_error("out of memory");
        char* value = nullptr;
        CURLUcode code = curl_url_set(handle, CURLUPART_URL, url.c_str(), 0);
        if (code == CURLUE_OK) code = curl_url_get(handle, part, &value, flags);
        curl_url_cleanup(handle);
        if (code != CURLUE_OK) throw std::runtime_error(curl_url_strerror(code));
        const std::string result = value;
        curl_free(value);
        return result;
    }
};
