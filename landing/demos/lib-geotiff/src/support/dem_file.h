#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <memory>
#include <string>
#include <vector>

#include "dem.h"
#include "geotiff_app.h"

namespace geotiffapp {

// One DEM, open for the probe: its placement from the first directory, and band 1 sampled into a
// grid of at most `maxSide` pixels, read from the smallest overview that is still big enough.
class DemFile {
public:
    DemFile(const std::string& path, int maxSide) : tif(openTiff(path, "r")), keys(openKeys(tif.get())) {
        if (maxSide < 16 || maxSide > 2048) throw std::invalid_argument("the grid side must be from 16 to 2048 pixels");
        TIFFGetField(tif.get(), TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif.get(), TIFFTAG_IMAGELENGTH, &height);
        TIFFGetFieldDefaulted(tif.get(), TIFFTAG_COMPRESSION, &compression);
        defined = keys && GTIFGetDefn(keys.get(), &defn) != 0;
        hasNoData = gdalNoData(tif.get(), noData);
        uint16_t count = 0;
        double* values = nullptr;
        double* matrix = nullptr;
        uint16_t matrixCount = 0;
        scaled = TIFFGetField(tif.get(), TIFFTAG_GEOPIXELSCALE, &count, &values) && count >= 2 && !TIFFGetField(tif.get(), TIFFTAG_GEOTRANSMATRIX, &matrixCount, &matrix);
        if (scaled) {
            pixelSize[0] = values[0];
            pixelSize[1] = values[1];
        }
        directories = TIFFNumberOfDirectories(tif.get());
        pickDirectory(maxSide);
        readGrid(maxSide);
        TIFFSetDirectory(tif.get(), 0);  // GTIFImageToPCS reads the tags of the current directory
    }

    std::string info() {
        double low = std::numeric_limits<double>::infinity();
        double high = -low;
        double sum = 0;
        size_t valid = 0;
        for (const float value : grid) {
            if (std::isnan(value)) continue;
            low = std::min<double>(low, value);
            high = std::max<double>(high, value);
            sum += value;
            valid += 1;
        }
        std::string json = "{\"width\":" + std::to_string(width) + ",\"height\":" + std::to_string(height) + ",\"gridWidth\":" + std::to_string(gridWidth) +
                           ",\"gridHeight\":" + std::to_string(gridHeight) + ",\"factor\":" + pair(width / static_cast<double>(gridWidth), height / static_cast<double>(gridHeight)) +
                           ",\"directory\":" + std::to_string(directory) + ",\"directories\":" + std::to_string(directories) + ",\"bits\":" + std::to_string(bits) +
                           ",\"format\":" + quote(sampleFormatName(format)) + ",\"compression\":" + quote(compressionName(compression)) + ",\"min\":" + number(valid ? low : NAN) +
                           ",\"max\":" + number(valid ? high : NAN) + ",\"mean\":" + number(valid ? sum / valid : NAN) + ",\"valid\":" + std::to_string(valid) +
                           ",\"noData\":" + (hasNoData ? number(noData) : std::string("null")) + ",\"pixelSize\":" + (scaled ? pair(pixelSize[0], pixelSize[1]) : std::string("null"));
        if (defined) json += "," + definitionJson(keys.get(), defn);
        return json + ",\"georeferenced\":" + (defined ? "true" : "false") + "}";
    }

    // The grid as little-endian float32, row by row; NaN where there is no value.
    void writeGrid(const std::string& path) const {
        std::unique_ptr<FILE, int (*)(FILE*)> file(std::fopen(path.c_str(), "wb"), std::fclose);
        if (!file || std::fwrite(grid.data(), sizeof(float), grid.size(), file.get()) != grid.size()) throw std::runtime_error("cannot write " + path);
    }

    // A position in full-resolution pixels to map coordinates and degrees.
    std::string at(double column, double row) {
        if (!defined) throw std::runtime_error("the file has no coordinate system");
        double x = column;
        double y = row;
        if (!GTIFImageToPCS(keys.get(), &x, &y)) throw std::runtime_error("no tiepoint and pixel scale to place the pixels");
        double lon = x;
        double lat = y;
        const bool degrees = toLonLat(defn, 1, &lon, &lat);
        return "{\"map\":" + pair(x, y) + ",\"lonLat\":" + (degrees ? pair(lon, lat) : std::string("null")) + "}";
    }

    // The grid as a float GeoTIFF with `codec`, then read back: its size and the largest change.
    std::string encode(const std::string& codec, double maxZError, const std::string& path) {
        if (!defined || !scaled) throw std::runtime_error("re-encoding needs a file placed by a tiepoint and a pixel scale");
        const bool projected = defn.Model == ModelTypeProjected;
        const int epsg = projected ? defn.PCS : defn.GCS;
        if (epsg == KvUserDefined) throw std::runtime_error("re-encoding needs an EPSG coordinate system");
        double x = 0;
        double y = 0;
        GTIFImageToPCS(keys.get(), &x, &y);
        const double factorX = width / static_cast<double>(gridWidth);
        const double factorY = height / static_cast<double>(gridHeight);
        const double bytes = writeFloatGeoTiff(grid, gridWidth, gridHeight, epsg, projected, x, y, pixelSize[0] * factorX, pixelSize[1] * factorY, demCodec(codec, maxZError), path);

        Tiff written = openTiff(path, "r");
        BlockReader reader(written.get());
        std::vector<uint32_t> columns(gridWidth);
        std::vector<uint32_t> rows(gridHeight);
        for (uint32_t i = 0; i < gridWidth; i += 1) columns[i] = i;
        for (uint32_t i = 0; i < gridHeight; i += 1) rows[i] = i;
        std::vector<float> decoded;
        reader.sample(columns, rows, decoded);
        double largest = 0;
        for (size_t i = 0; i < grid.size(); i += 1) {
            if (std::isnan(grid[i]) != std::isnan(decoded[i])) throw std::runtime_error("a missing value changed on the way");
            if (!std::isnan(grid[i])) largest = std::max(largest, std::fabs(static_cast<double>(decoded[i]) - grid[i]));
        }
        return "{\"bytes\":" + number(bytes) + ",\"maxError\":" + number(largest) + ",\"raw\":" + std::to_string(grid.size() * 4) + "}";
    }

private:
    void pickDirectory(int maxSide) {
        directory = 0;
        sourceWidth = width;
        sourceHeight = height;
        for (int index = 1; index < directories; index += 1) {
            if (!TIFFSetDirectory(tif.get(), static_cast<tdir_t>(index))) break;
            uint32_t type = 0;
            TIFFGetField(tif.get(), TIFFTAG_SUBFILETYPE, &type);
            if (!(type & FILETYPE_REDUCEDIMAGE) || (type & FILETYPE_MASK)) continue;
            uint32_t w = 0;
            uint32_t h = 0;
            TIFFGetField(tif.get(), TIFFTAG_IMAGEWIDTH, &w);
            TIFFGetField(tif.get(), TIFFTAG_IMAGELENGTH, &h);
            if (std::max(w, h) >= static_cast<uint32_t>(maxSide) && static_cast<double>(w) * h < static_cast<double>(sourceWidth) * sourceHeight) {
                directory = index;
                sourceWidth = w;
                sourceHeight = h;
            }
        }
        TIFFSetDirectory(tif.get(), static_cast<tdir_t>(directory));
    }

    // Nearest sampling: grid pixel i takes the source pixel at the centre of the area it covers.
    void readGrid(int maxSide) {
        BlockReader reader(tif.get());
        bits = reader.bits;
        format = reader.format;
        const double scale = std::max(1.0, std::max(sourceWidth, sourceHeight) / static_cast<double>(maxSide));
        gridWidth = std::max<uint32_t>(1, static_cast<uint32_t>(std::ceil(sourceWidth / scale)));
        gridHeight = std::max<uint32_t>(1, static_cast<uint32_t>(std::ceil(sourceHeight / scale)));
        std::vector<uint32_t> columns(gridWidth);
        std::vector<uint32_t> rows(gridHeight);
        for (uint32_t i = 0; i < gridWidth; i += 1) columns[i] = std::min(sourceWidth - 1, static_cast<uint32_t>((i + 0.5) * sourceWidth / gridWidth));
        for (uint32_t i = 0; i < gridHeight; i += 1) rows[i] = std::min(sourceHeight - 1, static_cast<uint32_t>((i + 0.5) * sourceHeight / gridHeight));
        reader.sample(columns, rows, grid);
        if (!hasNoData) return;
        for (float& value : grid) {
            if (value == static_cast<float>(noData)) value = std::numeric_limits<float>::quiet_NaN();
        }
    }

    Tiff tif;
    Keys keys;
    GTIFDefn defn{};
    bool defined = false;
    bool scaled = false;
    bool hasNoData = false;
    double noData = 0;
    double pixelSize[2] = {0, 0};
    uint32_t width = 0;
    uint32_t height = 0;
    uint16_t compression = COMPRESSION_NONE;
    uint16_t bits = 0;
    uint16_t format = SAMPLEFORMAT_UINT;
    int directories = 1;
    int directory = 0;
    uint32_t sourceWidth = 0;
    uint32_t sourceHeight = 0;
    uint32_t gridWidth = 0;
    uint32_t gridHeight = 0;
    std::vector<float> grid;
};

}  // namespace geotiffapp
