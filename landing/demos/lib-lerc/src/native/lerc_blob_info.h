#pragma once

#include <Lerc_c_api.h>

#include <cstdio>
#include <stdexcept>
#include <string>

// What a LERC blob holds, read from its header without decoding a pixel. Bytes cross the binding as
// a byte string: one UTF-16 code unit (0-255) per byte.
class LercBlobInfo {
public:
    // {"codec","width","height","depth","bands","type","validPixels","masks","blobSize","zMin","zMax","maxZErrorUsed"}
    static std::string read(const std::u16string& blob) {
        std::string bytes(blob.size(), '\0');
        for (size_t i = 0; i < blob.size(); ++i) {
            if (blob[i] > 0xFF) throw std::invalid_argument("not a byte string");
            bytes[i] = static_cast<char>(blob[i]);
        }
        unsigned int info[11] = {};  // version, type, depth, width, height, bands, valid pixels, blob size, masks, depth, noData bands
        double range[3] = {};        // zMin, zMax, and the largest error the encoder allowed
        const lerc_status status = lerc_getBlobInfo(reinterpret_cast<const unsigned char*>(bytes.data()), static_cast<unsigned int>(bytes.size()), info, range, 11, 3);
        if (status != 0) throw std::runtime_error("not a LERC blob (status " + std::to_string(status) + ")");
        static const char* const types[] = {"int8", "uint8", "int16", "uint16", "int32", "uint32", "float32", "float64"};
        const std::string codec = info[0] == 0 ? "Lerc1" : "Lerc2 v" + std::to_string(info[0]);
        return "{\"codec\":\"" + codec + "\",\"width\":" + std::to_string(info[3]) + ",\"height\":" + std::to_string(info[4]) + ",\"depth\":" + std::to_string(info[2]) +
               ",\"bands\":" + std::to_string(info[5]) + ",\"type\":\"" + (info[1] < 8 ? types[info[1]] : "unknown") + "\",\"validPixels\":" + std::to_string(info[6]) +
               ",\"masks\":" + std::to_string(info[8]) + ",\"blobSize\":" + std::to_string(info[7]) + ",\"zMin\":" + number(range[0]) + ",\"zMax\":" + number(range[1]) +
               ",\"maxZErrorUsed\":" + number(range[2]) + "}";
    }

private:
    // 17 significant digits read back as the same double.
    static std::string number(double value) {
        char text[40];
        std::snprintf(text, sizeof text, "%.17g", value);
        return text;
    }
};
