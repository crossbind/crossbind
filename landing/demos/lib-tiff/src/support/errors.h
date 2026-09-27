#pragma once

#include <tiffio.h>

#include <cstdarg>
#include <cstdio>
#include <stdexcept>
#include <string>

// libtiff reports problems through global handlers that print to stderr. The apps keep the last
// error instead, so a failed call throws libtiff's own explanation to the page, and they drop
// warnings, which real-world files raise by the dozen (unknown tags, odd but readable values).
namespace tiffapps {

inline std::string& lastError() {
    static std::string message;
    return message;
}

inline void keepError(const char*, const char* format, va_list args) {
    char text[1024];
    std::vsnprintf(text, sizeof text, format, args);
    lastError() = text;
}

inline void dropWarning(const char*, const char*, va_list) {}

inline void quiet() {
    static const bool installed = (TIFFSetErrorHandler(keepError), TIFFSetWarningHandler(dropWarning), true);
    (void)installed;
}

inline std::runtime_error failure(const std::string& what) {
    std::string detail;
    detail.swap(lastError());
    return std::runtime_error(detail.empty() ? what : what + ": " + detail);
}

inline TIFF* openFile(const std::string& path, const char* mode) {
    quiet();
    lastError().clear();
    TIFF* tif = TIFFOpen(path.c_str(), mode);
    if (!tif) throw failure(*mode == 'r' ? "libtiff cannot read " + path : "libtiff cannot write " + path);
    return tif;
}

// Closes the file when the call that opened it returns or throws.
class Closer {
public:
    explicit Closer(TIFF* opened) : tif(opened) {}
    ~Closer() {
        if (tif) TIFFClose(tif);
    }
    Closer(const Closer&) = delete;
    Closer& operator=(const Closer&) = delete;
    TIFF* get() const { return tif; }
    // Flushes and closes now; returns false when libtiff could not finish writing.
    bool close() {
        TIFF* closing = tif;
        tif = nullptr;
        const bool flushed = TIFFFlush(closing) == 1;
        TIFFClose(closing);
        return flushed;
    }

private:
    TIFF* tif;
};

}  // namespace tiffapps
