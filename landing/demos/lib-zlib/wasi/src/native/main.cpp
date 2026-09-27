// A command-line gzip for WASI, on zlib's own .gz file functions:
//   zlib-tool gzip <input> <output.gz> [level]
//   zlib-tool gunzip <input.gz> <output>
#include <zlib.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {

using File = std::unique_ptr<FILE, int (*)(FILE*)>;

File open(const char* path, const char* mode) {
    File file(std::fopen(path, mode), std::fclose);
    if (!file) std::fprintf(stderr, "cannot open %s\n", path);
    return file;
}

long long fileSize(const char* path) {
    File file = open(path, "rb");
    if (!file || std::fseek(file.get(), 0, SEEK_END) != 0) return -1;
    return std::ftell(file.get());
}

// gzwrite deflates the bytes as they arrive; gzclose finishes the stream and writes the trailer.
long long compress(const char* input, const char* output, int level) {
    File in = open(input, "rb");
    if (!in) return -1;
    gzFile out = gzopen(output, ("wb" + std::to_string(level)).c_str());
    if (!out) {
        std::fprintf(stderr, "cannot create %s\n", output);
        return -1;
    }
    std::vector<char> buffer(64 << 10);
    size_t read = 0;
    while ((read = std::fread(buffer.data(), 1, buffer.size(), in.get())) > 0) {
        if (gzwrite(out, buffer.data(), static_cast<unsigned>(read)) != static_cast<int>(read)) {
            int code = 0;
            std::fprintf(stderr, "gzwrite: %s\n", gzerror(out, &code));
            gzclose(out);
            return -1;
        }
    }
    if (gzclose(out) != Z_OK) {
        std::fprintf(stderr, "cannot finish %s\n", output);
        return -1;
    }
    return fileSize(output);
}

// gzread inflates every member of the file in turn, as gunzip does.
long long decompress(const char* input, const char* output) {
    gzFile in = gzopen(input, "rb");
    if (!in) {
        std::fprintf(stderr, "cannot open %s\n", input);
        return -1;
    }
    if (gzdirect(in)) {  // gzread would copy a file that is not gzip; refuse it instead
        std::fprintf(stderr, "%s is not a gzip file\n", input);
        gzclose(in);
        return -1;
    }
    File out = open(output, "wb");
    if (!out) {
        gzclose(in);
        return -1;
    }
    std::vector<char> buffer(64 << 10);
    long long written = 0;
    int got = 0;
    while ((got = gzread(in, buffer.data(), static_cast<unsigned>(buffer.size()))) > 0) {
        if (std::fwrite(buffer.data(), 1, static_cast<size_t>(got), out.get()) != static_cast<size_t>(got)) {
            std::fprintf(stderr, "cannot write %s\n", output);
            gzclose(in);
            return -1;
        }
        written += got;
    }
    if (got < 0) {
        int code = 0;
        std::fprintf(stderr, "gzread: %s\n", gzerror(in, &code));
        gzclose(in);
        return -1;
    }
    gzclose(in);
    return written;
}

}  // namespace

int main(int argc, char** argv) {
    const bool packing = argc >= 4 && std::strcmp(argv[1], "gzip") == 0;
    const bool unpacking = argc >= 4 && std::strcmp(argv[1], "gunzip") == 0;
    if (!packing && !unpacking) {
        std::fprintf(stderr, "usage: zlib-tool gzip <input> <output.gz> [level]\n       zlib-tool gunzip <input.gz> <output>\n");
        return 2;
    }
    const long long written = packing ? compress(argv[2], argv[3], argc >= 5 ? std::atoi(argv[4]) : 6) : decompress(argv[2], argv[3]);
    if (written < 0) return 1;
    std::printf("zlib %s %s: %s -> %s, %lld B written\n", zlibVersion(), argv[1], argv[2], argv[3], written);
    return 0;
}
