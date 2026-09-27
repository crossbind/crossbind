#pragma once

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <jpeglib.h>

#include <memory>
#include <stdexcept>
#include <string>

// What every app needs around libjpeg-turbo: codec objects that throw libjpeg's message instead of
// calling exit(), files by path, and small JSON and header helpers.
namespace jpegio {

inline std::string jsonString(const std::string& text) {
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

inline std::string fixed(double value, int decimals) {
    char text[32];
    std::snprintf(text, sizeof(text), "%.*f", decimals, value);
    return text;
}

[[noreturn]] inline void throwError(j_common_ptr cinfo) {
    char message[JMSG_LENGTH_MAX];
    (*cinfo->err->format_message)(cinfo, message);
    throw std::runtime_error(message);
}

// A damaged file (truncated, a corrupt block) is decoded as far as it goes with warnings rather
// than errors. libjpeg counts them in num_warnings and passes the first to output_message, which
// keeps its text here instead of printing it. `pub` comes first, as in libjpeg's example.c.
struct ErrorManager {
    jpeg_error_mgr pub;
    char firstWarning[JMSG_LENGTH_MAX];
};

inline void keepFirstWarning(j_common_ptr cinfo) {
    ErrorManager* manager = reinterpret_cast<ErrorManager*>(cinfo->err);
    if (manager->firstWarning[0] == '\0') (*cinfo->err->format_message)(cinfo, manager->firstWarning);
}

inline void useErrorManager(j_common_ptr cinfo, ErrorManager& manager) {
    cinfo->err = jpeg_std_error(&manager.pub);
    manager.pub.error_exit = throwError;
    manager.pub.output_message = keepFirstWarning;
    manager.firstWarning[0] = '\0';
}

struct Decompressor {
    jpeg_decompress_struct cinfo;
    ErrorManager jerr;
    Decompressor() {
        useErrorManager(reinterpret_cast<j_common_ptr>(&cinfo), jerr);
        jpeg_create_decompress(&cinfo);
    }
    ~Decompressor() { jpeg_destroy_decompress(&cinfo); }
    Decompressor(const Decompressor&) = delete;
    Decompressor& operator=(const Decompressor&) = delete;

    // "warnings":n,"warning":"<the first>"|null
    std::string warnings() const {
        return "\"warnings\":" + std::to_string(jerr.pub.num_warnings) + ",\"warning\":" + (jerr.pub.num_warnings ? jsonString(jerr.firstWarning) : std::string("null"));
    }
};

struct Compressor {
    jpeg_compress_struct cinfo;
    ErrorManager jerr;
    Compressor() {
        useErrorManager(reinterpret_cast<j_common_ptr>(&cinfo), jerr);
        jpeg_create_compress(&cinfo);
    }
    ~Compressor() { jpeg_destroy_compress(&cinfo); }
    Compressor(const Compressor&) = delete;
    Compressor& operator=(const Compressor&) = delete;
};

using File = std::unique_ptr<FILE, int (*)(FILE*)>;

inline File open(const std::string& path, const char* mode) {
    File file(std::fopen(path.c_str(), mode), std::fclose);
    if (!file) throw std::runtime_error("cannot open " + path);
    return file;
}

inline std::string readFile(const std::string& path) {
    File file = open(path, "rb");
    std::string data;
    char chunk[16384];
    size_t count = 0;
    while ((count = std::fread(chunk, 1, sizeof(chunk), file.get())) > 0) data.append(chunk, count);
    return data;
}

inline void writeFile(const std::string& path, const std::string& data) {
    File file = open(path, "wb");
    if (!data.empty() && std::fwrite(data.data(), 1, data.size(), file.get()) != data.size()) throw std::runtime_error("cannot write " + path);
}

inline void saveAllMarkers(j_decompress_ptr cinfo) {
    jpeg_save_markers(cinfo, JPEG_COM, 0xFFFF);
    for (int app = 0; app < 16; ++app) jpeg_save_markers(cinfo, JPEG_APP0 + app, 0xFFFF);
}

inline bool startsWith(jpeg_saved_marker_ptr marker, const char* id, unsigned int length) {
    return marker->data_length >= length && std::memcmp(marker->data, id, length) == 0;
}

inline std::string markerName(int marker) { return marker == JPEG_COM ? "COM" : "APP" + std::to_string(marker - JPEG_APP0); }

inline const char* markerLabel(jpeg_saved_marker_ptr marker) {
    if (marker->marker == JPEG_COM) return "comment";
    if (marker->marker == JPEG_APP0 && startsWith(marker, "JFIF", 5)) return "JFIF";
    if (marker->marker == JPEG_APP0 && startsWith(marker, "JFXX", 5)) return "JFIF thumbnail";
    if (marker->marker == JPEG_APP0 + 1 && startsWith(marker, "Exif\0", 6)) return "Exif";
    if (marker->marker == JPEG_APP0 + 1 && startsWith(marker, "http://ns.adobe.com/xap/1.0/", 29)) return "XMP";
    if (marker->marker == JPEG_APP0 + 1 && startsWith(marker, "http://ns.adobe.com/xmp/extension/", 35)) return "XMP extension";
    if (marker->marker == JPEG_APP0 + 2 && startsWith(marker, "ICC_PROFILE", 12)) return "ICC profile";
    if (marker->marker == JPEG_APP0 + 2 && startsWith(marker, "MPF", 4)) return "MPF";
    if (marker->marker == JPEG_APP0 + 13 && startsWith(marker, "Photoshop 3.0", 14)) return "Photoshop";
    if (marker->marker == JPEG_APP0 + 14 && startsWith(marker, "Adobe", 5)) return "Adobe";
    return "unknown";
}

// "4:4:4", "4:2:2", "4:2:0", ... from the luma sampling factors; chroma is assumed at 1x1.
inline std::string subsampling(const jpeg_decompress_struct& info) {
    if (info.num_components == 1) return "greyscale";
    const int h = info.comp_info[0].h_samp_factor;
    const int v = info.comp_info[0].v_samp_factor;
    for (int ci = 1; ci < info.num_components; ++ci) {
        if (info.comp_info[ci].h_samp_factor != 1 || info.comp_info[ci].v_samp_factor != 1) return "custom";
    }
    if (h == 1 && v == 1) return "4:4:4";
    if (h == 2 && v == 1) return "4:2:2";
    if (h == 2 && v == 2) return "4:2:0";
    if (h == 1 && v == 2) return "4:4:0";
    if (h == 4 && v == 1) return "4:1:1";
    return std::to_string(h) + "x" + std::to_string(v);
}

// The IJG quality (1-100) whose scaled standard luminance table is closest to table 0, as
// jpeg_set_quality builds it; `exact` when it matches entry for entry. Other encoders use other
// tables, so for them this is an estimate.
inline std::string estimatedQuality(const jpeg_decompress_struct& info) {
    static const unsigned int standard[64] = {16, 11, 10, 16, 24,  40,  51,  61,  12, 12, 14, 19, 26,  58,  60,  55,  14, 13, 16, 24, 40,  57,
                                              69, 56, 14, 17, 22,  29,  51,  87,  80, 62, 18, 22, 37,  56,  68,  109, 103, 77, 24, 35, 55,  64,
                                              81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95,  98,  112, 100, 103, 99};
    const JQUANT_TBL* table = info.quant_tbl_ptrs[0];
    if (table == nullptr) return "null";
    int best = 0;
    long bestDistance = -1;
    for (int quality = 1; quality <= 100; ++quality) {
        const long scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
        long distance = 0;
        for (int i = 0; i < 64; ++i) {
            long value = (static_cast<long>(standard[i]) * scale + 50) / 100;
            value = value < 1 ? 1 : value > 255 ? 255 : value;
            distance += std::labs(value - static_cast<long>(table->quantval[i]));
        }
        if (bestDistance < 0 || distance < bestDistance) {
            best = quality;
            bestDistance = distance;
        }
    }
    return "{\"quality\":" + std::to_string(best) + ",\"exact\":" + (bestDistance == 0 ? "true" : "false") + "}";
}

}  // namespace jpegio
