#pragma once

#include <zstd.h>

#include <stdexcept>
#include <string>

// One-shot Zstandard. Bytes cross the binding as a byte string: one UTF-16 code unit (0-255) per byte.
class Zstd {
public:
    static std::string version() { return ZSTD_versionString(); }

    static std::u16string compress(const std::string& text, int level) {
        std::string out(ZSTD_compressBound(text.size()), '\0');
        const size_t size = ZSTD_compress(&out[0], out.size(), text.data(), text.size(), level);
        if (ZSTD_isError(size)) throw std::runtime_error(ZSTD_getErrorName(size));
        std::u16string bytes(size, u'\0');
        for (size_t i = 0; i < size; ++i) bytes[i] = static_cast<unsigned char>(out[i]);
        return bytes;
    }

    static std::string decompress(const std::u16string& bytes) {
        std::string in(bytes.size(), '\0');
        for (size_t i = 0; i < bytes.size(); ++i) {
            if (bytes[i] > 0xFF) throw std::invalid_argument("not a byte string");
            in[i] = static_cast<char>(bytes[i]);
        }
        const unsigned long long size = ZSTD_getFrameContentSize(in.data(), in.size());
        if (size == ZSTD_CONTENTSIZE_ERROR) throw std::runtime_error("not a zstd frame");
        if (size == ZSTD_CONTENTSIZE_UNKNOWN) throw std::runtime_error("size not stored in the frame; use streaming");
        if (size > (256u << 20)) throw std::runtime_error("refusing to allocate more than 256 MiB");
        std::string out(static_cast<size_t>(size), '\0');
        const size_t got = ZSTD_decompress(&out[0], out.size(), in.data(), in.size());
        if (ZSTD_isError(got)) throw std::runtime_error(ZSTD_getErrorName(got));
        out.resize(got);
        return out;
    }
};
