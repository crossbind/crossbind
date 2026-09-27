#pragma once

#include <webp/decode.h>

#include <cstdint>
#include <stdexcept>
#include <string>

// Reading WebP files: what the header says, and decoding with WebPDecoderConfig, which can scale or
// crop while it decodes. Bytes cross the binding as one UTF-16 code unit (0-255) per byte.
class WebpReader {
public:
    // {"width","height","hasAlpha","hasAnimation","format"} from the header; format is "lossy", "lossless" or "mixed".
    static std::string features(const std::u16string& webp) {
        const std::string data = fromUnits(webp);
        WebPBitstreamFeatures features;
        if (WebPGetFeatures(reinterpret_cast<const uint8_t*>(data.data()), data.size(), &features) != VP8_STATUS_OK) {
            throw std::runtime_error("not a WebP image");
        }
        const char* format = features.format == 1 ? "lossy" : features.format == 2 ? "lossless" : "mixed";
        return "{\"width\":" + std::to_string(features.width) + ",\"height\":" + std::to_string(features.height) +
               ",\"hasAlpha\":" + (features.has_alpha ? "true" : "false") + ",\"hasAnimation\":" + (features.has_animation ? "true" : "false") +
               ",\"format\":\"" + format + "\"}";
    }

    // The whole image, resized to width x height while it decodes.
    static std::u16string decodeScaled(const std::u16string& webp, int width, int height) {
        WebPDecoderConfig config;
        if (!WebPInitDecoderConfig(&config)) throw std::runtime_error("libwebp version mismatch");
        config.options.use_scaling = 1;
        config.options.scaled_width = width;
        config.options.scaled_height = height;
        return decode(webp, config);
    }

    // Only the width x height rectangle at (left, top) comes out as RGBA.
    static std::u16string decodeRegion(const std::u16string& webp, int left, int top, int width, int height) {
        WebPDecoderConfig config;
        if (!WebPInitDecoderConfig(&config)) throw std::runtime_error("libwebp version mismatch");
        config.options.use_cropping = 1;
        config.options.crop_left = left;
        config.options.crop_top = top;
        config.options.crop_width = width;
        config.options.crop_height = height;
        return decode(webp, config);
    }

private:
    static std::u16string decode(const std::u16string& webp, WebPDecoderConfig& config) {
        const std::string data = fromUnits(webp);
        config.output.colorspace = MODE_RGBA;
        const VP8StatusCode status = WebPDecode(reinterpret_cast<const uint8_t*>(data.data()), data.size(), &config);
        if (status != VP8_STATUS_OK) throw std::runtime_error("WebP decoding failed with status " + std::to_string(status));
        const WebPRGBABuffer& buffer = config.output.u.RGBA;
        std::u16string units(buffer.rgba, buffer.rgba + buffer.size);
        WebPFreeDecBuffer(&config.output);
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
