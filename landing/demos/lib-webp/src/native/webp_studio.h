#pragma once

#include <webp/encode.h>

#include <stdexcept>
#include <string>
#include <vector>

#include "../support/files.h"
#include "../support/imaging.h"
#include "../support/samples.h"

// The WebP Studio app: one image, any encoder settings, and what they cost and give away. Pixels stay
// in the module's filesystem as raw RGBA, 4 bytes per pixel, row after row.
class WebpStudio {
public:
    // Writes the 512x384 test card and returns "512x384".
    static std::string writeTestCard(const std::string& rgbaPath) {
        files::write(rgbaPath, samples::testCard());
        return std::to_string(samples::kCardWidth) + "x" + std::to_string(samples::kCardHeight);
    }

    // mode "lossy": `quality` 0-100 with a content preset and, optionally, sharp YUV.
    // mode "lossless": `quality` is the effort, 0 fastest, 100 smallest.
    // mode "near-lossless": lossless after libwebp nudges pixel values; `nearLossless` 0 nudges most, 100 not at all.
    // `method` 0-6 trades time for size in every mode. Writes the file to webpPath and returns
    // {"bytes","format","psnr","ssim","identical"}, measured on the pixels the file decodes to.
    static std::string encode(const std::string& rgbaPath, int width, int height, const std::string& webpPath, const std::string& mode, float quality,
                              int nearLossless, const std::string& preset, int method, bool sharpYuv) {
        const std::vector<uint8_t> rgba = files::read(rgbaPath);
        const std::vector<uint8_t> webp = imaging::encode(configFor(mode, quality, nearLossless, preset, method, sharpYuv), rgba, width, height);
        files::write(webpPath, webp);
        const imaging::Image decoded = imaging::decode(webp);
        const imaging::Fidelity fidelity = imaging::measure(rgba, decoded.rgba, width, height);
        return "{\"bytes\":" + std::to_string(webp.size()) + ",\"format\":\"" + imaging::formatName(webp) + "\",\"psnr\":" + imaging::fixed(fidelity.psnr, 2) +
               ",\"ssim\":" + imaging::fixed(fidelity.ssim, 4) + ",\"identical\":" + (visiblyIdentical(rgba, decoded.rgba) ? "true" : "false") + "}";
    }

    // Lossy at quality 0, 10, ... 100 with one preset, method and sharp YUV setting:
    // [{"quality","bytes","psnr","ssim"}, ...], the curve a quality is picked from.
    static std::string sweep(const std::string& rgbaPath, int width, int height, const std::string& preset, int method, bool sharpYuv) {
        const std::vector<uint8_t> rgba = files::read(rgbaPath);
        std::string out = "[";
        for (int quality = 0; quality <= 100; quality += 10) {
            const std::vector<uint8_t> webp = imaging::encode(configFor("lossy", static_cast<float>(quality), 100, preset, method, sharpYuv), rgba, width, height);
            const imaging::Fidelity fidelity = imaging::measure(rgba, imaging::decode(webp).rgba, width, height);
            out += std::string(quality ? "," : "") + "{\"quality\":" + std::to_string(quality) + ",\"bytes\":" + std::to_string(webp.size()) +
                   ",\"psnr\":" + imaging::fixed(fidelity.psnr, 2) + ",\"ssim\":" + imaging::fixed(fidelity.ssim, 4) + "}";
        }
        return out + "]";
    }

private:
    static WebPConfig configFor(const std::string& mode, float quality, int nearLossless, const std::string& preset, int method, bool sharpYuv) {
        const bool lossy = mode == "lossy";
        if (!lossy && mode != "lossless" && mode != "near-lossless") throw std::invalid_argument("mode must be lossy, lossless or near-lossless");
        WebPConfig config;
        if (!WebPConfigPreset(&config, lossy ? presetNamed(preset) : WEBP_PRESET_DEFAULT, quality)) throw std::runtime_error("libwebp version mismatch");
        config.method = method;
        if (lossy) {
            config.use_sharp_yuv = sharpYuv ? 1 : 0;
        } else {
            config.lossless = 1;
            config.near_lossless = mode == "near-lossless" ? nearLossless : 100;
        }
        return config;
    }

    static WebPPreset presetNamed(const std::string& name) {
        if (name == "default") return WEBP_PRESET_DEFAULT;
        if (name == "photo") return WEBP_PRESET_PHOTO;
        if (name == "picture") return WEBP_PRESET_PICTURE;
        if (name == "drawing") return WEBP_PRESET_DRAWING;
        if (name == "icon") return WEBP_PRESET_ICON;
        if (name == "text") return WEBP_PRESET_TEXT;
        throw std::invalid_argument("unknown preset " + name);
    }

    // Every pixel a viewer can see is unchanged; colour under fully transparent pixels does not count.
    static bool visiblyIdentical(const std::vector<uint8_t>& a, const std::vector<uint8_t>& b) {
        if (a.size() != b.size()) return false;
        for (size_t i = 0; i < a.size(); i += 4) {
            if (a[i + 3] != b[i + 3]) return false;
            if (a[i + 3] && (a[i] != b[i] || a[i + 1] != b[i + 1] || a[i + 2] != b[i + 2])) return false;
        }
        return true;
    }
};
