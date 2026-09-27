#pragma once

#include <iconv.h>

#include <string>

// What this build of libiconv converts. iconvlist() walks every encoding with all of its names and
// iconv_canonicalize() maps an alias to the canonical one. iconv_open() is the real test: an unknown
// name comes back from iconv_canonicalize unchanged.
class Encodings {
public:
    // "1.19": _libiconv_version holds (major << 8) + minor.
    static std::string version() { return std::to_string(_libiconv_version >> 8) + "." + std::to_string(_libiconv_version & 0xFF); }

    // One entry per encoding, every name it answers to: [["CP1252","MS-ANSI","WINDOWS-1252"], ...].
    static std::string list() {
        std::string json = "[";
        iconvlist(addEncoding, &json);
        return json + "]";
    }

    // The canonical name, or "" when this build cannot convert from or to that encoding.
    static std::string resolve(const std::string& name) {
        const iconv_t cd = iconv_open("UTF-8", name.c_str());
        if (cd == reinterpret_cast<iconv_t>(-1)) return "";
        iconv_close(cd);
        return iconv_canonicalize(name.c_str());
    }

private:
    static int addEncoding(unsigned int count, const char* const* names, void* data) {
        std::string& json = *static_cast<std::string*>(data);
        json += json.size() > 1 ? ",[" : "[";
        for (unsigned int i = 0; i < count; ++i) json += std::string(i ? ",\"" : "\"") + names[i] + "\"";
        json += "]";
        return 0;  // non-zero would stop the walk
    }
};
