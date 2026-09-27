#pragma once

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <limits>
#include <string>
#include <vector>

#include "geotiff_app.h"

// The elevation probe's native side: a synthetic DEM written as a float GeoTIFF, any single-band
// DEM read into a grid of at most `maxSide` pixels (from an overview when the file has one), and the
// grid written back with lossless or LERC compression.
namespace geotiffapp {

constexpr int DEM_SIDE = 512;
constexpr uint32_t GDAL_NODATA_TAG = 42113;

// Value noise from an integer hash, smoothstep-interpolated: only +, -, *, / and floor, so the
// Python reference reproduces every height bit for bit.
inline double lattice(uint32_t x, uint32_t y, uint32_t octave) {
    uint32_t h = x * 374761393u + y * 668265263u + octave * 2246822519u;
    h = (h ^ (h >> 13)) * 1274126177u;
    h ^= h >> 16;
    return h / 4294967296.0;
}

inline double valueNoise(double x, double y, uint32_t octave) {
    const double fx = std::floor(x);
    const double fy = std::floor(y);
    const uint32_t ix = static_cast<uint32_t>(fx);
    const uint32_t iy = static_cast<uint32_t>(fy);
    const double tx = x - fx;
    const double ty = y - fy;
    const double sx = tx * tx * (3 - 2 * tx);
    const double sy = ty * ty * (3 - 2 * ty);
    const double a = lattice(ix, iy, octave);
    const double b = lattice(ix + 1, iy, octave);
    const double c = lattice(ix, iy + 1, octave);
    const double d = lattice(ix + 1, iy + 1, octave);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// A massif with a valley-cut flank: fractal noise over a smooth dome, in metres.
inline double terrainHeight(int column, int row) {
    const double u = column / static_cast<double>(DEM_SIDE);
    const double v = row / static_cast<double>(DEM_SIDE);
    double fractal = 0;
    double amplitude = 1;
    double frequency = 4;
    double total = 0;
    for (uint32_t octave = 0; octave < 6; octave += 1) {
        fractal += amplitude * valueNoise(u * frequency, v * frequency, octave);
        total += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    fractal /= total;
    const double du = u - 0.55;
    const double dv = v - 0.45;
    double dome = 1 - (du * du + dv * dv) / 0.2;
    dome = dome > 0 ? dome * dome : 0;
    return 380 + 2300 * dome * (0.45 + 0.55 * fractal) + 220 * fractal;
}

struct Codec {
    unsigned compression;
    unsigned predictor;
    double maxZError;
};

inline Codec demCodec(const std::string& name, double maxZError) {
    if (name == "deflate") return {COMPRESSION_ADOBE_DEFLATE, PREDICTOR_FLOATINGPOINT, 0};
    if (name == "zstd") return {COMPRESSION_ZSTD, PREDICTOR_FLOATINGPOINT, 0};
    if (name == "lerc") return {COMPRESSION_LERC, PREDICTOR_NONE, maxZError};
    if (name == "none") return {COMPRESSION_NONE, PREDICTOR_NONE, 0};
    throw std::invalid_argument("unknown DEM compression " + name);
}

// A float32 GeoTIFF in 256 x 256 tiles, placed by a tiepoint and pixel scale in `epsg`.
inline double writeFloatGeoTiff(const std::vector<float>& values, uint32_t width, uint32_t height, int epsg, bool projected, double originX, double originY,
                                double pixelWidth, double pixelHeight, const Codec& codec, const std::string& path) {
    if (!TIFFIsCODECConfigured(codec.compression)) throw std::runtime_error("this libtiff build has no codec " + compressionName(codec.compression));
    Tiff tif = openTiff(path, "w");
    TIFFSetField(tif.get(), TIFFTAG_IMAGEWIDTH, width);
    TIFFSetField(tif.get(), TIFFTAG_IMAGELENGTH, height);
    TIFFSetField(tif.get(), TIFFTAG_BITSPERSAMPLE, 32);
    TIFFSetField(tif.get(), TIFFTAG_SAMPLEFORMAT, SAMPLEFORMAT_IEEEFP);
    TIFFSetField(tif.get(), TIFFTAG_SAMPLESPERPIXEL, 1);
    TIFFSetField(tif.get(), TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK);
    TIFFSetField(tif.get(), TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
    TIFFSetField(tif.get(), TIFFTAG_TILEWIDTH, 256);
    TIFFSetField(tif.get(), TIFFTAG_TILELENGTH, 256);
    TIFFSetField(tif.get(), TIFFTAG_COMPRESSION, codec.compression);
    if (codec.predictor != PREDICTOR_NONE) TIFFSetField(tif.get(), TIFFTAG_PREDICTOR, codec.predictor);
    if (codec.compression == COMPRESSION_LERC) TIFFSetField(tif.get(), TIFFTAG_LERC_MAXZERROR, codec.maxZError);
    const double tiepoint[6] = {0, 0, 0, originX, originY, 0};
    const double scale[3] = {pixelWidth, pixelHeight, 0};
    TIFFSetField(tif.get(), TIFFTAG_GEOTIEPOINTS, 6, tiepoint);
    TIFFSetField(tif.get(), TIFFTAG_GEOPIXELSCALE, 3, scale);
    Keys keys = openKeys(tif.get());
    if (!keys) fail("libgeotiff could not start the GeoKeys");
    GTIFKeySet(keys.get(), GTModelTypeGeoKey, TYPE_SHORT, 1, projected ? ModelTypeProjected : ModelTypeGeographic);
    GTIFKeySet(keys.get(), GTRasterTypeGeoKey, TYPE_SHORT, 1, RasterPixelIsArea);
    GTIFKeySet(keys.get(), projected ? ProjectedCSTypeGeoKey : GeographicTypeGeoKey, TYPE_SHORT, 1, epsg);
    if (!GTIFWriteKeys(keys.get())) fail("libgeotiff could not write the GeoKeys");
    keys.reset();

    std::vector<float> tile(256 * 256);
    for (uint32_t top = 0; top < height; top += 256) {
        for (uint32_t left = 0; left < width; left += 256) {
            for (uint32_t y = 0; y < 256; y += 1) {
                for (uint32_t x = 0; x < 256; x += 1) {
                    const uint32_t column = left + x < width ? left + x : width - 1;
                    const uint32_t row = top + y < height ? top + y : height - 1;
                    tile[y * 256 + x] = values[static_cast<size_t>(row) * width + column];
                }
            }
            const tmsize_t size = static_cast<tmsize_t>(tile.size() * sizeof(float));
            if (TIFFWriteEncodedTile(tif.get(), TIFFComputeTile(tif.get(), left, top, 0, 0), tile.data(), size) < 0) fail("libtiff could not write a tile");
        }
    }
    tif.reset();
    return fileSize(path);
}

inline std::vector<float> syntheticHeights() {
    std::vector<float> heights(static_cast<size_t>(DEM_SIDE) * DEM_SIDE);
    for (int row = 0; row < DEM_SIDE; row += 1) {
        for (int column = 0; column < DEM_SIDE; column += 1) heights[static_cast<size_t>(row) * DEM_SIDE + column] = static_cast<float>(terrainHeight(column, row));
    }
    return heights;
}

// The sample: 512 x 512 cells of 30 m in WGS 84 / UTM zone 33N, Deflate with the float predictor.
inline double writeSampleDem(const std::string& path) {
    return writeFloatGeoTiff(syntheticHeights(), DEM_SIDE, DEM_SIDE, 32633, true, 410000, 5220000, 30, 30, demCodec("deflate", 0), path);
}

// Band 1 of one directory as doubles, block by block: the pixels `columns` x `rows` pick.
class BlockReader {
public:
    explicit BlockReader(TIFF* tif) : tif(tif) {
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLESPERPIXEL, &samples);
        TIFFGetFieldDefaulted(tif, TIFFTAG_BITSPERSAMPLE, &bits);
        TIFFGetFieldDefaulted(tif, TIFFTAG_SAMPLEFORMAT, &format);
        TIFFGetFieldDefaulted(tif, TIFFTAG_PLANARCONFIG, &planar);
        TIFFGetField(tif, TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif, TIFFTAG_IMAGELENGTH, &height);
        const bool supported = (format == SAMPLEFORMAT_IEEEFP && (bits == 32 || bits == 64)) ||
                               ((format == SAMPLEFORMAT_UINT || format == SAMPLEFORMAT_INT || format == SAMPLEFORMAT_VOID) && (bits == 8 || bits == 16 || bits == 32));
        if (!supported) throw std::runtime_error("band 1 holds " + std::to_string(bits) + "-bit " + sampleFormatName(format) + " values, which the probe does not read");
        tiled = TIFFIsTiled(tif) != 0;
        if (tiled) {
            TIFFGetField(tif, TIFFTAG_TILEWIDTH, &blockWidth);
            TIFFGetField(tif, TIFFTAG_TILELENGTH, &blockHeight);
        } else {
            blockWidth = width;
            TIFFGetFieldDefaulted(tif, TIFFTAG_ROWSPERSTRIP, &blockHeight);
            if (blockHeight > height) blockHeight = height;
        }
        const tmsize_t size = tiled ? TIFFTileSize(tif) : TIFFStripSize(tif);
        if (size <= 0 || size > (64 << 20)) throw std::runtime_error("the file's blocks are larger than 64 MB");
        buffer.resize(static_cast<size_t>(size));
    }

    // Fills out[i * columns.size() + j] with the value at (columns[j], rows[i]).
    void sample(const std::vector<uint32_t>& columns, const std::vector<uint32_t>& rows, std::vector<float>& out) {
        out.assign(columns.size() * rows.size(), std::numeric_limits<float>::quiet_NaN());
        for (uint32_t top = 0; top < height; top += blockHeight) {
            for (uint32_t left = 0; left < width; left += blockWidth) {
                bool loaded = false;
                for (size_t i = 0; i < rows.size(); i += 1) {
                    if (rows[i] < top || rows[i] >= top + blockHeight) continue;
                    for (size_t j = 0; j < columns.size(); j += 1) {
                        if (columns[j] < left || columns[j] >= left + blockWidth) continue;
                        if (!loaded) {
                            load(left, top);
                            loaded = true;
                        }
                        out[i * columns.size() + j] = static_cast<float>(value(columns[j] - left, rows[i] - top));
                    }
                }
            }
        }
    }

    uint32_t width = 0;
    uint32_t height = 0;
    uint16_t bits = 8;
    uint16_t format = SAMPLEFORMAT_UINT;

private:
    void load(uint32_t left, uint32_t top) {
        const tmsize_t read = tiled ? TIFFReadEncodedTile(tif, TIFFComputeTile(tif, left, top, 0, 0), buffer.data(), static_cast<tmsize_t>(buffer.size()))
                                    : TIFFReadEncodedStrip(tif, TIFFComputeStrip(tif, top, 0), buffer.data(), static_cast<tmsize_t>(buffer.size()));
        if (read < 0) fail("libtiff could not decode a block");
    }

    double value(uint32_t x, uint32_t y) const {
        const size_t index = (static_cast<size_t>(y) * blockWidth + x) * (planar == PLANARCONFIG_CONTIG ? samples : 1);
        const unsigned char* at = buffer.data() + index * (bits / 8);
        if (format == SAMPLEFORMAT_IEEEFP) return bits == 32 ? read<float>(at) : read<double>(at);
        const bool isSigned = format == SAMPLEFORMAT_INT;
        if (bits == 8) return isSigned ? read<int8_t>(at) : read<uint8_t>(at);
        if (bits == 16) return isSigned ? read<int16_t>(at) : read<uint16_t>(at);
        return isSigned ? read<int32_t>(at) : read<uint32_t>(at);
    }

    template <typename T>
    static double read(const unsigned char* at) {
        T value;
        std::memcpy(&value, at, sizeof value);
        return static_cast<double>(value);
    }

    TIFF* tif;
    uint16_t samples = 1;
    uint16_t planar = PLANARCONFIG_CONTIG;
    bool tiled = false;
    uint32_t blockWidth = 0;
    uint32_t blockHeight = 0;
    std::vector<unsigned char> buffer;
};

// GDAL keeps a raster's no-data value as text in its own TIFF tag; libtiff reads it as an unknown field.
inline bool gdalNoData(TIFF* tif, double& value) {
    if (!TIFFFindField(tif, GDAL_NODATA_TAG, TIFF_ANY)) return false;
    uint32_t count = 0;
    void* data = nullptr;
    if (!TIFFGetField(tif, GDAL_NODATA_TAG, &count, &data) || !data || count == 0) return false;
    const std::string text(static_cast<const char*>(data), count);
    char* end = nullptr;
    value = std::strtod(text.c_str(), &end);
    return end != text.c_str();
}

}  // namespace geotiffapp
