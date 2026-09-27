// A command-line LERC for WASI:
//   lerc-tool encode <heights.f32> <width> <height> <maxError> <out.lerc>
//   lerc-tool info <in.lerc>
//   lerc-tool decode <in.lerc> <out.f32> [original.f32]
#include <Lerc_c_api.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>

namespace {

constexpr unsigned int kFloat = 6;  // dt_float in Lerc_types.h

using File = std::unique_ptr<FILE, int (*)(FILE*)>;

bool readFile(const char* path, std::vector<unsigned char>& data) {
    File file(std::fopen(path, "rb"), std::fclose);
    if (!file) {
        std::fprintf(stderr, "cannot open %s\n", path);
        return false;
    }
    data.clear();
    unsigned char chunk[4096];
    size_t count = 0;
    while ((count = std::fread(chunk, 1, sizeof chunk, file.get())) > 0) data.insert(data.end(), chunk, chunk + count);
    return true;
}

bool writeFile(const char* path, const void* data, size_t size) {
    File file(std::fopen(path, "wb"), std::fclose);
    if (file && std::fwrite(data, 1, size, file.get()) == size) return true;
    std::fprintf(stderr, "cannot write %s\n", path);
    return false;
}

bool failed(lerc_status status, const char* step) {
    if (status == 0) return false;
    std::fprintf(stderr, "LERC failed %s with status %u\n", step, status);
    return true;
}

int encode(const char* input, int width, int height, double maxError, const char* output) {
    std::vector<unsigned char> raw;
    if (!readFile(input, raw)) return 1;
    if (width <= 0 || height <= 0 || raw.size() != static_cast<size_t>(width) * height * sizeof(float)) {
        std::fprintf(stderr, "%s does not hold %d x %d float32 values\n", input, width, height);
        return 1;
    }
    std::vector<float> values(static_cast<size_t>(width) * height);
    std::memcpy(values.data(), raw.data(), raw.size());
    // LERC rounds back to float32, which can overshoot maxError by half a float32 step: ask for one step less.
    float largest = 0;
    for (const float value : values) largest = std::max(largest, std::fabs(value));
    const double step = static_cast<double>(std::nextafter(largest, INFINITY)) - largest;
    const double bound = maxError > step ? maxError - step : 0;
    unsigned int size = 0;
    if (failed(lerc_computeCompressedSize(values.data(), kFloat, 1, width, height, 1, 0, nullptr, bound, &size), "sizing")) return 1;
    std::vector<unsigned char> blob(size);
    unsigned int written = 0;
    if (failed(lerc_encode(values.data(), kFloat, 1, width, height, 1, 0, nullptr, bound, blob.data(), size, &written), "encoding")) return 1;
    if (!writeFile(output, blob.data(), written)) return 1;
    std::printf("LERC %d.%d.%d encode: %s -> %s, %zu B -> %u B within %g\n", LERC_VERSION_MAJOR, LERC_VERSION_MINOR, LERC_VERSION_PATCH, input, output, raw.size(),
                written, maxError);
    return 0;
}

int info(const char* input) {
    std::vector<unsigned char> blob;
    if (!readFile(input, blob)) return 1;
    unsigned int header[11] = {};  // version, type, depth, width, height, bands, valid pixels, blob size, masks, depth, noData bands
    double range[3] = {};          // zMin, zMax, the largest error the encoder allowed
    if (failed(lerc_getBlobInfo(blob.data(), static_cast<unsigned int>(blob.size()), header, range, 11, 3), "reading the header")) return 1;
    static const char* const types[] = {"int8", "uint8", "int16", "uint16", "int32", "uint32", "float32", "float64"};
    char codec[16] = "Lerc1";
    if (header[0] > 0) std::snprintf(codec, sizeof codec, "Lerc2 v%u", header[0]);
    std::printf("%s: %s, %ux%u, %u band%s of %s, %u valid pixels, %.3f to %.3f, max error %.7f\n", input, codec, header[3], header[4], header[5],
                header[5] == 1 ? "" : "s", header[1] < 8 ? types[header[1]] : "unknown", header[6], range[0], range[1], range[2]);
    return 0;
}

int decode(const char* input, const char* output, const char* original) {
    std::vector<unsigned char> blob;
    if (!readFile(input, blob)) return 1;
    const auto size = static_cast<unsigned int>(blob.size());
    unsigned int header[11] = {};
    double range[3] = {};
    if (failed(lerc_getBlobInfo(blob.data(), size, header, range, 11, 3), "reading the header")) return 1;
    if (header[1] != kFloat || header[2] != 1 || header[5] != 1) {
        std::fprintf(stderr, "%s is not one band of float32\n", input);
        return 1;
    }
    const int width = static_cast<int>(header[3]);
    const int height = static_cast<int>(header[4]);
    std::vector<float> values(static_cast<size_t>(width) * height);
    if (failed(lerc_decode(blob.data(), size, 0, nullptr, 1, width, height, 1, kFloat, values.data()), "decoding")) return 1;
    const size_t bytes = values.size() * sizeof(float);
    if (!writeFile(output, values.data(), bytes)) return 1;
    if (!original) {
        std::printf("%s -> %s, %zu B\n", input, output, bytes);
        return 0;
    }
    std::vector<unsigned char> raw;
    if (!readFile(original, raw)) return 1;
    if (raw.size() != bytes) {
        std::fprintf(stderr, "%s is not the same size as %s\n", original, output);
        return 1;
    }
    std::vector<float> before(values.size());
    std::memcpy(before.data(), raw.data(), raw.size());
    double worst = 0;
    for (size_t i = 0; i < values.size(); ++i) worst = std::max(worst, std::fabs(static_cast<double>(values[i]) - before[i]));
    std::printf("%s -> %s, %zu B, largest difference from %s %.7f\n", input, output, bytes, original, worst);
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc == 7 && std::strcmp(argv[1], "encode") == 0) return encode(argv[2], std::atoi(argv[3]), std::atoi(argv[4]), std::atof(argv[5]), argv[6]);
    if (argc == 3 && std::strcmp(argv[1], "info") == 0) return info(argv[2]);
    if ((argc == 4 || argc == 5) && std::strcmp(argv[1], "decode") == 0) return decode(argv[2], argv[3], argc == 5 ? argv[4] : nullptr);
    std::fprintf(stderr,
                 "usage: lerc-tool encode <heights.f32> <width> <height> <maxError> <out.lerc>\n"
                 "       lerc-tool info <in.lerc>\n"
                 "       lerc-tool decode <in.lerc> <out.f32> [original.f32]\n");
    return 2;
}
