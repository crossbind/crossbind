// An iconv-style converter for WASI:
//   iconv-tool <from> <to> <input> <output>
// It streams the input in 64 KB pieces. A piece that ends inside a multibyte character stops iconv
// with EINVAL; those bytes wait for the next piece. A full output buffer (E2BIG) is written out and
// reused, and a last call without input ends a stateful encoding in its initial shift state.
#include <iconv.h>

#include <cerrno>
#include <cstdio>
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

bool flushOutput(FILE* file, const std::vector<char>& buffer, size_t used, long long& written) {
    if (used && std::fwrite(buffer.data(), 1, used, file) != used) {
        std::fprintf(stderr, "write failed\n");
        return false;
    }
    written += static_cast<long long>(used);
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 5) {
        std::fprintf(stderr, "usage: iconv-tool <from> <to> <input> <output>\n");
        return 2;
    }
    const char* from = argv[1];
    const char* to = argv[2];
    const iconv_t opened = iconv_open(to, from);
    if (opened == reinterpret_cast<iconv_t>(-1)) {
        std::fprintf(stderr, "iconv cannot convert %s to %s\n", from, to);
        return 1;
    }
    std::unique_ptr<void, int (*)(iconv_t)> cd(opened, iconv_close);
    File in = open(argv[3], "rb");
    File out = open(argv[4], "wb");
    if (!in || !out) return 1;

    std::vector<char> input(64 * 1024);
    std::vector<char> output(64 * 1024);
    size_t carried = 0;
    long long read = 0;
    long long written = 0;
    for (;;) {
        const size_t got = std::fread(input.data() + carried, 1, input.size() - carried, in.get());
        if (got == 0) break;
        read += static_cast<long long>(got);
        char* inPointer = input.data();
        size_t inLeft = carried + got;
        while (inLeft > 0) {
            char* outPointer = output.data();
            size_t outLeft = output.size();
            const size_t status = iconv(cd.get(), &inPointer, &inLeft, &outPointer, &outLeft);
            if (!flushOutput(out.get(), output, output.size() - outLeft, written)) return 1;
            if (status != static_cast<size_t>(-1) || errno == E2BIG) continue;
            if (errno == EINVAL) break;  // the piece ends inside a character: keep its bytes
            std::fprintf(stderr, "invalid %s input at byte %lld\n", from, read - static_cast<long long>(inLeft));
            return 1;
        }
        carried = inLeft;
        std::memmove(input.data(), inPointer, carried);
    }
    if (carried) {
        std::fprintf(stderr, "the %s input ends inside a character at byte %lld\n", from, read - static_cast<long long>(carried));
        return 1;
    }
    char* outPointer = output.data();
    size_t outLeft = output.size();
    iconv(cd.get(), nullptr, nullptr, &outPointer, &outLeft);
    if (!flushOutput(out.get(), output, output.size() - outLeft, written)) return 1;

    std::printf("iconv %d.%d %s -> %s: %s -> %s, %lld B read, %lld B written\n", _libiconv_version >> 8, _libiconv_version & 0xFF, from, to, argv[3], argv[4], read, written);
    return 0;
}
