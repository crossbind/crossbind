#pragma once

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <jpeglib.h>

#include <stdexcept>
#include <string>

// APPn and COM segments carry everything that is not the image: EXIF (APP1), ICC profiles (APP2),
// XMP, comments. libjpeg-turbo skips them unless asked: jpeg_save_markers keeps them for reading,
// jpeg_write_marker adds new ones.
class JpegMarkers {
public:
    // Sets the EXIF orientation (1-8) and a comment without re-encoding: the coefficients are copied,
    // and every other segment is kept.
    static std::u16string tag(const std::u16string& jpeg, int orientation, const std::string& comment) {
        if (orientation < 1 || orientation > 8) throw std::invalid_argument("orientation must be between 1 and 8");
        const std::string file = toBytes(jpeg);
        Decompressor source;
        open(source, file);
        jvirt_barray_ptr* coefficients = jpeg_read_coefficients(&source.cinfo);

        Compressor target;
        unsigned char* buffer = nullptr;
        unsigned long size = 0;
        jpeg_mem_dest(&target.cinfo, &buffer, &size);
        jpeg_copy_critical_parameters(&source.cinfo, &target.cinfo);
        jpeg_write_coefficients(&target.cinfo, coefficients);
        const std::string exif = exifWithOrientation(orientation);
        jpeg_write_marker(&target.cinfo, JPEG_APP0 + 1, reinterpret_cast<const JOCTET*>(exif.data()), static_cast<unsigned int>(exif.size()));
        for (jpeg_saved_marker_ptr marker = source.cinfo.marker_list; marker != nullptr; marker = marker->next) {
            if (marker->marker == JPEG_COM || (marker->marker == JPEG_APP0 + 1 && startsWith(marker, "Exif\0", 6))) continue;  // replaced
            if (target.cinfo.write_JFIF_header && marker->marker == JPEG_APP0 && startsWith(marker, "JFIF", 5)) continue;  // written by the library
            jpeg_write_marker(&target.cinfo, marker->marker, marker->data, marker->data_length);
        }
        jpeg_write_marker(&target.cinfo, JPEG_COM, reinterpret_cast<const JOCTET*>(comment.data()), static_cast<unsigned int>(comment.size()));
        // jpeg_mem_dest reallocates as the file grows and hands the final buffer over only here.
        jpeg_finish_compress(&target.cinfo);
        jpeg_finish_decompress(&source.cinfo);
        std::u16string out(buffer, buffer + size);
        std::free(buffer);
        return out;
    }

    // {"markers":[{"marker":"APP1","label":"Exif","bytes":32},...],"orientation":6,"comment":"..."}:
    // every APPn and COM segment in file order (a COM has no label), the EXIF orientation (0 when
    // there is none) and the first comment.
    static std::string read(const std::u16string& jpeg) {
        const std::string file = toBytes(jpeg);
        Decompressor decoder;
        open(decoder, file);
        std::string markers;
        int orientation = 0;
        std::string comment;
        bool hasComment = false;
        for (jpeg_saved_marker_ptr marker = decoder.cinfo.marker_list; marker != nullptr; marker = marker->next) {
            const bool com = marker->marker == JPEG_COM;
            if (com && !hasComment) {
                comment.assign(reinterpret_cast<const char*>(marker->data), marker->data_length);
                hasComment = true;
            }
            if (marker->marker == JPEG_APP0 + 1 && startsWith(marker, "Exif\0", 6) && orientation == 0) orientation = exifOrientation(marker);
            markers += std::string(markers.empty() ? "" : ",") + "{\"marker\":\"" + (com ? std::string("COM") : "APP" + std::to_string(marker->marker - JPEG_APP0)) +
                       "\",\"label\":\"" + label(marker) + "\",\"bytes\":" + std::to_string(marker->data_length) + "}";
        }
        return "{\"markers\":[" + markers + "],\"orientation\":" + std::to_string(orientation) + ",\"comment\":" + jsonString(comment) + "}";
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

    // Reads the header and keeps every APPn and COM segment.
    static void open(Decompressor& decoder, const std::string& file) {
        jpeg_mem_src(&decoder.cinfo, reinterpret_cast<const unsigned char*>(file.data()), file.size());
        jpeg_save_markers(&decoder.cinfo, JPEG_COM, 0xFFFF);
        for (int app = 0; app < 16; ++app) jpeg_save_markers(&decoder.cinfo, JPEG_APP0 + app, 0xFFFF);
        jpeg_read_header(&decoder.cinfo, TRUE);
    }

    static const char* label(jpeg_saved_marker_ptr marker) {
        if (marker->marker == JPEG_COM) return "";
        if (marker->marker == JPEG_APP0 && startsWith(marker, "JFIF", 5)) return "JFIF";
        if (marker->marker == JPEG_APP0 + 1 && startsWith(marker, "Exif\0", 6)) return "Exif";
        if (marker->marker == JPEG_APP0 + 1 && startsWith(marker, "http://ns.adobe.com/xap/1.0/", 29)) return "XMP";
        if (marker->marker == JPEG_APP0 + 2 && startsWith(marker, "ICC_PROFILE", 12)) return "ICC profile";
        if (marker->marker == JPEG_APP0 + 14 && startsWith(marker, "Adobe", 5)) return "Adobe";
        return "unknown";
    }

    static bool startsWith(jpeg_saved_marker_ptr marker, const char* id, unsigned int length) {
        return marker->data_length >= length && std::memcmp(marker->data, id, length) == 0;
    }

    // "Exif\0\0", then a big-endian TIFF header and one IFD holding tag 0x0112 (Orientation, SHORT).
    static std::string exifWithOrientation(int orientation) {
        const unsigned char bytes[] = {'E', 'x', 'i', 'f', 0, 0, 'M', 'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1,
                                       0, static_cast<unsigned char>(orientation), 0, 0, 0, 0, 0, 0};
        return std::string(reinterpret_cast<const char*>(bytes), sizeof(bytes));
    }

    // Reads Orientation from IFD0 of an EXIF segment, in either TIFF byte order; 0 when it is absent.
    static int exifOrientation(jpeg_saved_marker_ptr marker) {
        const unsigned char* tiff = marker->data + 6;
        const size_t length = marker->data_length - 6;
        if (length < 8) return 0;
        const bool little = tiff[0] == 'I';
        const auto read16 = [&](size_t at) { return little ? tiff[at] | tiff[at + 1] << 8 : tiff[at] << 8 | tiff[at + 1]; };
        const auto read32 = [&](size_t at) { return static_cast<size_t>(read16(little ? at + 2 : at)) << 16 | static_cast<size_t>(read16(little ? at : at + 2)); };
        const size_t ifd = read32(4);
        if (ifd + 2 > length) return 0;
        const size_t count = static_cast<size_t>(read16(ifd));
        for (size_t entry = 0; entry < count && ifd + 2 + entry * 12 + 12 <= length; ++entry) {
            const size_t at = ifd + 2 + entry * 12;
            if (read16(at) == 0x0112) return read16(at + 8);
        }
        return 0;
    }

    static std::string jsonString(const std::string& text) {
        std::string out = "\"";
        for (const unsigned char c : text) {
            if (c == '"' || c == '\\') {
                out += '\\';
                out += static_cast<char>(c);
            } else if (c < 0x20) {
                char escaped[8];
                std::snprintf(escaped, sizeof(escaped), "\\u%04x", c);
                out += escaped;
            } else {
                out += static_cast<char>(c);
            }
        }
        return out + "\"";
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
