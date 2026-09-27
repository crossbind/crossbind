// A command-line zstd for WASI:
//   zstd-tool compress <input> <output> [level]
//   zstd-tool decompress <input> <output>
#include <zstd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>

namespace {

using File = std::unique_ptr<FILE, int (*)(FILE*)>;

File open(const char* path, const char* mode) {
    File file(std::fopen(path, mode), std::fclose);
    if (!file) std::fprintf(stderr, "cannot open %s\n", path);
    return file;
}

bool failed(size_t code) {
    if (!ZSTD_isError(code)) return false;
    std::fprintf(stderr, "zstd: %s\n", ZSTD_getErrorName(code));
    return true;
}

long long compress(FILE* in, FILE* out, int level) {
    std::unique_ptr<ZSTD_CCtx, size_t (*)(ZSTD_CCtx*)> cctx(ZSTD_createCCtx(), ZSTD_freeCCtx);
    if (failed(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_compressionLevel, level))) return -1;
    if (failed(ZSTD_CCtx_setParameter(cctx.get(), ZSTD_c_checksumFlag, 1))) return -1;
    std::vector<char> input(ZSTD_CStreamInSize());
    std::vector<char> output(ZSTD_CStreamOutSize());
    long long written = 0;
    for (;;) {
        const size_t read = std::fread(input.data(), 1, input.size(), in);
        const bool last = read < input.size();
        ZSTD_inBuffer source = {input.data(), read, 0};
        bool finished = false;
        while (!finished) {
            ZSTD_outBuffer target = {output.data(), output.size(), 0};
            const size_t remaining = ZSTD_compressStream2(cctx.get(), &target, &source, last ? ZSTD_e_end : ZSTD_e_continue);
            if (failed(remaining)) return -1;
            written += static_cast<long long>(std::fwrite(output.data(), 1, target.pos, out));
            finished = last ? remaining == 0 : source.pos == source.size;
        }
        if (last) return written;
    }
}

long long decompress(FILE* in, FILE* out) {
    std::unique_ptr<ZSTD_DCtx, size_t (*)(ZSTD_DCtx*)> dctx(ZSTD_createDCtx(), ZSTD_freeDCtx);
    std::vector<char> input(ZSTD_DStreamInSize());
    std::vector<char> output(ZSTD_DStreamOutSize());
    long long written = 0;
    size_t pending = 0;
    size_t read = 0;
    while ((read = std::fread(input.data(), 1, input.size(), in)) > 0) {
        ZSTD_inBuffer source = {input.data(), read, 0};
        while (source.pos < source.size) {
            ZSTD_outBuffer target = {output.data(), output.size(), 0};
            pending = ZSTD_decompressStream(dctx.get(), &target, &source);
            if (failed(pending)) return -1;
            written += static_cast<long long>(std::fwrite(output.data(), 1, target.pos, out));
        }
    }
    if (pending != 0) {
        std::fprintf(stderr, "the input ends in the middle of a zstd frame\n");
        return -1;
    }
    return written;
}

}  // namespace

int main(int argc, char** argv) {
    const bool packing = argc >= 4 && std::strcmp(argv[1], "compress") == 0;
    const bool unpacking = argc >= 4 && std::strcmp(argv[1], "decompress") == 0;
    if (!packing && !unpacking) {
        std::fprintf(stderr, "usage: zstd-tool compress <input> <output> [level]\n       zstd-tool decompress <input> <output>\n");
        return 2;
    }
    File in = open(argv[2], "rb");
    File out = open(argv[3], "wb");
    if (!in || !out) return 1;
    const long long written = packing ? compress(in.get(), out.get(), argc >= 5 ? std::atoi(argv[4]) : 3) : decompress(in.get(), out.get());
    if (written < 0) return 1;
    std::printf("zstd %s %s: %s -> %s, %lld B written\n", ZSTD_versionString(), argv[1], argv[2], argv[3], written);
    return 0;
}
