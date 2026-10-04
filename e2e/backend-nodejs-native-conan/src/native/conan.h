#pragma once

#include <string>
#include <curl/curl.h>
#include <fmt/format.h>
#include <png.h>
#include <zlib.h>

class ConanApp {
public:
    static std::string zlib() {
        return zlibVersion();
    }

    static unsigned int crc32(const std::string& text) {
        return ::crc32(0L, reinterpret_cast<const Bytef*>(text.data()), static_cast<uInt>(text.size()));
    }

    static std::string libpng() {
        return png_get_libpng_ver(nullptr);
    }

    static std::string libcurl() {
        return curl_version_info(CURLVERSION_NOW)->version;
    }

    static std::string format(double value) {
        return fmt::format("{:.2f}", value);
    }

    static std::string formatError() {
        try {
            return fmt::format(fmt::runtime("{:d}"), "text");
        } catch (const fmt::format_error& error) {
            return std::string("format_error: ") + error.what();
        }
    }

    static std::string fetch(const std::string& url) {
        CURL* curl = curl_easy_init();
        if (!curl) return "error: curl_easy_init failed";
        std::string body;
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, collect);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
        CURLcode code = curl_easy_perform(curl);
        curl_easy_cleanup(curl);
        return code == CURLE_OK ? body : std::string("error: ") + curl_easy_strerror(code);
    }

private:
    static size_t collect(char* data, size_t size, size_t count, void* out) {
        static_cast<std::string*>(out)->append(data, size * count);
        return size * count;
    }
};
