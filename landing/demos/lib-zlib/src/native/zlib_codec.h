#pragma once

#include <zlib.h>

#include <stdexcept>
#include <string>

// One-shot zlib: compress2 and uncompress, in the zlib format (RFC 1950). Bytes cross the binding as
// a byte string: one UTF-16 code unit (0-255) per byte.
class Zlib {
public:
    static std::string version() { return zlibVersion(); }

    static std::u16string compress(const std::string& text, int level) {
        uLongf size = compressBound(static_cast<uLong>(text.size()));
        std::string out(size, '\0');
        const int status = compress2(reinterpret_cast<Bytef*>(&out[0]), &size, reinterpret_cast<const Bytef*>(text.data()), static_cast<uLong>(text.size()), level);
        if (status != Z_OK) throw std::runtime_error(status == Z_STREAM_ERROR ? "level must be between -1 and 9" : zError(status));
        std::u16string bytes(size, u'\0');
        for (uLongf i = 0; i < size; ++i) bytes[i] = static_cast<unsigned char>(out[i]);
        return bytes;
    }

    // The zlib format does not record the original size, so the caller keeps it next to the data.
    static std::string decompress(const std::u16string& bytes, int originalSize) {
        if (originalSize < 0 || originalSize > (256 << 20)) throw std::invalid_argument("originalSize must be between 0 and 256 MiB");
        std::string in(bytes.size(), '\0');
        for (size_t i = 0; i < bytes.size(); ++i) {
            if (bytes[i] > 0xFF) throw std::invalid_argument("not a byte string");
            in[i] = static_cast<char>(bytes[i]);
        }
        std::string out(static_cast<size_t>(originalSize), '\0');
        uLongf size = static_cast<uLongf>(out.size());
        const int status = uncompress(reinterpret_cast<Bytef*>(&out[0]), &size, reinterpret_cast<const Bytef*>(in.data()), static_cast<uLong>(in.size()));
        if (status == Z_BUF_ERROR) throw std::runtime_error("the data is larger than originalSize");
        if (status != Z_OK) throw std::runtime_error(status == Z_DATA_ERROR ? "corrupt or incomplete zlib data" : zError(status));
        out.resize(size);
        return out;
    }
};
