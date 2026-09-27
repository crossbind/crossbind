#pragma once

#include <cstdio>
#include <jpeglib.h>

#include <stdexcept>
#include <string>

// Decodes straight to a smaller image: with scale_num / scale_denom set, libjpeg-turbo runs a
// smaller inverse DCT on every 8x8 block, so a 1/8 thumbnail never exists at full size.
class JpegThumbnail {
public:
    // The size a decode at 1/denominator produces, "WxH"; each side rounds up.
    static std::string size(const std::u16string& jpeg, int denominator) {
        const std::string file = toBytes(jpeg);
        Decompressor decoder;
        open(decoder, file, denominator);
        jpeg_calc_output_dimensions(&decoder.cinfo);
        return std::to_string(decoder.cinfo.output_width) + "x" + std::to_string(decoder.cinfo.output_height);
    }

    // RGBA pixels of the decode at 1/denominator (1, 2, 4 or 8).
    static std::u16string decode(const std::u16string& jpeg, int denominator) {
        const std::string file = toBytes(jpeg);
        Decompressor decoder;
        open(decoder, file, denominator);
        decoder.cinfo.out_color_space = JCS_EXT_RGBA;
        jpeg_start_decompress(&decoder.cinfo);
        const size_t stride = static_cast<size_t>(decoder.cinfo.output_width) * 4;
        std::string rgba(stride * decoder.cinfo.output_height, '\0');
        while (decoder.cinfo.output_scanline < decoder.cinfo.output_height) {
            JSAMPROW row = reinterpret_cast<JSAMPROW>(&rgba[decoder.cinfo.output_scanline * stride]);
            jpeg_read_scanlines(&decoder.cinfo, &row, 1);
        }
        jpeg_finish_decompress(&decoder.cinfo);
        return std::u16string(rgba.begin(), rgba.end());
    }

private:
    // libjpeg's default error handler ends the process; this one throws libjpeg's message instead.
    [[noreturn]] static void throwError(j_common_ptr cinfo) {
        char message[JMSG_LENGTH_MAX];
        (*cinfo->err->format_message)(cinfo, message);
        throw std::runtime_error(message);
    }

    struct Decompressor {
        jpeg_decompress_struct cinfo;
        jpeg_error_mgr jerr;
        Decompressor() {
            cinfo.err = jpeg_std_error(&jerr);
            jerr.error_exit = throwError;
            jpeg_create_decompress(&cinfo);
        }
        ~Decompressor() { jpeg_destroy_decompress(&cinfo); }
        Decompressor(const Decompressor&) = delete;
        Decompressor& operator=(const Decompressor&) = delete;
    };

    static void open(Decompressor& decoder, const std::string& file, int denominator) {
        if (denominator != 1 && denominator != 2 && denominator != 4 && denominator != 8) throw std::invalid_argument("denominator must be 1, 2, 4 or 8");
        jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpeg_read_header(&decoder.cinfo, TRUE);
        decoder.cinfo.scale_num = 1;
        decoder.cinfo.scale_denom = static_cast<unsigned int>(denominator);
    }

    static std::string toBytes(const std::u16string& units) {
        std::string bytes(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            bytes[i] = static_cast<char>(units[i]);
        }
        return bytes;
    }
};
