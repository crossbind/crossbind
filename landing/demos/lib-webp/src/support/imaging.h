#pragma once

#include <webp/decode.h>
#include <webp/encode.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

// The libwebp calls the apps share: encode RGBA with a WebPConfig, decode back to RGBA, and measure
// how far the result is from the original.
namespace imaging {

struct Image {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> rgba;
};

inline void requireRgba(const std::vector<uint8_t>& rgba, int width, int height) {
    if (width <= 0 || height <= 0 || rgba.size() != static_cast<size_t>(width) * height * 4) {
        throw std::invalid_argument("expected width * height * 4 bytes of RGBA");
    }
}

inline std::vector<uint8_t> encode(const WebPConfig& config, const std::vector<uint8_t>& rgba, int width, int height) {
    if (!WebPValidateConfig(&config)) throw std::invalid_argument("invalid encoder settings");
    requireRgba(rgba, width, height);
    WebPPicture picture;
    if (!WebPPictureInit(&picture)) throw std::runtime_error("libwebp version mismatch");
    picture.width = width;
    picture.height = height;
    picture.use_argb = 1;
    WebPMemoryWriter writer;
    WebPMemoryWriterInit(&writer);
    picture.writer = WebPMemoryWrite;
    picture.custom_ptr = &writer;
    const bool ok = WebPPictureImportRGBA(&picture, rgba.data(), width * 4) && WebPEncode(&config, &picture);
    const WebPEncodingError error = picture.error_code;
    WebPPictureFree(&picture);
    if (!ok) {
        WebPMemoryWriterClear(&writer);
        throw std::runtime_error("WebP encoding failed with error " + std::to_string(error));
    }
    std::vector<uint8_t> webp(writer.mem, writer.mem + writer.size);
    WebPMemoryWriterClear(&writer);
    return webp;
}

inline Image decode(const std::vector<uint8_t>& webp) {
    Image image;
    uint8_t* rgba = WebPDecodeRGBA(webp.data(), webp.size(), &image.width, &image.height);
    if (!rgba) throw std::runtime_error("not a decodable WebP image");
    image.rgba.assign(rgba, rgba + static_cast<size_t>(image.width) * image.height * 4);
    WebPFree(rgba);
    return image;
}

// What a viewer sees on a white page: colour under transparent pixels is invisible, so it is blended away.
inline std::vector<uint8_t> onWhite(const std::vector<uint8_t>& rgba) {
    std::vector<uint8_t> out(rgba);
    for (size_t i = 0; i < out.size(); i += 4) {
        const unsigned alpha = out[i + 3];
        if (alpha == 255) continue;
        for (size_t c = 0; c < 3; ++c) out[i + c] = static_cast<uint8_t>((out[i + c] * alpha + 255 * (255 - alpha) + 127) / 255);
        out[i + 3] = 255;
    }
    return out;
}

struct Fidelity {
    double psnr = 0;
    double ssim = 0;
};

// PSNR over red, green and blue (99 dB when identical, as libwebp reports it), and libwebp's SSIM over
// the same channels (1 when identical), both of the images as seen on white.
inline Fidelity measure(const std::vector<uint8_t>& original, const std::vector<uint8_t>& decoded, int width, int height) {
    requireRgba(original, width, height);
    requireRgba(decoded, width, height);
    const std::vector<uint8_t> a = onWhite(original);
    const std::vector<uint8_t> b = onWhite(decoded);
    double squaredError = 0;
    double similarity = 0;
    for (int channel = 0; channel < 3; ++channel) {
        float sum = 0;
        float perChannel = 0;
        if (!WebPPlaneDistortion(a.data() + channel, width * 4, b.data() + channel, width * 4, width, height, 4, 0, &sum, &perChannel)) {
            throw std::runtime_error("WebPPlaneDistortion failed");
        }
        squaredError += sum;
        if (!WebPPlaneDistortion(a.data() + channel, width * 4, b.data() + channel, width * 4, width, height, 4, 1, &sum, &perChannel)) {
            throw std::runtime_error("WebPPlaneDistortion failed");
        }
        similarity += sum;
    }
    const double samples = 3.0 * width * height;
    Fidelity fidelity;
    fidelity.psnr = squaredError > 0 ? 10 * std::log10(255.0 * 255.0 * samples / squaredError) : 99.0;
    fidelity.ssim = similarity / samples;
    return fidelity;
}

inline std::string fixed(double value, int decimals) {
    char text[32];
    std::snprintf(text, sizeof text, "%.*f", decimals, value);
    return text;
}

inline const char* formatName(const std::vector<uint8_t>& webp) {
    WebPBitstreamFeatures features;
    if (WebPGetFeatures(webp.data(), webp.size(), &features) != VP8_STATUS_OK) return "unknown";
    return features.format == 1 ? "lossy" : features.format == 2 ? "lossless" : "mixed";
}

}  // namespace imaging
