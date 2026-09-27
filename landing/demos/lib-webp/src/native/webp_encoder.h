#pragma once

#include <webp/decode.h>
#include <webp/encode.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>

// libwebp's advanced API: a WebPConfig started from a content preset and adjusted field by field,
// then WebPEncode on a WebPPicture. Bytes cross the binding as one UTF-16 code unit (0-255) per byte.
class WebpEncoder {
public:
    // preset: "default", "photo", "picture" (indoor and portrait shots), "drawing", "icon" or "text".
    WebpEncoder(const std::string& preset, float quality) {
        if (!WebPConfigPreset(&config, presetNamed(preset), quality)) throw std::runtime_error("libwebp version mismatch");
    }

    // 0 is the fastest; 6 is the slowest and usually the smallest. The default is 4.
    void setMethod(int method) { config.method = method; }

    // A slower RGB to YUV conversion that keeps colour edges sharper.
    void setSharpYuv(bool enabled) { config.use_sharp_yuv = enabled ? 1 : 0; }

    // The encoder searches for the quality that lands closest to this many bytes, over up to 6 passes.
    void setTargetSize(int bytes) {
        config.target_size = bytes;
        config.pass = 6;
    }

    std::u16string encode(const std::u16string& rgba, int width, int height) const {
        if (!WebPValidateConfig(&config)) throw std::invalid_argument("invalid encoder settings");
        if (width <= 0 || height <= 0 || rgba.size() != static_cast<size_t>(width) * height * 4) {
            throw std::invalid_argument("expected width * height * 4 bytes of RGBA");
        }
        const std::string pixels = fromUnits(rgba);
        WebPPicture picture;
        if (!WebPPictureInit(&picture)) throw std::runtime_error("libwebp version mismatch");
        picture.width = width;
        picture.height = height;
        // ARGB input lets WebPEncode do the YUV conversion itself, which is where sharp YUV applies.
        picture.use_argb = 1;
        WebPMemoryWriter writer;
        WebPMemoryWriterInit(&writer);
        picture.writer = WebPMemoryWrite;
        picture.custom_ptr = &writer;
        const bool ok = WebPPictureImportRGBA(&picture, reinterpret_cast<const uint8_t*>(pixels.data()), width * 4) && WebPEncode(&config, &picture);
        const WebPEncodingError error = picture.error_code;
        WebPPictureFree(&picture);
        if (!ok) {
            WebPMemoryWriterClear(&writer);
            throw std::runtime_error("WebP encoding failed with error " + std::to_string(error));
        }
        std::u16string units(writer.mem, writer.mem + writer.size);
        WebPMemoryWriterClear(&writer);
        return units;
    }

    // What the encoder gave away: PSNR over red, green and blue, and libwebp's SSIM over the same
    // channels (1 means identical), between `rgba` and the pixels `webp` decodes to.
    static std::string compare(const std::u16string& rgba, const std::u16string& webp) {
        const std::string original = fromUnits(rgba);
        const std::string data = fromUnits(webp);
        int width = 0;
        int height = 0;
        uint8_t* decoded = WebPDecodeRGBA(reinterpret_cast<const uint8_t*>(data.data()), data.size(), &width, &height);
        if (!decoded) throw std::runtime_error("not a decodable WebP image");
        if (original.size() != static_cast<size_t>(width) * height * 4) {
            WebPFree(decoded);
            throw std::invalid_argument("the RGBA and the WebP image differ in size");
        }
        const uint8_t* source = reinterpret_cast<const uint8_t*>(original.data());
        double squaredError = 0;
        double similarity = 0;
        for (int channel = 0; channel < 3; ++channel) {
            float sum = 0;
            float perChannel = 0;
            WebPPlaneDistortion(source + channel, width * 4, decoded + channel, width * 4, width, height, 4, 0, &sum, &perChannel);
            squaredError += sum;
            WebPPlaneDistortion(source + channel, width * 4, decoded + channel, width * 4, width, height, 4, 1, &sum, &perChannel);
            similarity += sum;
        }
        WebPFree(decoded);
        const double samples = 3.0 * width * height;
        const double psnr = squaredError > 0 ? 10 * std::log10(255.0 * 255.0 * samples / squaredError) : 99.0;
        char text[64];
        std::snprintf(text, sizeof text, "PSNR %.2f dB, SSIM %.4f", psnr, similarity / samples);
        return text;
    }

private:
    static WebPPreset presetNamed(const std::string& name) {
        if (name == "default") return WEBP_PRESET_DEFAULT;
        if (name == "photo") return WEBP_PRESET_PHOTO;
        if (name == "picture") return WEBP_PRESET_PICTURE;
        if (name == "drawing") return WEBP_PRESET_DRAWING;
        if (name == "icon") return WEBP_PRESET_ICON;
        if (name == "text") return WEBP_PRESET_TEXT;
        throw std::invalid_argument("unknown preset " + name);
    }

    static std::string fromUnits(const std::u16string& units) {
        std::string data(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            data[i] = static_cast<char>(units[i]);
        }
        return data;
    }

    WebPConfig config;
};
