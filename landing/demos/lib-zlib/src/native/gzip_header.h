#pragma once

#include <zlib.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// gzip (RFC 1952) with the header fields gunzip -N restores: the original file name and the
// modification time. Bytes cross the binding as a byte string: one UTF-16 code unit (0-255) per byte.
class Gzip {
public:
    static std::u16string compress(const std::string& data, const std::string& name, double mtime, int level) {
        z_stream stream{};
        // windowBits 15 + 16: a 32 KiB window, and the gzip wrapper instead of the zlib one.
        if (deflateInit2(&stream, level, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY) != Z_OK) throw std::invalid_argument("level must be between -1 and 9");
        std::unique_ptr<z_stream, int (*)(z_stream*)> end(&stream, deflateEnd);
        gz_header header{};
        header.name = reinterpret_cast<Bytef*>(const_cast<char*>(name.c_str()));
        header.time = static_cast<uLong>(mtime);
        header.os = 3;  // Unix
        deflateSetHeader(&stream, &header);
        std::string out(deflateBound(&stream, static_cast<uLong>(data.size())), '\0');
        stream.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(data.data()));
        stream.avail_in = static_cast<uInt>(data.size());
        stream.next_out = reinterpret_cast<Bytef*>(&out[0]);
        stream.avail_out = static_cast<uInt>(out.size());
        if (deflate(&stream, Z_FINISH) != Z_STREAM_END) throw std::runtime_error("deflate did not finish");
        std::u16string bytes(stream.total_out, u'\0');
        for (size_t i = 0; i < bytes.size(); ++i) bytes[i] = static_cast<unsigned char>(out[i]);
        return bytes;
    }

    static std::string fileName(const std::u16string& gz) {
        std::string name;
        uLong mtime = 0;
        readHeader(gz, name, mtime);
        return name;
    }

    // Seconds since 1970-01-01T00:00:00Z.
    static double modified(const std::u16string& gz) {
        std::string name;
        uLong mtime = 0;
        readHeader(gz, name, mtime);
        return static_cast<double>(mtime);
    }

    static std::string decompress(const std::u16string& gz) {
        std::string in = fromUnits(gz);
        z_stream stream{};
        if (inflateInit2(&stream, 15 + 32) != Z_OK) throw std::runtime_error("inflateInit2 failed");  // + 32: gzip or zlib, from the header
        std::unique_ptr<z_stream, int (*)(z_stream*)> end(&stream, inflateEnd);
        stream.next_in = reinterpret_cast<Bytef*>(&in[0]);
        stream.avail_in = static_cast<uInt>(in.size());
        std::string out;
        std::vector<char> chunk(64 << 10);
        int status = Z_OK;
        while (status != Z_STREAM_END) {
            stream.next_out = reinterpret_cast<Bytef*>(chunk.data());
            stream.avail_out = static_cast<uInt>(chunk.size());
            status = inflate(&stream, Z_NO_FLUSH);
            if (status != Z_OK && status != Z_STREAM_END) throw std::runtime_error(stream.msg ? stream.msg : "truncated or corrupt input");
            out.append(chunk.data(), chunk.size() - stream.avail_out);
            if (out.size() > (256u << 20)) throw std::runtime_error("refusing to decompress more than 256 MiB");
        }
        return out;
    }

private:
    static std::string fromUnits(const std::u16string& units) {
        std::string bytes(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            bytes[i] = static_cast<char>(units[i]);
        }
        return bytes;
    }

    // inflateGetHeader fills the fields while inflate reads the header; Z_BLOCK stops right after it.
    static void readHeader(const std::u16string& gz, std::string& name, uLong& mtime) {
        std::string in = fromUnits(gz);
        z_stream stream{};
        if (inflateInit2(&stream, 15 + 16) != Z_OK) throw std::runtime_error("inflateInit2 failed");  // + 16: gzip only
        std::unique_ptr<z_stream, int (*)(z_stream*)> end(&stream, inflateEnd);
        std::vector<Bytef> nameBuffer(1024, 0);
        gz_header header{};
        header.name = nameBuffer.data();
        header.name_max = static_cast<uInt>(nameBuffer.size() - 1);
        inflateGetHeader(&stream, &header);
        Bytef output = 0;
        stream.next_in = reinterpret_cast<Bytef*>(&in[0]);
        stream.avail_in = static_cast<uInt>(in.size());
        stream.next_out = &output;
        stream.avail_out = 1;
        const int status = inflate(&stream, Z_BLOCK);
        if ((status != Z_OK && status != Z_STREAM_END) || header.done != 1) throw std::runtime_error(stream.msg ? stream.msg : "not a complete gzip header");
        name = reinterpret_cast<const char*>(nameBuffer.data());
        mtime = header.time;
    }
};
