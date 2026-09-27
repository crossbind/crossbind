#pragma once

#include <tiffio.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "../support/errors.h"
#include "../support/raster.h"
#include "../support/sample_art.h"

// One scientific raster written with each codec libtiff offers for it, then read back and compared
// sample by sample: the sizes to pick a codec by, and proof of which ones are exact. The raster is
// either fluorescent cells (12-bit values in 16-bit samples) or an elevation model in metres
// (32-bit float), both in 256x256 tiles.
class CompressionLab {
public:
    // kind 0: cells, kind 1: elevation; `size` x `size` pixels.
    CompressionLab(int kind, int size) : kind(kind), size(static_cast<uint32_t>(size)) {
        if (kind != 0 && kind != 1) throw std::invalid_argument("kind is 0 (16-bit cells) or 1 (32-bit float elevation)");
        if (size < 64 || size > 4096) throw std::invalid_argument("size must be between 64 and 4096");
        if (kind == 0) {
            const int count = std::max(4, static_cast<int>(90ull * size * size / (1024 * 1024)));
            counts = tiffapps::art::cells(this->size, this->size, count, 2027);
        } else {
            heights = tiffapps::art::terrain(this->size, this->size, 23, false, 0.0f);
        }
    }

    int rawBytes() const { return static_cast<int>(static_cast<uint64_t>(size) * size * (kind == 0 ? 2 : 4)); }

    // {"width","height","bitsPerSample","sampleFormat","min","max"}
    std::string dataset() const {
        double low = 0;
        double high = 0;
        if (kind == 0) {
            const auto range = std::minmax_element(counts.begin(), counts.end());
            low = *range.first;
            high = *range.second;
        } else {
            const auto range = std::minmax_element(heights.begin(), heights.end());
            low = *range.first;
            high = *range.second;
        }
        return tiffapps::json::object({{"width", std::to_string(size)},
                                       {"height", std::to_string(size)},
                                       {"bitsPerSample", kind == 0 ? "16" : "32"},
                                       {"sampleFormat", tiffapps::json::text(kind == 0 ? "uint" : "float")},
                                       {"min", tiffapps::json::number(low)},
                                       {"max", tiffapps::json::number(high)}});
    }

    // Writes the raster to `tifPath` with `compression` (a COMPRESSION_* code), `predictor` (1 none,
    // 2 horizontal, 3 floating point; LZW, Deflate and ZSTD only) and, for LERC, `maxZError`, the
    // largest error it may introduce (0 keeps every sample). Then reads it back.
    // {"bytes","maxError"}: maxError 0 means every sample came back exactly.
    std::string run(int compression, int predictor, double maxZError, const std::string& tifPath) const {
        const bool predicts = compression == COMPRESSION_LZW || compression == COMPRESSION_ADOBE_DEFLATE || compression == COMPRESSION_DEFLATE || compression == COMPRESSION_ZSTD;
        if (predictor != PREDICTOR_NONE && !predicts) throw std::invalid_argument("only LZW, Deflate and ZSTD take a predictor");
        if (predictor == PREDICTOR_FLOATINGPOINT && kind == 0) throw std::invalid_argument("the floating-point predictor is for float samples");
        if (!TIFFIsCODECConfigured(static_cast<uint16_t>(compression))) throw std::invalid_argument("compression " + std::to_string(compression) + " is not in this build");
        write(compression, predictor, maxZError, tifPath);
        std::ifstream written(tifPath, std::ios::binary | std::ios::ate);
        const long long bytes = static_cast<long long>(written.tellg());
        return tiffapps::json::object({{"bytes", std::to_string(bytes)}, {"maxError", tiffapps::json::number(maxError(tifPath))}});
    }

private:
    void write(int compression, int predictor, double maxZError, const std::string& tifPath) const {
        tiffapps::Closer file(tiffapps::openFile(tifPath, "w"));
        TIFF* tif = file.get();
        TIFFSetField(tif, TIFFTAG_IMAGEWIDTH, size);
        TIFFSetField(tif, TIFFTAG_IMAGELENGTH, size);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, kind == 0 ? 16 : 32);
        TIFFSetField(tif, TIFFTAG_SAMPLEFORMAT, kind == 0 ? SAMPLEFORMAT_UINT : SAMPLEFORMAT_IEEEFP);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, compression);
        if (predictor != PREDICTOR_NONE) TIFFSetField(tif, TIFFTAG_PREDICTOR, predictor);
        if (compression == COMPRESSION_LERC) TIFFSetField(tif, TIFFTAG_LERC_MAXZERROR, maxZError);
        const uint32_t tile = std::min<uint32_t>(256, (size + 15) / 16 * 16);
        if (kind == 0) {
            tiffapps::writeTiles<uint16_t>(tif, counts, size, size, tile, 0);
        } else {
            tiffapps::writeTiles<float>(tif, heights, size, size, tile, 0.0f);
        }
        if (!file.close()) throw tiffapps::failure("libtiff could not finish " + tifPath);
    }

    double maxError(const std::string& tifPath) const {
        tiffapps::Closer file(tiffapps::openFile(tifPath, "r"));
        double worst = 0;
        if (kind == 0) {
            const std::vector<uint16_t> back = tiffapps::readTiles<uint16_t>(file.get(), size, size);
            for (size_t i = 0; i < back.size(); ++i) worst = std::max(worst, std::fabs(static_cast<double>(back[i]) - counts[i]));
        } else {
            const std::vector<float> back = tiffapps::readTiles<float>(file.get(), size, size);
            for (size_t i = 0; i < back.size(); ++i) worst = std::max(worst, std::fabs(static_cast<double>(back[i]) - heights[i]));
        }
        return worst;
    }

    int kind;
    uint32_t size;
    std::vector<uint16_t> counts;
    std::vector<float> heights;
};
