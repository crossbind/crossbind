#pragma once

#include <webp/encode.h>

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "../support/files.h"
#include "../support/imaging.h"
#include "../support/samples.h"

// The sticker app: any picture to a 512x512 WebP with a transparent background that stays within a
// byte budget. WhatsApp publishes 512x512 and at most 100 KB for a static sticker, and recommends an
// 8 px white outline. Pixels stay in the module's filesystem as raw RGBA.
class StickerMaker {
public:
    // Writes the 600x400 sample (a smiley on a transparent background) and returns "600x400".
    static std::string writeSample(const std::string& rgbaPath) {
        files::write(rgbaPath, samples::smiley());
        return std::to_string(samples::kSmileyWidth) + "x" + std::to_string(samples::kSmileyHeight);
    }

    // Trims fully transparent borders (WebPPictureCrop), fits what is left into the square with its
    // aspect kept (WebPPictureRescale), optionally draws the outline, then encodes lossy colour with
    // lossless alpha at the highest quality whose file is at most maxBytes. Writes the sticker to
    // webpPath and the 512x512 RGBA it encoded to canvasPath. Returns
    // {"bytes","quality","fits","contentWidth","contentHeight","attempts":[[quality,bytes],...]}.
    static std::string make(const std::string& rgbaPath, int width, int height, bool outline, int maxBytes, const std::string& webpPath,
                            const std::string& canvasPath) {
        if (maxBytes <= 0) throw std::invalid_argument("the byte budget must be positive");
        const std::vector<uint8_t> rgba = files::read(rgbaPath);
        imaging::requireRgba(rgba, width, height);
        const Box box = visibleBox(rgba, width, height);
        if (box.width == 0) throw std::invalid_argument("the image is fully transparent");

        const int room = kSize - (outline ? 2 * kStroke : 0);
        const bool wide = box.width >= box.height;
        const int fitWidth = wide ? room : std::max(1, (box.width * room + box.height / 2) / box.height);
        const int fitHeight = wide ? std::max(1, (box.height * room + box.width / 2) / box.width) : room;
        const std::vector<uint8_t> content = cropAndFit(rgba, width, height, box, fitWidth, fitHeight);

        std::vector<uint8_t> canvas(static_cast<size_t>(kSize) * kSize * 4, 0);
        const int left = (kSize - fitWidth) / 2;
        const int top = (kSize - fitHeight) / 2;
        for (int y = 0; y < fitHeight; ++y) {
            std::copy_n(content.begin() + static_cast<size_t>(y) * fitWidth * 4, static_cast<size_t>(fitWidth) * 4,
                        canvas.begin() + (static_cast<size_t>(top + y) * kSize + left) * 4);
        }
        if (outline) canvas = withOutline(canvas);
        files::write(canvasPath, canvas);

        WebPConfig config;
        if (!WebPConfigInit(&config)) throw std::runtime_error("libwebp version mismatch");
        config.alpha_quality = 100;
        std::vector<std::pair<int, size_t>> attempts;
        std::vector<uint8_t> best;
        int bestQuality = -1;
        const auto attempt = [&](int quality) {
            config.quality = static_cast<float>(quality);
            std::vector<uint8_t> webp = imaging::encode(config, canvas, kSize, kSize);
            attempts.emplace_back(quality, webp.size());
            const bool fits = webp.size() <= static_cast<size_t>(maxBytes);
            if (fits && quality > bestQuality) {
                bestQuality = quality;
                best = std::move(webp);
            }
            return fits;
        };
        if (!attempt(100)) {
            int low = 0;
            int high = 99;
            while (low <= high) {
                const int quality = (low + high) / 2;
                if (attempt(quality)) {
                    low = quality + 1;
                } else {
                    high = quality - 1;
                }
            }
        }
        const bool fits = bestQuality >= 0;
        if (!fits) {
            config.quality = 0;
            best = imaging::encode(config, canvas, kSize, kSize);
        }
        files::write(webpPath, best);

        std::string tried = "[";
        for (size_t i = 0; i < attempts.size(); ++i) {
            tried += std::string(i ? ",[" : "[") + std::to_string(attempts[i].first) + "," + std::to_string(attempts[i].second) + "]";
        }
        return "{\"bytes\":" + std::to_string(best.size()) + ",\"quality\":" + std::to_string(fits ? bestQuality : 0) + ",\"fits\":" + (fits ? "true" : "false") +
               ",\"contentWidth\":" + std::to_string(fitWidth) + ",\"contentHeight\":" + std::to_string(fitHeight) + ",\"attempts\":" + tried + "]}";
    }

private:
    static constexpr int kSize = 512;
    static constexpr int kStroke = 8;

    struct Box {
        int left = 0;
        int top = 0;
        int width = 0;
        int height = 0;
    };

    // The smallest rectangle holding every pixel that is not fully transparent.
    static Box visibleBox(const std::vector<uint8_t>& rgba, int width, int height) {
        int minX = width;
        int minY = height;
        int maxX = -1;
        int maxY = -1;
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                if (!rgba[(static_cast<size_t>(y) * width + x) * 4 + 3]) continue;
                minX = std::min(minX, x);
                maxX = std::max(maxX, x);
                minY = std::min(minY, y);
                maxY = std::max(maxY, y);
            }
        }
        Box box;
        if (maxX < 0) return box;
        box.left = minX;
        box.top = minY;
        box.width = maxX - minX + 1;
        box.height = maxY - minY + 1;
        return box;
    }

    static std::vector<uint8_t> cropAndFit(const std::vector<uint8_t>& rgba, int width, int height, const Box& box, int fitWidth, int fitHeight) {
        WebPPicture picture;
        if (!WebPPictureInit(&picture)) throw std::runtime_error("libwebp version mismatch");
        picture.width = width;
        picture.height = height;
        picture.use_argb = 1;
        const bool ok = WebPPictureImportRGBA(&picture, rgba.data(), width * 4) && WebPPictureCrop(&picture, box.left, box.top, box.width, box.height) &&
                        WebPPictureRescale(&picture, fitWidth, fitHeight);
        if (!ok) {
            WebPPictureFree(&picture);
            throw std::runtime_error("cropping or resizing failed");
        }
        std::vector<uint8_t> out(static_cast<size_t>(fitWidth) * fitHeight * 4);
        for (int y = 0; y < fitHeight; ++y) {
            for (int x = 0; x < fitWidth; ++x) {
                const uint32_t argb = picture.argb[static_cast<size_t>(y) * picture.argb_stride + x];
                uint8_t* pixel = &out[(static_cast<size_t>(y) * fitWidth + x) * 4];
                pixel[0] = static_cast<uint8_t>(argb >> 16);
                pixel[1] = static_cast<uint8_t>(argb >> 8);
                pixel[2] = static_cast<uint8_t>(argb);
                pixel[3] = static_cast<uint8_t>(argb >> 24);
            }
        }
        WebPPictureFree(&picture);
        return out;
    }

    // Puts the art over a white stroke: each pixel's stroke coverage is the strongest
    // min(alpha of a neighbour, stroke weight at that distance), full to 7.5 px and gone at 8.5 px.
    static std::vector<uint8_t> withOutline(const std::vector<uint8_t>& canvas) {
        std::vector<uint8_t> stroke(static_cast<size_t>(kSize) * kSize, 0);
        for (int y = 0; y < kSize; ++y) {
            for (int x = 0; x < kSize; ++x) {
                const int alpha = canvas[(static_cast<size_t>(y) * kSize + x) * 4 + 3];
                if (!alpha) continue;
                for (int dy = -kStroke; dy <= kStroke; ++dy) {
                    const int py = y + dy;
                    if (py < 0 || py >= kSize) continue;
                    for (int dx = -kStroke; dx <= kStroke; ++dx) {
                        const int px = x + dx;
                        const int d2 = dx * dx + dy * dy;
                        if (px < 0 || px >= kSize || d2 >= 72) continue;
                        const int weight = d2 <= 56 ? 255 : (72 - d2) * 255 / 16;
                        uint8_t& cover = stroke[static_cast<size_t>(py) * kSize + px];
                        cover = static_cast<uint8_t>(std::max<int>(cover, std::min(alpha, weight)));
                    }
                }
            }
        }
        std::vector<uint8_t> out(canvas.size(), 0);
        for (size_t i = 0; i < stroke.size(); ++i) {
            const int art = canvas[i * 4 + 3];
            const int white = stroke[i];
            const int coverage = art * 255 + white * (255 - art);
            if (!coverage) continue;
            for (size_t c = 0; c < 3; ++c) out[i * 4 + c] = static_cast<uint8_t>((255 * (canvas[i * 4 + c] * art + white * (255 - art)) + coverage / 2) / coverage);
            out[i * 4 + 3] = static_cast<uint8_t>((coverage + 127) / 255);
        }
        return out;
    }
};
