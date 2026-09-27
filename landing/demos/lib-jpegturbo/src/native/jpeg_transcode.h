#pragma once

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <jpeglib.h>

#include <stdexcept>
#include <string>

// Rewrites a JPEG without decoding it to pixels, as `jpegtran -copy all` does: the quantised DCT
// coefficients are copied as they are, so no quality is lost. Only their entropy coding changes.
class JpegTranscoder {
public:
    // optimize: Huffman tables fitted to this image instead of the standard ones.
    // progressive: scans that draw a coarse image first; libjpeg-turbo optimises those tables anyway.
    static std::u16string transcode(const std::u16string& jpeg, bool optimize, bool progressive) {
        const std::string file = toBytes(jpeg);
        Decompressor source;
        jpeg_mem_src(&source.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpeg_save_markers(&source.cinfo, JPEG_COM, 0xFFFF);
        for (int app = 0; app < 16; ++app) jpeg_save_markers(&source.cinfo, JPEG_APP0 + app, 0xFFFF);
        jpeg_read_header(&source.cinfo, TRUE);
        jvirt_barray_ptr* coefficients = jpeg_read_coefficients(&source.cinfo);

        Compressor target;
        unsigned char* buffer = nullptr;
        unsigned long size = 0;
        jpeg_mem_dest(&target.cinfo, &buffer, &size);
        jpeg_copy_critical_parameters(&source.cinfo, &target.cinfo);
        target.cinfo.optimize_coding = optimize ? TRUE : FALSE;
        if (progressive) jpeg_simple_progression(&target.cinfo);
        jpeg_write_coefficients(&target.cinfo, coefficients);
        for (jpeg_saved_marker_ptr marker = source.cinfo.marker_list; marker != nullptr; marker = marker->next) {
            // The library writes its own JFIF and Adobe segments; copying the old ones would duplicate them.
            if (target.cinfo.write_JFIF_header && marker->marker == JPEG_APP0 && startsWith(marker, "JFIF", 5)) continue;
            if (target.cinfo.write_Adobe_marker && marker->marker == JPEG_APP0 + 14 && startsWith(marker, "Adobe", 5)) continue;
            jpeg_write_marker(&target.cinfo, marker->marker, marker->data, marker->data_length);
        }
        // jpeg_mem_dest reallocates as the file grows and hands the final buffer over only here.
        jpeg_finish_compress(&target.cinfo);
        jpeg_finish_decompress(&source.cinfo);
        std::u16string out(buffer, buffer + size);
        std::free(buffer);
        return out;
    }

private:
    static bool startsWith(jpeg_saved_marker_ptr marker, const char* id, unsigned int length) {
        return marker->data_length >= length && std::memcmp(marker->data, id, length) == 0;
    }

    static std::string toBytes(const std::u16string& units) {
        std::string bytes(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            bytes[i] = static_cast<char>(units[i]);
        }
        return bytes;
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
