#pragma once

#include <string>

#include "../support/geotiff_app.h"

// The "Georeference any picture" app: RGBA pixels in, a GeoTIFF that GIS software places on the map
// out. The upper-left corner and the pixel size are in the units of the EPSG system: degrees for a
// geographic one such as 4326, metres for most projected ones.
class Georeferencer {
public:
    // Reads width x height RGBA pixels from `rgbaPath` and writes `tifPath` with the chosen
    // compression (none, deflate, lzw, zstd or jpeg at `quality`); returns JSON with its size.
    static std::string write(const std::string& rgbaPath, int width, int height, int epsg, double originX, double originY, double pixelWidth,
                             double pixelHeight, const std::string& compression, int quality, const std::string& tifPath) {
        const std::string rgba = geotiffapp::readFile(rgbaPath);
        return geotiffapp::writeGeoTiff(geotiffapp::Picture{&rgba, width, height}, epsg, originX, originY, pixelWidth, pixelHeight, compression, quality,
                                        "Georeferenced in the browser with libgeotiff " LIBGEOTIFF_STRING_VERSION, tifPath);
    }
};
