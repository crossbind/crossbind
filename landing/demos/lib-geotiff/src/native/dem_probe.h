#pragma once

#include <memory>
#include <string>

#include "../support/dem_file.h"

// The elevation probe: a DEM GeoTIFF sampled into a grid the page shades, positions under the
// cursor turned into degrees, and the grid saved again with lossless or LERC compression.
class DemProbe {
public:
    // Writes the synthetic 512 x 512 DEM to `path`; returns its size in bytes.
    static double writeSample(const std::string& path) { return geotiffapp::writeSampleDem(path); }

    DemProbe(const std::string& path, int maxSide) : dem(std::make_unique<geotiffapp::DemFile>(path, maxSide)) {}

    // JSON: size, grid, value type and range, no-data value and coordinate system.
    std::string info() { return dem->info(); }

    // Writes the grid to `path` as float32 values, row by row.
    void writeGrid(const std::string& path) { dem->writeGrid(path); }

    // JSON {"map": [x, y], "lonLat": [lon, lat]} for a position in full-resolution pixels.
    std::string at(double column, double row) { return dem->at(column, row); }

    // Saves the grid as a GeoTIFF with deflate, zstd or lerc (within `maxZError`); JSON with its
    // size and the largest change measured by reading it back.
    std::string encode(const std::string& codec, double maxZError, const std::string& path) { return dem->encode(codec, maxZError, path); }

private:
    std::unique_ptr<geotiffapp::DemFile> dem;
};
