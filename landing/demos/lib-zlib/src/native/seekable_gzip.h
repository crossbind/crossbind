#pragma once

#include <zlib.h>

#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/access_log.h"
#include "../support/gzip_index.h"

// Reads any part of a big .gz without decompressing what comes before it. One pass over the file
// builds an index (../support/gzip_index.h); every read after that starts at the nearest access point,
// so it decompresses at most one span plus what it returns. Paths are in the module's filesystem.
class SeekableGzip {
public:
    // Writes `lines` 64-byte access-log lines to `path` as a gzip file named access.log inside, at
    // `level`, and returns the file's size.
    static double writeLog(const std::string& path, int lines, int level) {
        if (lines < 1 || lines > 4000000) throw std::invalid_argument("lines must be between 1 and 4,000,000");
        File out = open(path, "wb");
        z_stream strm{};
        if (deflateInit2(&strm, level, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY) != Z_OK) throw std::invalid_argument("level must be between -1 and 9");
        std::unique_ptr<z_stream, int (*)(z_stream*)> end(&strm, deflateEnd);
        char name[] = "access.log";
        gz_header header{};
        header.name = reinterpret_cast<Bytef*>(name);
        header.time = accesslog::START;
        header.os = 3;
        deflateSetHeader(&strm, &header);
        accesslog::Generator generator;
        std::string text;
        std::vector<unsigned char> buffer(64 << 10);
        double written = 0;
        for (int number = 1; number <= lines;) {
            text.clear();
            for (int batch = 0; batch < 1024 && number <= lines; ++batch, ++number) generator.line(number, text);
            const int flush = number > lines ? Z_FINISH : Z_NO_FLUSH;
            strm.next_in = reinterpret_cast<Bytef*>(&text[0]);
            strm.avail_in = static_cast<uInt>(text.size());
            do {
                strm.next_out = buffer.data();
                strm.avail_out = static_cast<uInt>(buffer.size());
                deflate(&strm, flush);
                const size_t have = buffer.size() - strm.avail_out;
                if (have && std::fwrite(buffer.data(), 1, have, out.get()) != have) throw std::runtime_error("cannot write " + path);
                written += static_cast<double>(have);
            } while (strm.avail_out == 0);
        }
        return written;
    }

    // One pass over the file, with an access point about every `spanKiB` KiB of uncompressed data.
    // Takes gzip (every member of a multi-member file), zlib or raw deflate.
    SeekableGzip(const std::string& path, int spanKiB) : path(path) {
        if (spanKiB < 64 || spanKiB > 65536) throw std::invalid_argument("spanKiB must be between 64 and 65536");
        File in = open(path, "rb");
        if (std::fgetc(in.get()) == EOF) throw std::runtime_error("the file is empty");
        std::rewind(in.get());
        index = gzindex::build(in.get(), static_cast<long long>(spanKiB) << 10);
    }

    double size() const { return static_cast<double>(index.length); }
    double compressedSize() const { return static_cast<double>(index.file); }
    // Bytes after the end of the compressed data, which are ignored as gunzip ignores them.
    double trailingBytes() const { return static_cast<double>(index.file - index.end); }
    int accessPoints() const { return static_cast<int>(index.points.size()); }
    std::string format() const { return index.mode == gzindex::GZIP ? "gzip" : index.mode == gzindex::ZLIB ? "zlib" : "raw deflate"; }

    // Where the access points are: [[offset in the file, offset in the uncompressed data], ...].
    std::string points() const {
        std::string json = "[";
        for (size_t i = 0; i < index.points.size(); ++i) {
            json += (i ? ",[" : "[") + std::to_string(index.points[i].in) + "," + std::to_string(index.points[i].out) + "]";
        }
        return json + "]";
    }

    // Up to `length` bytes from uncompressed `offset`, as a byte string.
    std::u16string read(double offset, int length) { return take(offset, length, false); }

    // The same bytes decompressed from the start of the file, as a reader without an index gets them.
    std::u16string readFromStart(double offset, int length) { return take(offset, length, true); }

    // How many bytes the last read decompressed (the ones it skipped included), and from which access point.
    double lastDecoded() const { return decoded; }
    int lastPoint() const { return point; }

private:
    using File = std::unique_ptr<FILE, int (*)(FILE*)>;

    static File open(const std::string& path, const char* mode) {
        File file(std::fopen(path.c_str(), mode), std::fclose);
        if (!file) throw std::runtime_error("cannot open " + path);
        return file;
    }

    std::u16string take(double offset, int length, bool fromStart) {
        if (length < 0 || length > (16 << 20)) throw std::invalid_argument("length must be between 0 and 16 MiB");
        File in = open(path, "rb");
        const gzindex::Read result = gzindex::extract(in.get(), index, static_cast<long long>(offset), static_cast<size_t>(length), fromStart);
        decoded = static_cast<double>(result.decoded);
        point = result.point;
        std::u16string units(result.data.size(), u'\0');
        for (size_t i = 0; i < units.size(); ++i) units[i] = static_cast<unsigned char>(result.data[i]);
        return units;
    }

    std::string path;
    gzindex::Index index;
    double decoded = 0;
    int point = 0;
};
