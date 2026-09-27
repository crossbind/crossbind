#pragma once

#include <zstd.h>

#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Streaming Zstandard, file to file. Memory stays at two small buffers whatever the file size,
// the pattern of zstd's own examples/streaming_compression.c.
class ZstdStream {
public:
    // Compresses `input` into `output` with a content checksum; returns the compressed size.
    static double compressFile(const std::string& input, const std::string& output, int level) {
        File in = open(input, "rb");
        File out = open(output, "wb");
        std::unique_ptr<ZSTD_CCtx, size_t (*)(ZSTD_CCtx*)> cctx(ZSTD_createCCtx(), ZSTD_freeCCtx);
        check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_compressionLevel, level));
        check(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_checksumFlag, 1));
        std::vector<char> inBuffer(ZSTD_CStreamInSize());
        std::vector<char> outBuffer(ZSTD_CStreamOutSize());
        double written = 0;
        for (;;) {
            const size_t read = std::fread(inBuffer.data(), 1, inBuffer.size(), in.get());
            const bool last = read < inBuffer.size();
            ZSTD_inBuffer source = {inBuffer.data(), read, 0};
            bool finished = false;
            while (!finished) {
                ZSTD_outBuffer target = {outBuffer.data(), outBuffer.size(), 0};
                const size_t remaining = check(ZSTD_compressStream2(cctx.get(), &target, &source, last ? ZSTD_e_end : ZSTD_e_continue));
                write(out.get(), outBuffer.data(), target.pos);
                written += static_cast<double>(target.pos);
                finished = last ? remaining == 0 : source.pos == source.size;
            }
            if (last) return written;
        }
    }

    // Decompresses `input` into `output`; returns the decompressed size.
    static double decompressFile(const std::string& input, const std::string& output) {
        File in = open(input, "rb");
        File out = open(output, "wb");
        std::unique_ptr<ZSTD_DCtx, size_t (*)(ZSTD_DCtx*)> dctx(ZSTD_createDCtx(), ZSTD_freeDCtx);
        std::vector<char> inBuffer(ZSTD_DStreamInSize());
        std::vector<char> outBuffer(ZSTD_DStreamOutSize());
        double written = 0;
        size_t pending = 0;
        size_t read = 0;
        while ((read = std::fread(inBuffer.data(), 1, inBuffer.size(), in.get())) > 0) {
            ZSTD_inBuffer source = {inBuffer.data(), read, 0};
            while (source.pos < source.size) {
                ZSTD_outBuffer target = {outBuffer.data(), outBuffer.size(), 0};
                pending = check(ZSTD_decompressStream(dctx.get(), &target, &source));
                write(out.get(), outBuffer.data(), target.pos);
                written += static_cast<double>(target.pos);
            }
        }
        if (pending != 0) throw std::runtime_error("the input ends in the middle of a zstd frame");
        return written;
    }

private:
    using File = std::unique_ptr<FILE, int (*)(FILE*)>;

    static File open(const std::string& path, const char* mode) {
        File file(std::fopen(path.c_str(), mode), std::fclose);
        if (!file) throw std::runtime_error("cannot open " + path);
        return file;
    }

    static void write(FILE* file, const char* data, size_t size) {
        if (size && std::fwrite(data, 1, size, file) != size) throw std::runtime_error("write failed");
    }

    static size_t check(size_t code) {
        if (ZSTD_isError(code)) throw std::runtime_error(ZSTD_getErrorName(code));
        return code;
    }
};
