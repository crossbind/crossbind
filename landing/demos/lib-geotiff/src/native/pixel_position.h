#pragma once

#include <geo_normalize.h>
#include <geotiff.h>
#include <geovalues.h>
#include <tiffio.hxx>
#include <xtiffio.h>

#include <cstdio>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>

// Opens a GeoTIFF once and converts positions both ways: pixel to map coordinates to longitude and
// latitude, and back. Pixel (0, 0) is the upper-left corner of the first pixel, so the centre of
// pixel (column, row) is (column + 0.5, row + 0.5).
class PixelPosition {
public:
    explicit PixelPosition(const std::u16string& tiff) : in(std::string(tiff.begin(), tiff.end())), tif(open(in)), keys(GTIFNew(tif.get()), GTIFFree) {
        if (!keys || !GTIFGetDefn(keys.get(), &defn)) throw std::runtime_error("no coordinate system in the GeoKeys");
    }

    // JSON {"map": [x, y], "lonLat": [lon, lat]} for a position in pixels.
    std::string lonLat(double column, double row) {
        double x = column;
        double y = row;
        if (!GTIFImageToPCS(keys.get(), &x, &y)) throw std::runtime_error("no tiepoint and pixel scale to place the pixels");
        double lon = x;
        double lat = y;
        if (defn.Model == ModelTypeProjected && !GTIFProj4ToLatLong(&defn, 1, &lon, &lat)) throw std::runtime_error("PROJ could not unproject the point");
        return json("lonLat", x, y, lon, lat);
    }

    // JSON {"map": [x, y], "pixel": [column, row]} for a longitude and latitude.
    std::string pixel(double lon, double lat) {
        double x = lon;
        double y = lat;
        if (defn.Model == ModelTypeProjected && !GTIFProj4FromLatLong(&defn, 1, &x, &y)) throw std::runtime_error("PROJ could not project the point");
        double column = x;
        double row = y;
        if (!GTIFPCSToImage(keys.get(), &column, &row)) throw std::runtime_error("no tiepoint and pixel scale to place the pixels");
        return json("pixel", x, y, column, row);
    }

private:
    using Tiff = std::unique_ptr<TIFF, void (*)(TIFF*)>;
    using Keys = std::unique_ptr<GTIF, void (*)(GTIF*)>;

    static Tiff open(std::istringstream& in) {
        XTIFFInitialize();
        Tiff tif(TIFFStreamOpen("input.tif", &in), XTIFFClose);
        if (!tif) throw std::runtime_error("not a TIFF file");
        return tif;
    }

    static std::string json(const char* name, double x, double y, double a, double b) {
        char text[160];
        std::snprintf(text, sizeof text, "{\"map\":[%.17g,%.17g],\"%s\":[%.17g,%.17g]}", x, y, name, a, b);
        return text;
    }

    std::istringstream in;  // libtiff reads from it for as long as the file is open
    Tiff tif;
    Keys keys;
    GTIFDefn defn;
};
