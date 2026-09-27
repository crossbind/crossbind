#pragma once

#include <Lerc_c_api.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/grid.h"
#include "../support/terrain.h"

// Opens a LERC blob where it lies in the module's filesystem: reads its headers, then decodes one band
// for the page to draw. Any of LERC's eight data types, several bands, several values per pixel,
// validity masks, and legacy Lerc1 blobs.
class LercInspector {
public:
    // The sample: the lowland terrain as an island, everything below 56 m marked as sea in LERC's
    // validity mask, stored within 1 cm. Returns its size in bytes.
    static int writeSample(const std::string& path) {
        const std::vector<float> heights = terrain::heights(1);
        std::vector<unsigned char> land(heights.size());
        for (size_t i = 0; i < heights.size(); ++i) land[i] = heights[i] >= 56.0f ? 1 : 0;
        const std::string blob = grid::encode(heights, terrain::kSize, terrain::kSize, &land, 0.01);
        grid::write(path, blob.data(), blob.size());
        return static_cast<int>(blob.size());
    }

    // What the headers say, without decoding the pixels of a Lerc2 blob:
    // {"codec","version","type","width","height","depth","bands","validPixels","masks","blobSize","fileSize",
    //  "zMin","zMax","maxZErrorUsed","usesNoData","ranges"}, ranges being [min, max] per band and value per pixel.
    static std::string inspect(const std::string& path) {
        const std::string blob = grid::read(path);
        const grid::Header h = grid::header(blob);
        const size_t count = static_cast<size_t>(h.depth) * h.bands;
        std::vector<double> mins(count);
        std::vector<double> maxs(count);
        const bool ranged = lerc_getDataRanges(bytes(blob), static_cast<unsigned int>(blob.size()), static_cast<int>(h.depth), static_cast<int>(h.bands),
                                               mins.data(), maxs.data()) == 0;
        std::string ranges = ranged ? "[" : "null";
        for (size_t i = 0; ranged && i < count; ++i) ranges += std::string(i ? "," : "") + "[" + grid::number(mins[i]) + "," + grid::number(maxs[i]) + "]";
        if (ranged) ranges += "]";
        const std::string codec = h.version == 0 ? "Lerc1" : "Lerc2 v" + std::to_string(h.version);
        return "{\"codec\":\"" + codec + "\",\"version\":" + std::to_string(h.version) + ",\"type\":\"" + grid::typeName(h.type) + "\",\"width\":" + std::to_string(h.width) +
               ",\"height\":" + std::to_string(h.height) + ",\"depth\":" + std::to_string(h.depth) + ",\"bands\":" + std::to_string(h.bands) +
               ",\"validPixels\":" + std::to_string(h.validPixels) + ",\"masks\":" + std::to_string(h.masks) + ",\"blobSize\":" + std::to_string(h.blobSize) +
               ",\"fileSize\":" + std::to_string(blob.size()) + ",\"zMin\":" + grid::number(h.zMin) + ",\"zMax\":" + grid::number(h.zMax) +
               ",\"maxZErrorUsed\":" + grid::number(h.maxZErrorUsed) + ",\"usesNoData\":" + std::to_string(h.usesNoData) + ",\"ranges\":" + ranges + "}";
    }

    // Decodes the blob and hands one band to the page: its first value per pixel as float32 in
    // valuesPath, and one byte per pixel in maskPath, 1 where the pixel holds a value. {"valid","min","max","ms"}
    static std::string decodeBand(const std::string& path, int band, const std::string& valuesPath, const std::string& maskPath) {
        const std::string blob = grid::read(path);
        const grid::Header h = grid::header(blob);
        if (band < 0 || band >= static_cast<int>(h.bands)) throw std::invalid_argument("the blob has no band " + std::to_string(band));
        const size_t pixels = static_cast<size_t>(h.width) * h.height;
        if (pixels * h.depth * h.bands > kMaxValues) throw std::invalid_argument("too large to preview here: more than 16.7 million values");
        const int masks = static_cast<int>(h.masks);
        std::vector<double> values(pixels * h.depth * h.bands);
        std::vector<unsigned char> valid(pixels * std::max(masks, 1), 1);
        std::vector<unsigned char> usesNoData(h.bands, 0);
        std::vector<double> noData(h.bands, 0);
        const auto started = std::chrono::steady_clock::now();
        grid::check(lerc_decodeToDouble_4D(bytes(blob), static_cast<unsigned int>(blob.size()), masks, masks ? valid.data() : nullptr, static_cast<int>(h.depth),
                                           static_cast<int>(h.width), static_cast<int>(h.height), static_cast<int>(h.bands), values.data(), usesNoData.data(),
                                           noData.data()),
                    "decoding");
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
        const unsigned char* bandMask = masks == 0 ? nullptr : valid.data() + (masks > 1 ? pixels * static_cast<size_t>(band) : 0);
        std::vector<float> out(pixels, 0.0f);
        std::vector<unsigned char> mask(pixels, 0);
        double low = INFINITY;
        double high = -INFINITY;
        size_t count = 0;
        for (size_t k = 0; k < pixels; ++k) {
            const double value = values[(static_cast<size_t>(band) * pixels + k) * h.depth];
            const bool holds = (!bandMask || bandMask[k]) && !(usesNoData[band] && value == noData[band]);
            if (!holds) continue;
            mask[k] = 1;
            out[k] = static_cast<float>(value);
            low = std::min(low, value);
            high = std::max(high, value);
            count += 1;
        }
        grid::write(valuesPath, out.data(), out.size() * sizeof(float));
        grid::write(maskPath, mask.data(), mask.size());
        return "{\"valid\":" + std::to_string(count) + ",\"min\":" + grid::number(low) + ",\"max\":" + grid::number(high) + ",\"ms\":" + grid::number(ms) + "}";
    }

private:
    static constexpr size_t kMaxValues = size_t(1) << 24;

    static const unsigned char* bytes(const std::string& blob) { return reinterpret_cast<const unsigned char*>(blob.data()); }
};
