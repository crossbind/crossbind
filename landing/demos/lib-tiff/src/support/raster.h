#pragma once

#include <tiffio.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <functional>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "errors.h"

namespace tiffapps {

// GDAL keeps a raster's no-data value in its private tag 42113 as text ("-9999", "nan"). libtiff
// names the tag (TIFFTAG_GDAL_NODATA) but does not register it; registering it lets TIFFGetField
// read it and TIFFSetField write it.
inline void registerGdalNodata() {
    static TIFFExtendProc parent = nullptr;
    static const TIFFFieldInfo fields[] = {{TIFFTAG_GDAL_NODATA, -1, -1, TIFF_ASCII, FIELD_CUSTOM, 1, 0, const_cast<char*>("GDAL NoDataValue")}};
    static const bool registered = [] {
        parent = TIFFSetTagExtender([](TIFF* tif) {
            TIFFMergeFieldInfo(tif, fields, 1);
            if (parent) parent(tif);
        });
        return true;
    }();
    (void)registered;
}

namespace json {

// Tag text is meant to be ASCII but is often UTF-8; control characters are escaped, the rest kept.
inline std::string text(const std::string& value) {
    std::string out = "\"";
    for (unsigned char character : value) {
        if (character == '"' || character == '\\') {
            out += '\\';
            out += static_cast<char>(character);
        } else if (character < 0x20 || character == 0x7F) {
            char escaped[8];
            std::snprintf(escaped, sizeof escaped, "\\u%04x", character);
            out += escaped;
        } else {
            out += static_cast<char>(character);
        }
    }
    return out + "\"";
}

inline std::string number(double value) {
    if (!std::isfinite(value)) return "null";
    char printed[32];
    std::snprintf(printed, sizeof printed, "%.10g", value);
    return printed;
}

inline std::string flag(bool value) { return value ? "true" : "false"; }

// Objects and arrays of values already written as JSON. The bound headers call these instead of
// spelling braces in string literals, which the header scanner would count as code.
inline std::string object(std::initializer_list<std::pair<const char*, std::string>> fields) {
    std::string out = "{";
    for (const auto& field : fields) out += (out.size() > 1 ? "," : "") + text(field.first) + ":" + field.second;
    return out + "}";
}

inline std::string array(const std::vector<std::string>& items) {
    std::string out = "[";
    for (const std::string& item : items) out += (out.size() > 1 ? "," : "") + item;
    return out + "]";
}

}  // namespace json

// The size a page is drawn at so that its longer side fits in `maxSide`; pages are never enlarged.
struct Size {
    uint32_t width;
    uint32_t height;
};

inline Size fit(uint32_t width, uint32_t height, uint32_t maxSide) {
    const uint32_t longest = std::max(width, height);
    if (longest <= maxSide) return {width, height};
    return {std::max<uint32_t>(1, static_cast<uint32_t>(static_cast<uint64_t>(width) * maxSide / longest)),
            std::max<uint32_t>(1, static_cast<uint32_t>(static_cast<uint64_t>(height) * maxSide / longest))};
}

// Averages source rows into output pixels as the rows arrive: source pixel (x, y) belongs to output
// pixel (x * out.width / width, y * out.height / height), so only one output row of sums is kept.
// `emit` receives every finished output pixel as (x, y, sums, count); count is 0 when nothing valid
// fell into it.
template <int Channels, typename Sum>
class BoxRows {
public:
    using Emit = std::function<void(uint32_t, uint32_t, const Sum*, uint32_t)>;

    BoxRows(uint32_t width, uint32_t height, Size out, Emit emit)
        : width(width), height(height), out(out), emit(std::move(emit)), column(width), sums(static_cast<size_t>(out.width) * Channels), counts(out.width) {
        for (uint32_t x = 0; x < width; ++x) column[x] = static_cast<uint32_t>(static_cast<uint64_t>(x) * out.width / width);
    }

    // `value(x, channel)` reads the source row; `valid(x)` says whether pixel x counts.
    template <typename Value, typename Valid>
    void add(Value value, Valid valid) {
        const uint32_t row = static_cast<uint32_t>(static_cast<uint64_t>(next) * out.height / height);
        if (row != current) flush();
        current = row;
        for (uint32_t x = 0; x < width; ++x) {
            if (!valid(x)) continue;
            Sum* sum = &sums[static_cast<size_t>(column[x]) * Channels];
            for (int channel = 0; channel < Channels; ++channel) sum[channel] += value(x, channel);
            counts[column[x]] += 1;
        }
        next += 1;
    }

    void finish() { flush(); }

private:
    void flush() {
        for (uint32_t x = 0; x < out.width; ++x) emit(x, current, &sums[static_cast<size_t>(x) * Channels], counts[x]);
        std::fill(sums.begin(), sums.end(), Sum(0));
        std::fill(counts.begin(), counts.end(), 0u);
    }

    uint32_t width;
    uint32_t height;
    Size out;
    Emit emit;
    std::vector<uint32_t> column;
    std::vector<Sum> sums;
    std::vector<uint32_t> counts;
    uint32_t next = 0;
    uint32_t current = 0;
};

// One band of samples as square tiles; edge tiles are padded with `padding`.
template <typename Sample>
inline void writeTiles(TIFF* tif, const std::vector<Sample>& samples, uint32_t width, uint32_t height, uint32_t tile, Sample padding) {
    TIFFSetField(tif, TIFFTAG_TILEWIDTH, tile);
    TIFFSetField(tif, TIFFTAG_TILELENGTH, tile);
    std::vector<Sample> block(static_cast<size_t>(tile) * tile);
    for (uint32_t top = 0; top < height; top += tile) {
        for (uint32_t left = 0; left < width; left += tile) {
            std::fill(block.begin(), block.end(), padding);
            for (uint32_t y = top; y < std::min(top + tile, height); ++y) {
                std::copy_n(&samples[static_cast<size_t>(y) * width + left], std::min(tile, width - left), &block[static_cast<size_t>(y - top) * tile]);
            }
            if (TIFFWriteTile(tif, block.data(), left, top, 0, 0) < 0) throw failure("libtiff could not write the tile at " + std::to_string(left) + "," + std::to_string(top));
        }
    }
}

// The band written by writeTiles, read back tile by tile.
template <typename Sample>
inline std::vector<Sample> readTiles(TIFF* tif, uint32_t width, uint32_t height) {
    uint32_t tileWidth = 0;
    uint32_t tileHeight = 0;
    if (!TIFFGetField(tif, TIFFTAG_TILEWIDTH, &tileWidth) || !TIFFGetField(tif, TIFFTAG_TILELENGTH, &tileHeight)) throw std::runtime_error("the page is not tiled");
    std::vector<Sample> samples(static_cast<size_t>(width) * height);
    std::vector<Sample> block(static_cast<size_t>(tileWidth) * tileHeight);
    for (uint32_t top = 0; top < height; top += tileHeight) {
        for (uint32_t left = 0; left < width; left += tileWidth) {
            if (TIFFReadTile(tif, block.data(), left, top, 0, 0) < 0) throw failure("libtiff could not read the tile at " + std::to_string(left) + "," + std::to_string(top));
            for (uint32_t y = top; y < std::min(top + tileHeight, height); ++y) {
                std::copy_n(&block[static_cast<size_t>(y - top) * tileWidth], std::min(tileWidth, width - left), &samples[static_cast<size_t>(y) * width + left]);
            }
        }
    }
    return samples;
}

// Sample 0 of every pixel as a double, row after row, from strips or tiles, interleaved or
// planar, for 8 to 64-bit integers and 32 or 64-bit floats.
class BandReader {
public:
    explicit BandReader(TIFF* tif) : tif(tif) {
        uint16_t samples = 1;
        uint16_t planar = PLANARCONFIG_CONTIG;
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &height);
        TIFFGetFieldDefaulted(tif, TIFFTAG_BITSPERSAMPLE, &bits);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLEFORMAT, &format);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLESPERPIXEL, &samples);
        TIFFGetFieldDefaulted(tif, TIFFTAG_PLANARCONFIG, &planar);
        const bool known = (bits == 8 || bits == 16 || bits == 32 || bits == 64) && (format != SAMPLEFORMAT_IEEEFP || bits >= 32) &&
                           (format == SAMPLEFORMAT_UINT || format == SAMPLEFORMAT_INT || format == SAMPLEFORMAT_IEEEFP);
        if (!known) throw std::runtime_error("this viewer reads 8 to 64-bit integer and 32 or 64-bit float samples, not " + std::to_string(bits) + "-bit format " + std::to_string(format));
        bytes = bits / 8u;
        stride = planar == PLANARCONFIG_SEPARATE ? bytes : static_cast<size_t>(bytes) * samples;
        tiled = TIFFIsTiled(tif) != 0;
        const uint64_t limit = 256ull << 20;
        if (tiled) {
            TIFFGetField(tif, TIFFTAG_TILEWIDTH, &tileWidth);
            TIFFGetField(tif, TIFFTAG_TILELENGTH, &tileHeight);
            tileBytes = static_cast<uint64_t>(TIFFTileSize64(tif));
            across = tileWidth ? (width + tileWidth - 1) / tileWidth : 0;
            if (!tileWidth || !tileHeight || !tileBytes || tileBytes * across > limit) throw std::runtime_error("a row of tiles of this page is too big to read here");
            buffer.resize(static_cast<size_t>(tileBytes * across));
        } else {
            TIFFGetFieldDefaulted(tif, TIFFTAG_ROWSPERSTRIP, &rowsPerStrip);
            rowsPerStrip = std::max<uint32_t>(1, std::min(rowsPerStrip, height));
            rowBytes = static_cast<uint64_t>(TIFFScanlineSize64(tif));
            const uint64_t stripBytes = static_cast<uint64_t>(TIFFStripSize64(tif));
            if (!stripBytes || stripBytes > limit) throw std::runtime_error("one strip of this page is too big to read here");
            buffer.resize(static_cast<size_t>(stripBytes));
        }
    }

    uint32_t width = 0;
    uint32_t height = 0;

    // Row `y`'s samples into `values` (width doubles). Rows must come in increasing order.
    void row(uint32_t y, double* values) {
        if (tiled) {
            const uint32_t tileRow = y / tileHeight;
            if (tileRow != loaded) loadTileRow(tileRow);
            const size_t within = static_cast<size_t>(y % tileHeight) * tileWidth;
            for (uint32_t x = 0; x < width; ++x) values[x] = sample(&buffer[static_cast<size_t>(x / tileWidth) * tileBytes + (within + x % tileWidth) * stride]);
            return;
        }
        const uint32_t strip = y / rowsPerStrip;
        if (strip != loaded) loadStrip(strip);
        const uint8_t* start = &buffer[static_cast<size_t>(y % rowsPerStrip) * rowBytes];
        for (uint32_t x = 0; x < width; ++x) values[x] = sample(start + static_cast<size_t>(x) * stride);
    }

private:
    void loadStrip(uint32_t strip) {
        const uint32_t index = TIFFComputeStrip(tif, strip * rowsPerStrip, 0);
        if (TIFFReadEncodedStrip(tif, index, buffer.data(), static_cast<tmsize_t>(buffer.size())) < 0) throw failure("libtiff could not read strip " + std::to_string(index));
        loaded = strip;
    }

    void loadTileRow(uint32_t tileRow) {
        for (uint32_t tile = 0; tile < across; ++tile) {
            const uint32_t index = TIFFComputeTile(tif, tile * tileWidth, tileRow * tileHeight, 0, 0);
            if (TIFFReadEncodedTile(tif, index, &buffer[static_cast<size_t>(tile) * tileBytes], static_cast<tmsize_t>(tileBytes)) < 0) {
                throw failure("libtiff could not read tile " + std::to_string(index));
            }
        }
        loaded = tileRow;
    }

    double sample(const uint8_t* at) const {
        if (format == SAMPLEFORMAT_IEEEFP) return bytes == 4 ? static_cast<double>(read<float>(at)) : read<double>(at);
        const bool sign = format == SAMPLEFORMAT_INT;
        switch (bytes) {
            case 1: return sign ? static_cast<double>(static_cast<int8_t>(*at)) : static_cast<double>(*at);
            case 2: return sign ? static_cast<double>(read<int16_t>(at)) : static_cast<double>(read<uint16_t>(at));
            case 4: return sign ? static_cast<double>(read<int32_t>(at)) : static_cast<double>(read<uint32_t>(at));
            default: return sign ? static_cast<double>(read<int64_t>(at)) : static_cast<double>(read<uint64_t>(at));
        }
    }

    template <typename T>
    static T read(const uint8_t* at) {
        T value;
        std::memcpy(&value, at, sizeof value);
        return value;
    }

    TIFF* tif;
    uint16_t bits = 8;
    uint16_t format = SAMPLEFORMAT_UINT;
    uint32_t bytes = 1;
    size_t stride = 1;
    bool tiled = false;
    uint32_t tileWidth = 0;
    uint32_t tileHeight = 0;
    uint64_t tileBytes = 0;
    uint32_t across = 0;
    uint32_t rowsPerStrip = 0;
    uint64_t rowBytes = 0;
    uint32_t loaded = UINT32_MAX;
    std::vector<uint8_t> buffer;
};

}  // namespace tiffapps
