#pragma once

#include <tiffio.h>
#include <tiffio.hxx>

#include <algorithm>
#include <cstdint>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Big images are stored in tiles, so a reader decodes only the part it shows: the layout of
// slide scanners, Cloud Optimized GeoTIFF and pyramidal TIFF. Bytes cross the binding as
// std::u16string, one code unit (0-255) per byte.
class TiffTiles {
public:
    // RGBA pixels to an 8-bit RGB TIFF in square Deflate tiles; `tileSize` is a multiple of 16.
    static std::u16string encode(const std::u16string& rgba, int width, int height, int tileSize) {
        if (width <= 0 || height <= 0 || rgba.size() != static_cast<size_t>(width) * height * 4) throw std::invalid_argument("rgba must hold width x height x 4 bytes");
        if (tileSize <= 0 || tileSize % 16 != 0) throw std::invalid_argument("tiles are a multiple of 16 pixels wide");
        std::ostringstream out;
        TIFF* tif = TIFFStreamOpen("memory", &out);
        if (!tif) throw std::runtime_error("libtiff could not open a stream for writing");
        TIFFSetField(tif, TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif, TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif, TIFFTAG_SAMPLESPERPIXEL, 3);
        TIFFSetField(tif, TIFFTAG_BITSPERSAMPLE, 8);
        TIFFSetField(tif, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_RGB);
        TIFFSetField(tif, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
        TIFFSetField(tif, TIFFTAG_COMPRESSION, COMPRESSION_ADOBE_DEFLATE);
        TIFFSetField(tif, TIFFTAG_TILEWIDTH, tileSize);
        TIFFSetField(tif, TIFFTAG_TILELENGTH, tileSize);
        std::vector<unsigned char> tile(static_cast<size_t>(TIFFTileSize(tif)));
        for (int top = 0; top < height; top += tileSize) {
            for (int left = 0; left < width; left += tileSize) {
                std::fill(tile.begin(), tile.end(), 0);  // edge tiles are padded
                for (int y = top; y < std::min(top + tileSize, height); ++y) {
                    for (int x = left; x < std::min(left + tileSize, width); ++x) {
                        for (int channel = 0; channel < 3; ++channel) {
                            const char16_t unit = rgba[(static_cast<size_t>(y) * width + x) * 4 + channel];
                            if (unit > 0xFF) {
                                TIFFClose(tif);
                                throw std::invalid_argument("not a byte string: a code unit is above 255");
                            }
                            tile[(static_cast<size_t>(y - top) * tileSize + (x - left)) * 3 + channel] = static_cast<unsigned char>(unit);
                        }
                    }
                }
                if (TIFFWriteTile(tif, tile.data(), static_cast<uint32_t>(left), static_cast<uint32_t>(top), 0, 0) < 0) {
                    TIFFClose(tif);
                    throw std::runtime_error("libtiff could not write the tile at " + std::to_string(left) + "," + std::to_string(top));
                }
            }
        }
        TIFFClose(tif);
        const std::string bytes = out.str();
        std::u16string units(bytes.size(), u'\0');
        for (size_t i = 0; i < bytes.size(); ++i) units[i] = static_cast<unsigned char>(bytes[i]);
        return units;
    }

    // "WxH in N tiles of TxT"
    static std::string layout(const std::u16string& tiff) {
        std::istringstream in(fromUnits(tiff));
        TIFF* tif = openTiled(in);
        uint32_t width = 0;
        uint32_t height = 0;
        uint32_t tileWidth = 0;
        uint32_t tileHeight = 0;
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &height);
        TIFFGetField(tif, TIFFTAG_TILEWIDTH, &tileWidth);
        TIFFGetField(tif, TIFFTAG_TILELENGTH, &tileHeight);
        const uint32_t tiles = TIFFNumberOfTiles(tif);
        TIFFClose(tif);
        return std::to_string(width) + "x" + std::to_string(height) + " in " + std::to_string(tiles) + " tiles of " + std::to_string(tileWidth) + "x" +
               std::to_string(tileHeight);
    }

    // The number of the tile that holds pixel (x, y), counted row by row from 0.
    static int tileIndex(const std::u16string& tiff, int x, int y) {
        std::istringstream in(fromUnits(tiff));
        TIFF* tif = openTiled(in);
        const bool inside = x >= 0 && y >= 0 && TIFFCheckTile(tif, static_cast<uint32_t>(x), static_cast<uint32_t>(y), 0, 0);
        const uint32_t index = inside ? TIFFComputeTile(tif, static_cast<uint32_t>(x), static_cast<uint32_t>(y), 0, 0) : 0;
        TIFFClose(tif);
        if (!inside) throw std::out_of_range("the pixel is outside the image");
        return static_cast<int>(index);
    }

    // The RGB samples of the tile that holds pixel (x, y), decoded with TIFFReadTile; no other
    // tile is read.
    static std::u16string tile(const std::u16string& tiff, int x, int y) {
        std::istringstream in(fromUnits(tiff));
        TIFF* tif = openTiled(in);
        if (x < 0 || y < 0 || !TIFFCheckTile(tif, static_cast<uint32_t>(x), static_cast<uint32_t>(y), 0, 0)) {
            TIFFClose(tif);
            throw std::out_of_range("the pixel is outside the image");
        }
        std::string samples(static_cast<size_t>(TIFFTileSize(tif)), '\0');
        const tmsize_t read = TIFFReadTile(tif, &samples[0], static_cast<uint32_t>(x), static_cast<uint32_t>(y), 0, 0);
        TIFFClose(tif);
        if (read < 0) throw std::runtime_error("libtiff could not read the tile");
        std::u16string units(samples.size(), u'\0');
        for (size_t i = 0; i < samples.size(); ++i) units[i] = static_cast<unsigned char>(samples[i]);
        return units;
    }

private:
    static TIFF* openTiled(std::istringstream& in) {
        TIFF* tif = TIFFStreamOpen("memory", &in);
        if (!tif) throw std::runtime_error("not a TIFF libtiff can read");
        if (!TIFFIsTiled(tif)) {
            TIFFClose(tif);
            throw std::runtime_error("this TIFF is stored in strips, not tiles");
        }
        return tif;
    }

    static std::string fromUnits(const std::u16string& units) {
        std::string bytes(units.size(), '\0');
        for (size_t i = 0; i < units.size(); ++i) {
            if (units[i] > 0xFF) throw std::invalid_argument("not a byte string: a code unit is above 255");
            bytes[i] = static_cast<char>(units[i]);
        }
        return bytes;
    }
};
