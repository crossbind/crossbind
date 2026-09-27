#pragma once

#include <webp/decode.h>
#include <webp/encode.h>

#include <cstdint>
#include <stdexcept>
#include <string>

// Transparency in WebP. Lossy files keep alpha in a plane of its own with its own quality; lossless
// files keep it exactly. Bytes cross the binding as one UTF-16 code unit (0-255) per byte.
class WebpAlpha {
public:
    // Lossy colour at `quality`, alpha at `alphaQuality` (100 keeps it lossless, lower values shrink it).
    static std::u16string encodeLossy(const std::u16string& rgba, int width, int height, float quality, int alphaQuality) {
        WebPConfig config;
        if (!WebPConfigInit(&config)) throw std::runtime_error("libwebp version mismatch");
        config.quality = quality;
        config.alpha_quality = alphaQuality;
        return encode(config, rgba, width, height);
    }

    // Lossless. Without `exact`, libwebp may change the colour under fully transparent pixels,
    // which nobody sees, to compress better.
    static std::u16string encodeLossless(const std::u16string& rgba, int width, int height, bool exact) {
        WebPConfig config;
        if (!WebPConfigInit(&config)) throw std::runtime_error("libwebp version mismatch");
        config.lossless = 1;
        config.exact = exact ? 1 : 0;
        return encode(config, rgba, width, height);
    }

    static std::u16string decode(const std::u16string& webp) {
        const std::string data = fromUnits(webp);
        int width = 0;
        int height = 0;
        uint8_t* rgba = WebPDecodeRGBA(reinterpret_cast<const uint8_t*>(data.data()), data.size(), &width, &height);
        if (!rgba) throw std::runtime_error("not a decodable WebP image");
        std::u16string units(rgba, rgba + static_cast<size_t>(width) * height * 4);
        WebPFree(rgba);
        return units;
    }

private:
    static std::u16string encode(const WebPConfig& config, const std::u16string& rgba, int width, int height) {
        if (!WebPValidateConfig(&config)) throw std::invalid_argument("invalid encoder settings");
        if (width <= 0 || height <= 0 || rgba.size() != static_cast<size_t>(width) * height * 4) {
            throw std::invalid_argument("expected width * height * 4 bytes of RGBA");
        }
        const std::string pixels = fromUnits(rgba);
        WebPPicture picture;
        if (!WebPPictureInit(&picture)) throw std::runtime_error("libwebp version mismatch");
        picture.width = width;
        picture.height = height;
        picture.use_argb = 1;
        WebPMemoryWriter writer;
        WebPMemoryWriterInit(&writer);
        picture.writer = WebPMemoryWrite;
        picture.custom_ptr = &writer;
        const bool ok = WebPPictureImportRGBA(&picture, reinterpret_cast<const uint8_t*>(pixels.data()), width * 4) && WebPEncode(&config, &picture);
        WebPPictureFree(&picture);
        if (!ok) {
            WebPMemoryWriterClear(&writer);
            throw std::runtime_error("WebP encoding failed");
        }
        std::u16string units(writer.mem, writer.mem + writer.size);
        WebPMemoryWriterClear(&writer);
        return units;
    }

    static std::string fromUnits(const std::u16string& units) {
        std::string data(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string");
            data[i] = static_cast<char>(units[i]);
        }
        return data;
    }
};
