#pragma once

#include <webp/decode.h>
#include <webp/encode.h>

#include <cstdint>
#include <stdexcept>
#include <string>

// libwebp's simple API. Bytes cross the binding as a byte string: one UTF-16 code unit (0-255) per byte.
class WebpCodec {
public:
    // WebPGetEncoderVersion() packs the version into one integer, 0xMMmmpp.
    static std::string version() {
        const int packed = WebPGetEncoderVersion();
        return std::to_string(packed >> 16) + "." + std::to_string((packed >> 8) & 0xff) + "." + std::to_string(packed & 0xff);
    }

    // `rgba` is 4 bytes per pixel, row after row. Quality runs from 0 (smallest file) to 100 (best).
    static std::u16string encode(const std::u16string& rgba, int width, int height, float quality) {
        const std::string pixels = checkedPixels(rgba, width, height);
        uint8_t* output = nullptr;
        const size_t size = WebPEncodeRGBA(reinterpret_cast<const uint8_t*>(pixels.data()), width, height, width * 4, quality, &output);
        return take(output, size);
    }

    static std::u16string encodeLossless(const std::u16string& rgba, int width, int height) {
        const std::string pixels = checkedPixels(rgba, width, height);
        uint8_t* output = nullptr;
        const size_t size = WebPEncodeLosslessRGBA(reinterpret_cast<const uint8_t*>(pixels.data()), width, height, width * 4, &output);
        return take(output, size);
    }

    // "<width>x<height>", read from the file header without decoding the image.
    static std::string dimensions(const std::u16string& webp) {
        const std::string data = fromUnits(webp);
        int width = 0;
        int height = 0;
        if (!WebPGetInfo(reinterpret_cast<const uint8_t*>(data.data()), data.size(), &width, &height)) throw std::runtime_error("not a WebP image");
        return std::to_string(width) + "x" + std::to_string(height);
    }

    static std::u16string decode(const std::u16string& webp) {
        const std::string data = fromUnits(webp);
        int width = 0;
        int height = 0;
        uint8_t* rgba = WebPDecodeRGBA(reinterpret_cast<const uint8_t*>(data.data()), data.size(), &width, &height);
        if (!rgba) throw std::runtime_error("not a decodable WebP image");
        return take(rgba, static_cast<size_t>(width) * height * 4);
    }

private:
    static std::string checkedPixels(const std::u16string& rgba, int width, int height) {
        if (width <= 0 || height <= 0 || rgba.size() != static_cast<size_t>(width) * height * 4) {
            throw std::invalid_argument("expected width * height * 4 bytes of RGBA");
        }
        return fromUnits(rgba);
    }

    // Copies memory libwebp allocated into a byte string, then releases it with WebPFree.
    static std::u16string take(uint8_t* data, size_t size) {
        if (!data || size == 0) {
            WebPFree(data);
            throw std::runtime_error("WebP encoding failed");
        }
        std::u16string units(data, data + size);
        WebPFree(data);
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
