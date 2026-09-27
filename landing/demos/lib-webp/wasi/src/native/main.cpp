// A command-line WebP tool for WASI:
//   webp-tool encode <input.ppm> <output.webp> [quality]
//   webp-tool info <input.webp>
#include <webp/decode.h>
#include <webp/encode.h>

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {

using File = std::unique_ptr<FILE, int (*)(FILE*)>;

std::string version() {
    const int packed = WebPGetEncoderVersion();
    return std::to_string(packed >> 16) + "." + std::to_string((packed >> 8) & 0xff) + "." + std::to_string(packed & 0xff);
}

bool readFile(const char* path, std::vector<uint8_t>& data) {
    File file(std::fopen(path, "rb"), std::fclose);
    if (!file) {
        std::fprintf(stderr, "cannot open %s\n", path);
        return false;
    }
    std::vector<uint8_t> chunk(1 << 16);
    size_t got = 0;
    while ((got = std::fread(chunk.data(), 1, chunk.size(), file.get())) > 0) data.insert(data.end(), chunk.begin(), chunk.begin() + got);
    return true;
}

// Binary PPM: "P6", width, height and 255, separated by whitespace or # comments, one whitespace, then RGB.
bool parsePpm(const std::vector<uint8_t>& data, int& width, int& height, size_t& pixels) {
    size_t at = 0;
    const auto token = [&]() {
        for (;;) {
            while (at < data.size() && std::isspace(data[at])) ++at;
            if (at >= data.size() || data[at] != '#') break;
            while (at < data.size() && data[at] != '\n') ++at;
        }
        std::string text;
        while (at < data.size() && !std::isspace(data[at])) text += static_cast<char>(data[at++]);
        return text;
    };
    if (token() != "P6") return false;
    width = std::atoi(token().c_str());
    height = std::atoi(token().c_str());
    const int maxval = std::atoi(token().c_str());
    pixels = at + 1;
    return width > 0 && height > 0 && maxval == 255 && pixels <= data.size() && data.size() - pixels >= static_cast<size_t>(width) * height * 3;
}

int encode(const char* input, const char* output, float quality) {
    std::vector<uint8_t> data;
    int width = 0;
    int height = 0;
    size_t pixels = 0;
    if (!readFile(input, data)) return 1;
    if (!parsePpm(data, width, height, pixels)) {
        std::fprintf(stderr, "%s is not a binary PPM (P6, maxval 255)\n", input);
        return 1;
    }
    uint8_t* webp = nullptr;
    const size_t size = WebPEncodeRGB(data.data() + pixels, width, height, width * 3, quality, &webp);
    File out(std::fopen(output, "wb"), std::fclose);
    const bool written = size && out && std::fwrite(webp, 1, size, out.get()) == size;
    WebPFree(webp);
    if (!written) {
        std::fprintf(stderr, "cannot encode %s to %s\n", input, output);
        return 1;
    }
    std::printf("webp %s encode: %s %dx%d -> %s, %zu B at quality %g\n", version().c_str(), input, width, height, output, size, quality);
    return 0;
}

int info(const char* input) {
    std::vector<uint8_t> data;
    if (!readFile(input, data)) return 1;
    WebPBitstreamFeatures features;
    if (WebPGetFeatures(data.data(), data.size(), &features) != VP8_STATUS_OK) {
        std::fprintf(stderr, "%s is not a WebP file\n", input);
        return 1;
    }
    const char* format = features.format == 1 ? "lossy" : features.format == 2 ? "lossless" : "mixed";
    std::printf("webp %s info: %s %dx%d %s, %zu B, alpha: %s, animated: %s\n", version().c_str(), input, features.width, features.height, format, data.size(),
                features.has_alpha ? "yes" : "no", features.has_animation ? "yes" : "no");
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc >= 4 && std::strcmp(argv[1], "encode") == 0) return encode(argv[2], argv[3], argc >= 5 ? std::strtof(argv[4], nullptr) : 75.0f);
    if (argc == 3 && std::strcmp(argv[1], "info") == 0) return info(argv[2]);
    std::fprintf(stderr, "usage: webp-tool encode <input.ppm> <output.webp> [quality]\n       webp-tool info <input.webp>\n");
    return 2;
}
