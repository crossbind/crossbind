#pragma once

#include <zlib.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Raw deflate (RFC 1951, no header or checksum) with a preset dictionary: both sides load the same
// bytes first, so a short message can point back at strings it never contained. An empty dictionary
// gives plain raw deflate.
class ZlibDictionary {
public:
    ZlibDictionary(const std::string& dictionary, int level) : dictionary(dictionary), level(level) {}

    std::u16string compress(const std::string& message) const {
        z_stream stream{};
        // windowBits -15: raw deflate with a 32 KiB window.
        if (deflateInit2(&stream, level, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY) != Z_OK) throw std::invalid_argument("level must be between -1 and 9");
        std::unique_ptr<z_stream, int (*)(z_stream*)> end(&stream, deflateEnd);
        if (!dictionary.empty()) deflateSetDictionary(&stream, reinterpret_cast<const Bytef*>(dictionary.data()), static_cast<uInt>(dictionary.size()));
        std::string out(deflateBound(&stream, static_cast<uLong>(message.size())), '\0');
        stream.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(message.data()));
        stream.avail_in = static_cast<uInt>(message.size());
        stream.next_out = reinterpret_cast<Bytef*>(&out[0]);
        stream.avail_out = static_cast<uInt>(out.size());
        if (deflate(&stream, Z_FINISH) != Z_STREAM_END) throw std::runtime_error("deflate did not finish");
        std::u16string bytes(stream.total_out, u'\0');
        for (size_t i = 0; i < bytes.size(); ++i) bytes[i] = static_cast<unsigned char>(out[i]);
        return bytes;
    }

    std::string decompress(const std::u16string& bytes) const {
        std::string in(bytes.size(), '\0');
        for (size_t i = 0; i < bytes.size(); ++i) {
            if (bytes[i] > 0xFF) throw std::invalid_argument("not a byte string");
            in[i] = static_cast<char>(bytes[i]);
        }
        z_stream stream{};
        if (inflateInit2(&stream, -15) != Z_OK) throw std::runtime_error("inflateInit2 failed");
        std::unique_ptr<z_stream, int (*)(z_stream*)> end(&stream, inflateEnd);
        // Raw deflate carries no dictionary ID, so the dictionary goes in before the first inflate().
        if (!dictionary.empty()) inflateSetDictionary(&stream, reinterpret_cast<const Bytef*>(dictionary.data()), static_cast<uInt>(dictionary.size()));
        stream.next_in = reinterpret_cast<Bytef*>(&in[0]);
        stream.avail_in = static_cast<uInt>(in.size());
        std::string out;
        std::vector<char> chunk(16 << 10);
        int status = Z_OK;
        while (status != Z_STREAM_END) {
            stream.next_out = reinterpret_cast<Bytef*>(chunk.data());
            stream.avail_out = static_cast<uInt>(chunk.size());
            status = inflate(&stream, Z_NO_FLUSH);
            if (status != Z_OK && status != Z_STREAM_END) throw std::runtime_error(stream.msg ? stream.msg : "truncated or corrupt input");
            out.append(chunk.data(), chunk.size() - stream.avail_out);
            if (out.size() > (1u << 20)) throw std::runtime_error("a message above 1 MiB is not a small message");
        }
        return out;
    }

private:
    std::string dictionary;
    int level;
};
