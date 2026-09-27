#pragma once

#include <Lerc_c_api.h>

#include <stdexcept>
#include <string>
#include <vector>

// Lossless LERC for any of its eight data types, bands one after another, each row by row. A
// maxZError of 0 keeps every value: LERC raises it to 0.5 for integers, which rounds back to the
// same whole number, and keeps float32 and float64 bit for bit. Bytes cross the binding as a byte
// string: one UTF-16 code unit (0-255) per byte.
class LercLossless {
public:
    // type: "int8", "uint8", "int16", "uint16", "int32", "uint32", "float32" or "float64".
    static std::u16string encode(const std::u16string& values, const std::string& type, int width, int height, int bands) {
        const unsigned int dataType = typeCode(type);
        if (width <= 0 || height <= 0 || bands <= 0 || values.size() != static_cast<size_t>(width) * height * bands * kSizes[dataType]) {
            throw std::invalid_argument("expected width * height * bands values of " + type);
        }
        const std::vector<unsigned char> data = fromUnits(values);
        unsigned int size = 0;
        check(lerc_computeCompressedSize(data.data(), dataType, 1, width, height, bands, 0, nullptr, 0.0, &size), "sizing");
        std::vector<unsigned char> blob(size);
        unsigned int written = 0;
        check(lerc_encode(data.data(), dataType, 1, width, height, bands, 0, nullptr, 0.0, blob.data(), size, &written), "encoding");
        return toUnits(blob.data(), written);
    }

    // The values in the blob's own type, band after band.
    static std::u16string decode(const std::u16string& blob) {
        const std::vector<unsigned char> bytes = fromUnits(blob);
        const auto size = static_cast<unsigned int>(bytes.size());
        unsigned int info[11] = {};
        double range[3] = {};
        check(lerc_getBlobInfo(bytes.data(), size, info, range, 11, 3), "reading the header");
        const unsigned int dataType = info[1];
        const int depth = static_cast<int>(info[2]);
        const int width = static_cast<int>(info[3]);
        const int height = static_cast<int>(info[4]);
        const int bands = static_cast<int>(info[5]);
        if (dataType > 7) throw std::invalid_argument("unknown LERC data type");
        if (info[6] != info[3] * info[4]) throw std::invalid_argument("this blob has missing pixels: decode it with its mask");
        std::vector<unsigned char> values(static_cast<size_t>(depth) * width * height * bands * kSizes[dataType]);
        check(lerc_decode(bytes.data(), size, 0, nullptr, depth, width, height, bands, dataType, values.data()), "decoding");
        return toUnits(values.data(), values.size());
    }

private:
    static constexpr size_t kSizes[] = {1, 1, 2, 2, 4, 4, 4, 8};  // bytes per value, in Lerc_types.h order

    static unsigned int typeCode(const std::string& type) {
        static const char* const names[] = {"int8", "uint8", "int16", "uint16", "int32", "uint32", "float32", "float64"};
        for (unsigned int code = 0; code < 8; ++code) {
            if (type == names[code]) return code;
        }
        throw std::invalid_argument("unknown type " + type);
    }

    static void check(lerc_status status, const char* step) {
        static const char* const names[] = {"ok", "failed", "wrong parameter", "buffer too small", "NaN", "uses noData", "dimensions too large"};
        if (status != 0) throw std::runtime_error(std::string("LERC failed ") + step + ": " + (status < 7 ? names[status] : "unknown error"));
    }

    static std::vector<unsigned char> fromUnits(const std::u16string& units) {
        std::vector<unsigned char> bytes(units.size());
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            bytes[i] = static_cast<unsigned char>(units[i]);
        }
        return bytes;
    }

    static std::u16string toUnits(const unsigned char* bytes, size_t size) {
        std::u16string units(size, u'\0');
        for (size_t i = 0; i < size; ++i) units[i] = bytes[i];
        return units;
    }
};
