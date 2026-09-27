#pragma once

#include <Lerc_c_api.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

// One band of float32 heights with gaps. Pixels equal to noData (NaN too, when noData is NaN) go into
// LERC's validity mask, a bit per pixel, instead of into the values; decoding puts noData back. Bytes
// cross the binding as a byte string: one UTF-16 code unit (0-255) per byte.
class LercNoData {
public:
    static std::u16string encode(const std::u16string& heights, int width, int height, double noData, double maxError) {
        const std::vector<float> values = toFloats(heights, width, height);
        std::vector<unsigned char> valid(values.size());
        float largest = 0;
        for (size_t i = 0; i < values.size(); ++i) {
            valid[i] = missing(values[i], noData) ? 0 : 1;
            if (valid[i]) largest = std::max(largest, std::fabs(values[i]));
        }
        // LERC rounds back to float32, which can overshoot maxError by half a float32 step: ask for one step less.
        const double step = static_cast<double>(std::nextafter(largest, INFINITY)) - largest;
        const double bound = maxError > step ? maxError - step : 0;
        unsigned int size = 0;
        check(lerc_computeCompressedSize(values.data(), kFloat, 1, width, height, 1, 1, valid.data(), bound, &size), "sizing");
        std::vector<unsigned char> blob(size);
        unsigned int written = 0;
        check(lerc_encode(values.data(), kFloat, 1, width, height, 1, 1, valid.data(), bound, blob.data(), size, &written), "encoding");
        return toUnits(blob.data(), written);
    }

    static std::u16string decode(const std::u16string& blob, double noData) {
        const std::vector<unsigned char> bytes = fromUnits(blob);
        const auto size = static_cast<unsigned int>(bytes.size());
        unsigned int info[11] = {};
        double range[3] = {};
        check(lerc_getBlobInfo(bytes.data(), size, info, range, 11, 3), "reading the header");
        const int width = static_cast<int>(info[3]);
        const int height = static_cast<int>(info[4]);
        if (info[1] != kFloat || info[2] != 1 || info[5] != 1) throw std::invalid_argument("this reads one band of float32");
        std::vector<float> values(static_cast<size_t>(width) * height);
        std::vector<unsigned char> valid(values.size());
        check(lerc_decode(bytes.data(), size, 1, valid.data(), 1, width, height, 1, kFloat, values.data()), "decoding");
        for (size_t i = 0; i < values.size(); ++i) {
            if (!valid[i]) values[i] = static_cast<float>(noData);
        }
        return toUnits(reinterpret_cast<const unsigned char*>(values.data()), values.size() * sizeof(float));
    }

private:
    static constexpr unsigned int kFloat = 6;  // dt_float in Lerc_types.h

    static bool missing(float value, double noData) { return std::isnan(noData) ? std::isnan(value) : value == static_cast<float>(noData); }

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
