#pragma once

#include <string>

#include "../support/geotiff_app.h"

// The "Where is this GeoTIFF?" app: everything libgeotiff can say about a file, from its size and
// compression to its coordinate system, its corners in degrees and its outline for a map.
class GeoTiffInspector {
public:
    static std::string version() { return LIBGEOTIFF_STRING_VERSION; }

    // JSON for the GeoTIFF at `path`: file facts, the normalised definition, the corners and the
    // outline in degrees, and the listgeo report.
    static std::string inspect(const std::string& path) { return geotiffapp::inspect(path); }

    // Writes the sample called `id` (istanbul, london, conus or world) to `path`; returns its size.
    static double writeSample(const std::string& id, const std::string& path) { return geotiffapp::writeSample(id, path); }
};
