#pragma once

#include <zlib.h>

#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Streaming gzip, file to file, in 64 KiB steps: the deflate() and inflate() loops of zlib's own
// examples/zpipe.c, with windowBits 15 + 16 for gzip. Memory stays at two buffers whatever the size.
class GzipStream {
public:
    // Returns the compressed size.
    static double compressFile(const std::string& input, const std::string& output, int level) {
        File in = open(input, "rb");
        File out = open(output, "wb");
        z_stream stream{};
        if (deflateInit2(&stream, level, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY) != Z_OK) throw std::invalid_argument("level must be between -1 and 9");
        std::unique_ptr<z_stream, int (*)(z_stream*)> end(&stream, deflateEnd);
        std::vector<unsigned char> source(CHUNK);
        std::vector<unsigned char> target(CHUNK);
        double written = 0;
        int flush = Z_NO_FLUSH;
        do {
            stream.avail_in = static_cast<uInt>(std::fread(source.data(), 1, CHUNK, in.get()));
            if (std::ferror(in.get())) throw std::runtime_error("cannot read " + input);
            flush = std::feof(in.get()) ? Z_FINISH : Z_NO_FLUSH;
            stream.next_in = source.data();
            do {
                stream.avail_out = CHUNK;
                stream.next_out = target.data();
                deflate(&stream, flush);
                written += write(out.get(), target.data(), CHUNK - stream.avail_out);
            } while (stream.avail_out == 0);
        } while (flush != Z_FINISH);
        return written;
    }

    // Returns the decompressed size. Reads every member of a concatenated .gz, as gunzip does.
    static double decompressFile(const std::string& input, const std::string& output) {
        File in = open(input, "rb");
        File out = open(output, "wb");
        z_stream stream{};
        if (inflateInit2(&stream, 15 + 32) != Z_OK) throw std::runtime_error("inflateInit2 failed");  // + 32: gzip or zlib
        std::unique_ptr<z_stream, int (*)(z_stream*)> end(&stream, inflateEnd);
        std::vector<unsigned char> source(CHUNK);
        std::vector<unsigned char> target(CHUNK);
        double written = 0;
        int status = Z_OK;
        for (;;) {
            stream.avail_in = static_cast<uInt>(std::fread(source.data(), 1, CHUNK, in.get()));
            if (std::ferror(in.get())) throw std::runtime_error("cannot read " + input);
            if (stream.avail_in == 0) break;
            stream.next_in = source.data();
            do {
                if (status == Z_STREAM_END) {
                    if (stream.avail_in == 0) break;
                    inflateReset(&stream);  // another member follows
                }
                stream.avail_out = CHUNK;
                stream.next_out = target.data();
                status = inflate(&stream, Z_NO_FLUSH);
                if (status == Z_NEED_DICT || status == Z_DATA_ERROR || status == Z_MEM_ERROR) throw std::runtime_error(stream.msg ? stream.msg : "corrupt input");
                written += write(out.get(), target.data(), CHUNK - stream.avail_out);
            } while (stream.avail_out == 0 || (status == Z_STREAM_END && stream.avail_in > 0));
        }
        if (status != Z_STREAM_END) throw std::runtime_error("the input ends in the middle of a gzip member");
        return written;
    }

private:
    static constexpr size_t CHUNK = 64 << 10;
    using File = std::unique_ptr<FILE, int (*)(FILE*)>;

    static File open(const std::string& path, const char* mode) {
        File file(std::fopen(path.c_str(), mode), std::fclose);
        if (!file) throw std::runtime_error("cannot open " + path);
        return file;
    }

    static double write(FILE* file, const unsigned char* data, size_t size) {
        if (size && std::fwrite(data, 1, size, file) != size) throw std::runtime_error("write failed");
        return static_cast<double>(size);
    }
};
