#pragma once

#include <Lerc_c_api.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

// One band of float32 heights, row by row from the top left, in and out of LERC. Bytes cross the
// binding as a byte string: one UTF-16 code unit (0-255) per byte.
class LercCodec {
public:
    static std::string version() {
        return std::to_string(LERC_VERSION_MAJOR) + "." + std::to_string(LERC_VERSION_MINOR) + "." + std::to_string(LERC_VERSION_PATCH);
    }

    // Every decoded height stays within maxError of the original; 0 keeps every bit.
    static std::u16string encode(const std::u16string& heights, int width, int height, double maxError) {
        const std::vector<float> values = toFloats(heights, width, height);
        const double bound = boundFor(values, maxError);
        unsigned int size = 0;
        check(lerc_computeCompressedSize(values.data(), kFloat, 1, width, height, 1, 0, nullptr, bound, &size), "sizing");
        std::vector<unsigned char> blob(size);
        unsigned int written = 0;
        check(lerc_encode(values.data(), kFloat, 1, width, height, 1, 0, nullptr, bound, blob.data(), size, &written), "encoding");
        return toUnits(blob.data(), written);
    }

    static std::u16string decode(const std::u16string& blob) {
        const std::vector<unsigned char> bytes = fromUnits(blob);
        const auto size = static_cast<unsigned int>(bytes.size());
        unsigned int info[11] = {};
        double range[3] = {};
        check(lerc_getBlobInfo(bytes.data(), size, info, range, 11, 3), "reading the header");
        const int width = static_cast<int>(info[3]);
        const int height = static_cast<int>(info[4]);
        if (info[1] != kFloat || info[2] != 1 || info[5] != 1) throw std::invalid_argument("this codec reads one band of float32");
        if (info[6] != info[3] * info[4]) throw std::invalid_argument("this blob has missing pixels: decode it with its mask");
        std::vector<float> values(static_cast<size_t>(width) * height);
        check(lerc_decode(bytes.data(), size, 0, nullptr, 1, width, height, 1, kFloat, values.data()), "decoding");
        return toUnits(reinterpret_cast<const unsigned char*>(values.data()), values.size() * sizeof(float));
    }

private:
    static constexpr unsigned int kFloat = 6;  // dt_float in Lerc_types.h

    // LERC quantizes in double precision and rounds back to float32, which can overshoot maxError by
    // half a float32 step (31 µm at 1,000 m). Like Esri's own sample, ask for a little less: one
    // float32 step at the largest height.
    static double boundFor(const std::vector<float>& values, double maxError) {
        if (maxError <= 0) return 0;
        float largest = 0;
        for (const float value : values) largest = std::max(largest, std::fabs(value));
        const double step = static_cast<double>(std::nextafter(largest, INFINITY)) - largest;
        return maxError > step ? maxError - step : 0;
    }

    static void check(lerc_status status, const char* step) {
        static const char* const names[] = {"ok", "failed", "wrong parameter", "buffer too small", "NaN", "uses noData", "dimensions too large"};
        if (status != 0) throw std::runtime_error(std::string("LERC failed ") + step + ": " + (status < 7 ? names[status] : "unknown error"));
    }

    static std::vector<float> toFloats(const std::u16string& units, int width, int height) {
        if (width <= 0 || height <= 0 || units.size() != static_cast<size_t>(width) * height * sizeof(float)) {
            throw std::invalid_argument("expected width * height float32 values");
        }
        std::vector<float> values(static_cast<size_t>(width) * height);
        auto* bytes = reinterpret_cast<unsigned char*>(values.data());
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            bytes[i] = static_cast<unsigned char>(units[i]);
        }
        return values;
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
