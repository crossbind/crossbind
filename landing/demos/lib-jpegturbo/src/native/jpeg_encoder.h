#pragma once

#include <cstdio>
#include <cstdlib>
#include <jpeglib.h>

#include <stdexcept>
#include <string>

// Pixels in, a JPEG file out, both in memory. Bytes cross the binding as a byte string: one UTF-16
// code unit (0-255) per byte.
class JpegEncoder {
public:
    static std::string version() {
        const int number = LIBJPEG_TURBO_VERSION_NUMBER;
        return std::to_string(number / 1000000) + "." + std::to_string(number / 1000 % 1000) + "." + std::to_string(number % 1000);
    }

    // rgba holds width * height * 4 bytes. subsampling is 444, 422 or 420: the chroma resolution
    // kept for each 2x2 block of pixels (all of it, half, a quarter).
    static std::u16string encode(const std::u16string& rgba, int width, int height, int quality, int subsampling) {
        if (width < 1 || height < 1 || rgba.size() != static_cast<size_t>(width) * height * 4) throw std::invalid_argument("rgba must hold width * height * 4 bytes");
        if (quality < 1 || quality > 100) throw std::invalid_argument("quality must be between 1 and 100");
        if (subsampling != 444 && subsampling != 422 && subsampling != 420) throw std::invalid_argument("subsampling must be 444, 422 or 420");
        std::string pixels(rgba.size(), '\0');
        for (size_t i = 0; i < rgba.size(); ++i) {
            if (rgba[i] > 0xFF) throw std::invalid_argument("not a byte string");
            pixels[i] = static_cast<char>(rgba[i]);
        }

        Compressor jpeg;
        unsigned char* buffer = nullptr;
        unsigned long size = 0;
        jpeg_mem_dest(&jpeg.cinfo, &buffer, &size);
        jpeg.cinfo.image_width = static_cast<JDIMENSION>(width);
        jpeg.cinfo.image_height = static_cast<JDIMENSION>(height);
        jpeg.cinfo.input_components = 4;
        jpeg.cinfo.in_color_space = JCS_EXT_RGBA;
        jpeg_set_defaults(&jpeg.cinfo);
        jpeg_set_quality(&jpeg.cinfo, quality, TRUE);
        jpeg.cinfo.comp_info[0].h_samp_factor = subsampling == 444 ? 1 : 2;
        jpeg.cinfo.comp_info[0].v_samp_factor = subsampling == 420 ? 2 : 1;
        jpeg_start_compress(&jpeg.cinfo, TRUE);
        while (jpeg.cinfo.next_scanline < jpeg.cinfo.image_height) {
            JSAMPROW row = reinterpret_cast<JSAMPROW>(&pixels[static_cast<size_t>(jpeg.cinfo.next_scanline) * width * 4]);
            jpeg_write_scanlines(&jpeg.cinfo, &row, 1);
        }
        // jpeg_mem_dest reallocates as the file grows and hands the final buffer over only here.
        jpeg_finish_compress(&jpeg.cinfo);
        std::u16string file(buffer, buffer + size);
        std::free(buffer);
        return file;
    }

private:
    // libjpeg's default error handler ends the process; this one throws libjpeg's message instead.
    [[noreturn]] static void throwError(j_common_ptr cinfo) {
        char message[JMSG_LENGTH_MAX];
        (*cinfo->err->format_message)(cinfo, message);
        throw std::runtime_error(message);
    }

    struct Compressor {
        jpeg_compress_struct cinfo;
        jpeg_error_mgr jerr;
        Compressor() {
            cinfo.err = jpeg_std_error(&jerr);
            jerr.error_exit = throwError;
            jpeg_create_compress(&cinfo);
        }
        ~Compressor() { jpeg_destroy_compress(&cinfo); }
        Compressor(const Compressor&) = delete;
        Compressor& operator=(const Compressor&) = delete;
    };
};
