#pragma once

#include <Lerc_c_api.h>

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// What the LERC apps share: one band of float32 with an optional validity mask in and out of LERC,
// the blob header, and the file and JSON plumbing. Files live in the module's filesystem, where the
// page writes its inputs and reads the results back with getFileBytes.
namespace grid {

constexpr unsigned int kFloat = 6;  // dt_float in Lerc_types.h

inline void check(lerc_status status, const char* step) {
    static const char* const names[] = {"ok", "failed", "wrong parameter", "buffer too small", "NaN", "uses noData", "dimensions too large"};
    if (status != 0) throw std::runtime_error(std::string("LERC failed ") + step + ": " + (status < 7 ? names[status] : "unknown error"));
}

// The shortest decimal that reads back as the same double; null when there is none.
inline std::string number(double value) {
    if (!std::isfinite(value)) return "null";
    char text[40];
    const auto result = std::to_chars(text, text + sizeof text, value);
    return std::string(text, result.ptr);
}

inline std::string read(const std::string& path) {
    std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "rb"), std::fclose);
    if (!file) throw std::runtime_error("cannot open " + path);
    std::string data;
    std::vector<char> chunk(1 << 16);  // on the heap: the wasm stack is 64 KB
    size_t count = 0;
    while ((count = std::fread(chunk.data(), 1, chunk.size(), file.get())) > 0) data.append(chunk.data(), count);
    return data;
}

inline void write(const std::string& path, const void* data, size_t size) {
    std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "wb"), std::fclose);
    if (!file || (size && std::fwrite(data, 1, size, file.get()) != size)) throw std::runtime_error("cannot write " + path);
}

// LERC quantizes in double precision and rounds back to float32, which can overshoot maxError by half
// a float32 step, so the apps ask for one float32 step less, taken at the largest valid magnitude.
inline double boundFor(const std::vector<float>& values, const std::vector<unsigned char>* mask, double maxError) {
    if (maxError <= 0) return 0;
    float largest = 0;
    for (size_t i = 0; i < values.size(); ++i) {
        if (!mask || (*mask)[i]) largest = std::max(largest, std::fabs(values[i]));
    }
    const double step = static_cast<double>(std::nextafter(largest, INFINITY)) - largest;
    return maxError > step ? maxError - step : 0;
}

// One band of float32; mask is null or one byte per pixel, 1 where the pixel holds a value.
inline std::string encode(const std::vector<float>& values, int width, int height, const std::vector<unsigned char>* mask, double maxError) {
    const double bound = boundFor(values, mask, maxError);
    const int masks = mask ? 1 : 0;
    const unsigned char* valid = mask ? mask->data() : nullptr;
    unsigned int size = 0;
    check(lerc_computeCompressedSize(values.data(), kFloat, 1, width, height, 1, masks, valid, bound, &size), "sizing");
    std::string blob(size, '\0');
    unsigned int written = 0;
    check(lerc_encode(values.data(), kFloat, 1, width, height, 1, masks, valid, bound, reinterpret_cast<unsigned char*>(&blob[0]), size, &written), "encoding");
    blob.resize(written);
    return blob;
}

struct Header {
    unsigned int version = 0;  // 0 for legacy Lerc1, else the Lerc2 codec version
    unsigned int type = 0;     // 0-7: int8, uint8, int16, uint16, int32, uint32, float32, float64
    unsigned int depth = 0;    // values per pixel
    unsigned int width = 0;
    unsigned int height = 0;
    unsigned int bands = 0;
    unsigned int validPixels = 0;  // in the first band
    unsigned int blobSize = 0;     // all bands
    unsigned int masks = 0;        // 0, 1, or one per band
    unsigned int usesNoData = 0;
    double zMin = 0;
    double zMax = 0;
    double maxZErrorUsed = 0;
};

inline Header header(const std::string& blob) {
    unsigned int info[11] = {};
    double range[3] = {};
    check(lerc_getBlobInfo(reinterpret_cast<const unsigned char*>(blob.data()), static_cast<unsigned int>(blob.size()), info, range, 11, 3), "reading the header");
    Header h;
    h.version = info[0];
    h.type = info[1];
    h.depth = info[2];
    h.width = info[3];
    h.height = info[4];
    h.bands = info[5];
    h.validPixels = info[6];
    h.blobSize = info[7];
    h.masks = info[8];
    h.usesNoData = info[10];
    h.zMin = range[0];
    h.zMax = range[1];
    h.maxZErrorUsed = range[2];
    return h;
}

inline const char* typeName(unsigned int type) {
    static const char* const names[] = {"int8", "uint8", "int16", "uint16", "int32", "uint32", "float32", "float64"};
    return type < 8 ? names[type] : "unknown";
}

// One band of float32 with every pixel valid, as the apps write them.
inline std::vector<float> decode(const std::string& blob) {
    const Header h = header(blob);
    if (h.type != kFloat || h.depth != 1 || h.bands != 1) throw std::invalid_argument("expected one band of float32");
    std::vector<float> values(static_cast<size_t>(h.width) * h.height);
    check(lerc_decode(reinterpret_cast<const unsigned char*>(blob.data()), static_cast<unsigned int>(blob.size()), 0, nullptr, 1, static_cast<int>(h.width),
                      static_cast<int>(h.height), 1, kFloat, values.data()),
          "decoding");
    return values;
}

inline double maxAbsDiff(const std::vector<float>& a, const std::vector<float>& b) {
    if (a.size() != b.size()) throw std::invalid_argument("the two grids differ in size");
    double worst = 0;
    for (size_t i = 0; i < a.size(); ++i) worst = std::max(worst, std::fabs(static_cast<double>(a[i]) - static_cast<double>(b[i])));
    return worst;
}

}  // namespace grid
