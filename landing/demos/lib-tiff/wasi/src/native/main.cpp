// A command-line TIFF tool for WASI:
//   tiff-tool sample <out.tif>             writes a three-page, uncompressed TIFF to try it on
//   tiff-tool archive <in.tif> <out.tif>   rewrites every page losslessly: black-and-white pages as
//                                          CCITT Group 4, the others as Deflate with a predictor
//   tiff-tool info <file.tif>              one line per page: size, samples, codec and stored bytes
#include <tiffio.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {

using File = std::unique_ptr<TIFF, void (*)(TIFF*)>;

File open(const char* path, const char* mode) {
    File tif(TIFFOpen(path, mode), TIFFClose);
    if (!tif) std::fprintf(stderr, "cannot open %s\n", path);
    return tif;
}

// Files are built in memory through TIFFClientOpen and saved with one fwrite. With wasi-sdk 34's
// wasm32-wasip2 and -wasip3 libc, a write that follows lseek(fd, 0, SEEK_END) lands at the old
// position; libtiff seeks that way before every page after the first, so a multi-page file written
// with TIFFOpen comes out corrupt.
class Output {
public:
    Output() : tif(TIFFClientOpen("output", "w", this, read, write, seek, close, size, map, unmap), TIFFClose) {}
    TIFF* get() const { return tif.get(); }

    // Closes the TIFF, which writes its last directory, then saves the bytes.
    bool save(const char* path) {
        tif.reset();
        std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path, "wb"), std::fclose);
        return file && std::fwrite(bytes.data(), 1, bytes.size(), file.get()) == bytes.size();
    }

private:
    static tmsize_t read(thandle_t handle, void* buffer, tmsize_t count) {
        Output* self = static_cast<Output*>(handle);
        const size_t available = self->position < self->bytes.size() ? self->bytes.size() - self->position : 0;
        const size_t take = std::min(available, static_cast<size_t>(count));
        std::memcpy(buffer, self->bytes.data() + self->position, take);
        self->position += take;
        return static_cast<tmsize_t>(take);
    }
    static tmsize_t write(thandle_t handle, void* buffer, tmsize_t count) {
        Output* self = static_cast<Output*>(handle);
        if (self->bytes.size() < self->position + count) self->bytes.resize(self->position + count);
        std::memcpy(&self->bytes[self->position], buffer, static_cast<size_t>(count));
        self->position += count;
        return count;
    }
    static toff_t seek(thandle_t handle, toff_t offset, int whence) {
        Output* self = static_cast<Output*>(handle);
        self->position = (whence == SEEK_END ? self->bytes.size() : whence == SEEK_CUR ? self->position : 0) + offset;
        return self->position;
    }
    static int close(thandle_t) { return 0; }
    static toff_t size(thandle_t handle) { return static_cast<Output*>(handle)->bytes.size(); }
    static int map(thandle_t, void**, toff_t*) { return 0; }
    static void unmap(thandle_t, void*, toff_t) {}

    std::string bytes;
    size_t position = 0;
    std::unique_ptr<TIFF, void (*)(TIFF*)> tif;
};

long fileSize(const char* path) {
    std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path, "rb"), std::fclose);
    if (!file || std::fseek(file.get(), 0, SEEK_END) != 0) return -1;
    return std::ftell(file.get());
}

std::string codecName(TIFF* tif) {
    uint16_t compression = COMPRESSION_NONE;
    TIFFGetFieldDefaulted(tif, TIFFTAG_COMPRESSION, &compression);
    const TIFFCodec* codec = TIFFFindCODEC(compression);
    return codec ? codec->name : "scheme " + std::to_string(compression);
}

// What the page's strips or tiles take in the file.
unsigned long long storedBytes(TIFF* tif) {
    unsigned long long total = 0;
    for (uint32_t strile = 0; strile < TIFFNumberOfStrips(tif); ++strile) total += TIFFGetStrileByteCount(tif, strile);
    return total;
}

// Deterministic content: a text-like black-and-white page, a grey gradient and a colour gradient.
bool writeSample(const char* path) {
    Output out;
    TIFF* tif = out.get();
    if (!tif) return false;
    uint32_t state = 2026;
    const auto random = [&state](uint32_t n) { return ((state = state * 1664525u + 1013904223u) >> 8) % n; };
    for (int page = 0; page < 3; ++page) {
        const uint32_t width = page == 0 ? 1240 : 800;
        const uint32_t height = page == 0 ? 1754 : 600;
        const uint16_t samples = page == 2 ? 3 : 1;
        const uint16_t bits = page == 0 ? 1 : 8;
        TIFFSetField(tif, TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif, TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, bits);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, samples);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, page == 0 ? PHOTOMETRIC_MINISWHITE : page == 1 ? PHOTOMETRIC_MINISBLACK : PHOTOMETRIC_RGB);
        TIFFSetField(tif, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, COMPRESSION_NONE);
        TIFFSetField(tif, TIFFTAG_ROWSPERSTRIP, TIFFDefaultStripSize(tif, 0));
        TIFFSetField(tif, TIFFTAG_PAGENUMBER, page, 3);
        TIFFSetField(tif, TIFFTAG_PAGENAME, page == 0 ? "letter" : page == 1 ? "grey" : "colour");
        std::vector<uint8_t> row(static_cast<size_t>(TIFFScanlineSize(tif)));
        std::vector<uint8_t> ink(width, 0);
        for (uint32_t y = 0; y < height; ++y) {
            if (page == 0) {
                // Lines of word-shaped blocks, 20 px tall every 36 px, inside 120 px margins.
                if (y % 36 == 0) {
                    std::fill(ink.begin(), ink.end(), 0);
                    const bool text = y >= 120 && y < height - 120 && random(10) < 8;
                    for (uint32_t x = 120; text && x < width - 260;) {
                        const uint32_t word = 20 + 10 * random(13);
                        std::fill(ink.begin() + x, ink.begin() + x + word, 1);
                        x += word + 18;
                    }
                }
                std::fill(row.begin(), row.end(), 0);
                if (y % 36 < 20) {
                    for (uint32_t x = 0; x < width; ++x) row[x / 8] |= static_cast<uint8_t>(ink[x] << (7 - x % 8));
                }
            } else {
                for (uint32_t x = 0; x < width; ++x) {
                    if (page == 1) {
                        const int dx = static_cast<int>(x) - 400;
                        const int dy = static_cast<int>(y) - 300;
                        row[x] = static_cast<uint8_t>(255 - std::min(255, (dx * dx + dy * dy) / 1000));
                    } else {
                        row[x * 3] = static_cast<uint8_t>(x * 255 / (width - 1));
                        row[x * 3 + 1] = static_cast<uint8_t>(y * 255 / (height - 1));
                        row[x * 3 + 2] = 128;
                    }
                }
            }
            if (TIFFWriteScanline(tif, row.data(), y, 0) < 0) return false;
        }
        if (!TIFFWriteDirectory(tif)) return false;
    }
    return out.save(path);
}

// Copies one stripped page into the next directory of `out`, recompressed.
bool archivePage(TIFF* in, TIFF* out, int page) {
    uint32_t width = 0;
    uint32_t height = 0;
    uint16_t bits = 1;
    uint16_t samples = 1;
    uint16_t photometric = PHOTOMETRIC_MINISBLACK;
    uint16_t format = SAMPLEFORMAT_UINT;
    uint16_t planar = PLANARCONFIG_CONTIG;
    TIFFGetField(in, TIFFTAG_IMAGEWIDTH, &width);
    TIFFGetField(in, TIFFTAG_IMAGELENGTH, &height);
    TIFFGetFieldDefaulted(in, TIFFTAG_BITSPERSAMPLE, &bits);
    TIFFGetFieldDefaulted(in, TIFFTAG_SAMPLESPERPIXEL, &samples);
    TIFFGetFieldDefaulted(in, TIFFTAG_SAMPLEFORMAT, &format);
    TIFFGetFieldDefaulted(in, TIFFTAG_PLANARCONFIG, &planar);
    TIFFGetField(in, TIFFTAG_PHOTOMETRIC, &photometric);
    if (TIFFIsTiled(in) || planar != PLANARCONFIG_CONTIG) {
        std::fprintf(stderr, "page %d: this tool copies pages stored in interleaved strips\n", page);
        return false;
    }
    TIFFSetField(out, TIFFTAG_IMAGEWIDTH, width);
    TIFFSetField(out, TIFFTAG_IMAGELENGTH, height);
    TIFFSetField(out, TIFFTAG_BITSPERSAMPLE, bits);
    TIFFSetField(out, TIFFTAG_SAMPLESPERPIXEL, samples);
    TIFFSetField(out, TIFFTAG_SAMPLEFORMAT, format);
    TIFFSetField(out, TIFFTAG_PHOTOMETRIC, photometric);
    TIFFSetField(out, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
    uint16_t count = 0;
    uint16_t* kinds = nullptr;
    if (TIFFGetField(in, TIFFTAG_EXTRASAMPLES, &count, &kinds)) TIFFSetField(out, TIFFTAG_EXTRASAMPLES, count, kinds);
    uint16_t *red = nullptr, *green = nullptr, *blue = nullptr;
    if (TIFFGetField(in, TIFFTAG_COLORMAP, &red, &green, &blue)) TIFFSetField(out, TIFFTAG_COLORMAP, red, green, blue);
    uint16_t number = 0, pages = 0;
    if (TIFFGetField(in, TIFFTAG_PAGENUMBER, &number, &pages)) TIFFSetField(out, TIFFTAG_PAGENUMBER, number, pages);
    char* name = nullptr;
    if (TIFFGetField(in, TIFFTAG_PAGENAME, &name)) TIFFSetField(out, TIFFTAG_PAGENAME, name);
    if (bits == 1 && samples == 1) {
        TIFFSetField(out, TIFFTAG_COMPRESSION, COMPRESSION_CCITTFAX4);
        TIFFSetField(out, TIFFTAG_ROWSPERSTRIP, height);
    } else {
        TIFFSetField(out, TIFFTAG_COMPRESSION, COMPRESSION_ADOBE_DEFLATE);
        if (format == SAMPLEFORMAT_IEEEFP) {
            TIFFSetField(out, TIFFTAG_PREDICTOR, PREDICTOR_FLOATINGPOINT);
        } else if (bits == 8 || bits == 16 || bits == 32) {
            TIFFSetField(out, TIFFTAG_PREDICTOR, PREDICTOR_HORIZONTAL);
        }
        TIFFSetField(out, TIFFTAG_ROWSPERSTRIP, TIFFDefaultStripSize(out, 0));
    }
    std::vector<uint8_t> row(static_cast<size_t>(TIFFScanlineSize(in)));
    for (uint32_t y = 0; y < height; ++y) {
        if (TIFFReadScanline(in, row.data(), y, 0) < 0 || TIFFWriteScanline(out, row.data(), y, 0) < 0) {
            std::fprintf(stderr, "page %d: could not copy row %u\n", page, y);
            return false;
        }
    }
    return TIFFWriteDirectory(out) == 1;
}

bool archive(const char* inPath, const char* outPath) {
    File in = open(inPath, "r");
    Output out;
    if (!in || !out.get()) return false;
    int page = 1;
    do {
        if (!archivePage(in.get(), out.get(), page)) return false;
        page += 1;
    } while (TIFFReadDirectory(in.get()));
    return out.save(outPath);
}

bool info(const char* path) {
    File tif = open(path, "r");
    if (!tif) return false;
    do {
        uint32_t width = 0;
        uint32_t height = 0;
        uint16_t bits = 1;
        uint16_t samples = 1;
        char* name = nullptr;
        TIFFGetField(tif.get(), TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif.get(), TIFFTAG_IMAGELENGTH, &height);
        TIFFGetFieldDefaulted(tif.get(), TIFFTAG_BITSPERSAMPLE, &bits);
        TIFFGetFieldDefaulted(tif.get(), TIFFTAG_SAMPLESPERPIXEL, &samples);
        const bool named = TIFFGetField(tif.get(), TIFFTAG_PAGENAME, &name) == 1;
        std::printf("page %u%s%s%s: %ux%u, %u x %u-bit, %s, %llu B\n", TIFFCurrentDirectory(tif.get()) + 1, named ? " \"" : "", named ? name : "", named ? "\"" : "", width, height,
                    samples, bits, codecName(tif.get()).c_str(), storedBytes(tif.get()));
    } while (TIFFReadDirectory(tif.get()));
    return true;
}

}  // namespace

int main(int argc, char** argv) {
    const std::string command = argc >= 2 ? argv[1] : "";
    bool done = false;
    if (command == "sample" && argc == 3) {
        done = writeSample(argv[2]);
        if (done) std::printf("wrote %s: 3 pages, %ld B\n", argv[2], fileSize(argv[2]));
    } else if (command == "archive" && argc == 4) {
        done = archive(argv[2], argv[3]);
        if (done) std::printf("libtiff %s: %s %ld B -> %s %ld B\n", TIFFLIB_VERSION_STR_MAJ_MIN_MIC, argv[2], fileSize(argv[2]), argv[3], fileSize(argv[3]));
    } else if (command == "info" && argc == 3) {
        done = info(argv[2]);
    } else {
        std::fprintf(stderr, "usage: tiff-tool sample <out.tif>\n       tiff-tool archive <in.tif> <out.tif>\n       tiff-tool info <file.tif>\n");
        return 2;
    }
    return done ? 0 : 1;
}
