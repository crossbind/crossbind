// A command-line JPEG tool for WASI:
//   jpeg-tool encode <input.ppm> <output.jpg> [quality]
//   jpeg-tool thumbnail <input.jpg> <output.jpg> <1|2|4|8> [quality]
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <jpeglib.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using File = std::unique_ptr<FILE, int (*)(FILE*)>;

File open(const char* path, const char* mode) {
    File file(std::fopen(path, mode), std::fclose);
    if (!file) throw std::runtime_error(std::string("cannot open ") + path);
    return file;
}

// libjpeg's default error handler ends the process; this one throws libjpeg's message instead.
[[noreturn]] void throwError(j_common_ptr cinfo) {
    char message[JMSG_LENGTH_MAX];
    (*cinfo->err->format_message)(cinfo, message);
    throw std::runtime_error(message);
}

struct Image {
    int width = 0;
    int height = 0;
    std::vector<unsigned char> rgb;
};

// Binary PPM (P6) with 8-bit samples, as cjpeg reads it and djpeg -ppm writes it.
Image readPpm(const char* path) {
    File in = open(path, "rb");
    const auto number = [&]() {
        int c = std::fgetc(in.get());
        while (c == '#' || c == ' ' || c == '\n' || c == '\r' || c == '\t') {
            if (c == '#') while (c != '\n' && c != EOF) c = std::fgetc(in.get());
            c = std::fgetc(in.get());
        }
        int value = 0;
        if (c < '0' || c > '9') throw std::runtime_error("not a binary PPM file");
        while (c >= '0' && c <= '9') {
            value = value * 10 + (c - '0');
            c = std::fgetc(in.get());
        }
        return value;
    };
    if (std::fgetc(in.get()) != 'P' || std::fgetc(in.get()) != '6') throw std::runtime_error("not a binary PPM file (P6)");
    Image image;
    image.width = number();
    image.height = number();
    if (number() != 255) throw std::runtime_error("only 8-bit PPM files are supported");
    if (image.width < 1 || image.height < 1 || image.width > 65500 || image.height > 65500) throw std::runtime_error("unsupported PPM size");
    image.rgb.resize(static_cast<size_t>(image.width) * image.height * 3);
    if (std::fread(image.rgb.data(), 1, image.rgb.size(), in.get()) != image.rgb.size()) throw std::runtime_error("the PPM file is truncated");
    return image;
}

long writeJpeg(const Image& image, const char* path, int quality) {
    jpeg_compress_struct cinfo;
    jpeg_error_mgr jerr;
    cinfo.err = jpeg_std_error(&jerr);
    jerr.error_exit = throwError;
    jpeg_create_compress(&cinfo);
    std::unique_ptr<jpeg_compress_struct, void (*)(jpeg_compress_struct*)> guard(&cinfo, jpeg_destroy_compress);
    File out = open(path, "wb");
    jpeg_stdio_dest(&cinfo, out.get());
    cinfo.image_width = static_cast<JDIMENSION>(image.width);
    cinfo.image_height = static_cast<JDIMENSION>(image.height);
    cinfo.input_components = 3;
    cinfo.in_color_space = JCS_RGB;
    jpeg_set_defaults(&cinfo);
    jpeg_set_quality(&cinfo, quality, TRUE);
    jpeg_start_compress(&cinfo, TRUE);
    while (cinfo.next_scanline < cinfo.image_height) {
        JSAMPROW row = const_cast<JSAMPROW>(&image.rgb[static_cast<size_t>(cinfo.next_scanline) * image.width * 3]);
        jpeg_write_scanlines(&cinfo, &row, 1);
    }
    jpeg_finish_compress(&cinfo);
    return std::ftell(out.get());
}

// Decodes at 1/denominator: libjpeg-turbo runs a smaller inverse DCT on every block.
Image readJpeg(const char* path, int denominator, int& fullWidth, int& fullHeight) {
    File in = open(path, "rb");
    jpeg_decompress_struct cinfo;
    jpeg_error_mgr jerr;
    cinfo.err = jpeg_std_error(&jerr);
    jerr.error_exit = throwError;
    jpeg_create_decompress(&cinfo);
    std::unique_ptr<jpeg_decompress_struct, void (*)(jpeg_decompress_struct*)> guard(&cinfo, jpeg_destroy_decompress);
    jpeg_stdio_src(&cinfo, in.get());
    jpeg_read_header(&cinfo, TRUE);
    fullWidth = static_cast<int>(cinfo.image_width);
    fullHeight = static_cast<int>(cinfo.image_height);
    cinfo.scale_num = 1;
    cinfo.scale_denom = static_cast<unsigned int>(denominator);
    cinfo.out_color_space = JCS_RGB;
    jpeg_start_decompress(&cinfo);
    Image image;
    image.width = static_cast<int>(cinfo.output_width);
    image.height = static_cast<int>(cinfo.output_height);
    image.rgb.resize(static_cast<size_t>(image.width) * image.height * 3);
    while (cinfo.output_scanline < cinfo.output_height) {
        JSAMPROW row = &image.rgb[static_cast<size_t>(cinfo.output_scanline) * image.width * 3];
        jpeg_read_scanlines(&cinfo, &row, 1);
    }
    jpeg_finish_decompress(&cinfo);
    return image;
}

int quality(int argc, char** argv, int at) {
    const int value = argc > at ? std::atoi(argv[at]) : 85;
    if (value < 1 || value > 100) throw std::runtime_error("quality must be between 1 and 100");
    return value;
}

}  // namespace

int main(int argc, char** argv) {
    const bool encode = argc >= 4 && std::strcmp(argv[1], "encode") == 0;
    const bool thumbnail = argc >= 5 && std::strcmp(argv[1], "thumbnail") == 0;
    if (!encode && !thumbnail) {
        std::fprintf(stderr, "usage: jpeg-tool encode <input.ppm> <output.jpg> [quality]\n       jpeg-tool thumbnail <input.jpg> <output.jpg> <1|2|4|8> [quality]\n");
        return 2;
    }
    const int version = LIBJPEG_TURBO_VERSION_NUMBER;
    const std::string library = "libjpeg-turbo " + std::to_string(version / 1000000) + "." + std::to_string(version / 1000 % 1000) + "." + std::to_string(version % 1000);
    try {
        if (encode) {
            const int q = quality(argc, argv, 4);
            const Image image = readPpm(argv[2]);
            const long bytes = writeJpeg(image, argv[3], q);
            std::printf("%s encode: %s (%dx%d) -> %s, %ld B at quality %d\n", library.c_str(), argv[2], image.width, image.height, argv[3], bytes, q);
        } else {
            const int denominator = std::atoi(argv[4]);
            if (denominator != 1 && denominator != 2 && denominator != 4 && denominator != 8) throw std::runtime_error("the scale must be 1, 2, 4 or 8");
            const int q = quality(argc, argv, 5);
            int fullWidth = 0, fullHeight = 0;
            const Image image = readJpeg(argv[2], denominator, fullWidth, fullHeight);
            const long bytes = writeJpeg(image, argv[3], q);
            std::printf("%s thumbnail: %s (%dx%d) -> %s (%dx%d), %ld B at quality %d\n", library.c_str(), argv[2], fullWidth, fullHeight, argv[3], image.width, image.height, bytes, q);
        }
    } catch (const std::exception& error) {
        std::fprintf(stderr, "jpeg-tool: %s\n", error.what());
        return 1;
    }
    return 0;
}
