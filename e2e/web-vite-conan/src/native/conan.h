#pragma once

#include <string>
#include <zlib.h>
#include <fmt/format.h>

// The app's own C++ against Conan packages: a C library, and fmt, whose exceptions are thrown inside
// the Conan-built archive and caught here.
class ConanApp {
public:
    static int crc32(const std::string& text) {
        return static_cast<int>(::crc32(0L, reinterpret_cast<const Bytef*>(text.data()), static_cast<uInt>(text.size())));
    }

    static std::string format(double value) {
        return fmt::format("{:.2f}", value);
    }

    static std::string formatError() {
        try {
            return fmt::format(fmt::runtime("{:d}"), "text");
        } catch (const fmt::format_error& e) {
            return std::string("format_error: ") + e.what();
        }
    }
};
