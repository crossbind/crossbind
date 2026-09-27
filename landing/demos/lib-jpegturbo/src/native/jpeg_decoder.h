#pragma once

#include <cstdio>
#include <jpeglib.h>

#include <stdexcept>
#include <string>

// A JPEG file in memory to RGBA pixels, and what its header says. A file libjpeg-turbo cannot read
// throws libjpeg's own message instead of ending the program.
class JpegDecoder {
public:
    // {"width","height","components","colorSpace","progressive"}, read without decoding a pixel.
    static std::string header(const std::u16string& jpeg) {
        const std::string file = toBytes(jpeg);
        Decompressor decoder;
        jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpeg_read_header(&decoder.cinfo, TRUE);
        const jpeg_decompress_struct& info = decoder.cinfo;
        return "{\"width\":" + std::to_string(info.image_width) + ",\"height\":" + std::to_string(info.image_height) +
               ",\"components\":" + std::to_string(info.num_components) + ",\"colorSpace\":\"" + colorSpace(info.jpeg_color_space) +
               "\",\"progressive\":" + (jpeg_has_multiple_scans(&decoder.cinfo) ? "true" : "false") + "}";
    }

    // width * height * 4 bytes of RGBA; greyscale files come out with R = G = B.
    static std::u16string decode(const std::u16string& jpeg) {
        const std::string file = toBytes(jpeg);
        Decompressor decoder;
        jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpeg_read_header(&decoder.cinfo, TRUE);
        decoder.cinfo.out_color_space = JCS_EXT_RGBA;
        jpeg_start_decompress(&decoder.cinfo);
        const size_t stride = static_cast<size_t>(decoder.cinfo.output_width) * 4;
        std::u16string rgba(stride * decoder.cinfo.output_height, u'\0');
        std::string row(stride, '\0');
        while (decoder.cinfo.output_scanline < decoder.cinfo.output_height) {
            const size_t y = decoder.cinfo.output_scanline;
            JSAMPROW pointer = reinterpret_cast<JSAMPROW>(&row[0]);
            jpeg_read_scanlines(&decoder.cinfo, &pointer, 1);
            for (size_t x = 0; x < stride; ++x) rgba[y * stride + x] = static_cast<unsigned char>(row[x]);
        }
        jpeg_finish_decompress(&decoder.cinfo);
        return rgba;
    }

private:
    static std::string toBytes(const std::u16string& units) {
        std::string bytes(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            bytes[i] = static_cast<char>(units[i]);
        }
        return bytes;
    }

    static const char* colorSpace(J_COLOR_SPACE space) {
        switch (space) {
            case JCS_GRAYSCALE: return "greyscale";
            case JCS_RGB: return "RGB";
            case JCS_YCbCr: return "YCbCr";
            case JCS_CMYK: return "CMYK";
            case JCS_YCCK: return "YCCK";
            default: return "unknown";
        }
    }

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
};
