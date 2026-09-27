#pragma once

#include <geo_normalize.h>
#include <geotiff.h>
#include <geovalues.h>
#include <tiffio.hxx>
#include <xtiffio.h>

#include <cstdint>
#include <cstdio>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>

// Where is a GeoTIFF? Reads the coordinate system from its GeoKeys, puts two corners in map
// coordinates and turns them into longitude and latitude. Files travel as bytes, one per character,
// and libtiff's C++ stream API reads and writes them in memory.
class GeoTiffLocator {
public:
    static std::string version() { return LIBGEOTIFF_STRING_VERSION; }

    // A blank 8-bit image in the projected system `epsg`, its upper-left corner at (x, y), with
    // square pixels `pixelSize` map units wide.
    static std::u16string write(int epsg, int width, int height, double x, double y, double pixelSize) {
        std::ostringstream out;
        XTIFFInitialize();
        Tiff tif(TIFFStreamOpen("sample.tif", &out), XTIFFClose);
        if (!tif) throw std::runtime_error("libtiff could not start a file");
        TIFFSetField(tif.get(), TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif.get(), TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif.get(), TIFFTAG_BITSPERSAMPLE, 8);
        TIFFSetField(tif.get(), TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif.get(), TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK);
        TIFFSetField(tif.get(), TIFFTAG_ROWSPERSTRIP, height);
        const double tiepoint[6] = {0, 0, 0, x, y, 0};  // pixel (0, 0) sits at map (x, y)
        const double scale[3] = {pixelSize, pixelSize, 0};
        TIFFSetField(tif.get(), TIFFTAG_GEOTIEPOINTS, 6, tiepoint);
        TIFFSetField(tif.get(), TIFFTAG_GEOPIXELSCALE, 3, scale);

        Keys keys(GTIFNew(tif.get()), GTIFFree);
        GTIFKeySet(keys.get(), GTModelTypeGeoKey, TYPE_SHORT, 1, ModelTypeProjected);
        GTIFKeySet(keys.get(), GTRasterTypeGeoKey, TYPE_SHORT, 1, RasterPixelIsArea);
        GTIFKeySet(keys.get(), ProjectedCSTypeGeoKey, TYPE_SHORT, 1, epsg);
        GTIFWriteKeys(keys.get());
        keys.reset();

        std::string row(width, '\0');
        for (int y = 0; y < height; y += 1) {
            if (TIFFWriteScanline(tif.get(), row.data(), y, 0) < 0) throw std::runtime_error("libtiff could not write a row");
        }
        tif.reset();
        const std::string bytes = out.str();
        return std::u16string(bytes.begin(), bytes.end());
    }

    // JSON: the EPSG code and name, the size in pixels, and the upper-left and lower-right corners
    // in map units and in degrees.
    static std::string locate(const std::u16string& bytes) {
        std::istringstream in(std::string(bytes.begin(), bytes.end()));
        XTIFFInitialize();
        Tiff tif(TIFFStreamOpen("input.tif", &in), XTIFFClose);
        if (!tif) throw std::runtime_error("not a TIFF file");
        Keys keys(GTIFNew(tif.get()), GTIFFree);
        GTIFDefn defn;
        if (!keys || !GTIFGetDefn(keys.get(), &defn)) throw std::runtime_error("no coordinate system in the GeoKeys");

        uint32_t width = 0;
        uint32_t height = 0;
        TIFFGetField(tif.get(), TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif.get(), TIFFTAG_IMAGELENGTH, &height);
        double x[2] = {0, static_cast<double>(width)};
        double y[2] = {0, static_cast<double>(height)};
        for (int i = 0; i < 2; i += 1) {
            if (!GTIFImageToPCS(keys.get(), &x[i], &y[i])) throw std::runtime_error("no tiepoint and pixel scale to place the pixels");
        }
        double lon[2] = {x[0], x[1]};
        double lat[2] = {y[0], y[1]};
        if (defn.Model == ModelTypeProjected && !GTIFProj4ToLatLong(&defn, 2, lon, lat)) throw std::runtime_error("PROJ could not unproject the corners");

        const bool projected = defn.Model == ModelTypeProjected;
        char* name = nullptr;
        if (projected) GTIFGetPCSInfo(defn.PCS, &name, nullptr, nullptr, nullptr);
        else GTIFGetGCSInfo(defn.GCS, &name, nullptr, nullptr, nullptr);
        const std::string crs = name ? name : "unnamed";
        GTIFFreeMemory(name);

        char json[640];
        std::snprintf(json, sizeof json,
                      "{\"epsg\":%d,\"name\":\"%s\",\"width\":%u,\"height\":%u,\"upperLeft\":[%.17g,%.17g],\"lowerRight\":[%.17g,%.17g],"
                      "\"upperLeftLonLat\":[%.17g,%.17g],\"lowerRightLonLat\":[%.17g,%.17g]}",
                      projected ? defn.PCS : defn.GCS, crs.c_str(), width, height, x[0], y[0], x[1], y[1], lon[0], lat[0], lon[1], lat[1]);
        return json;
    }

private:
    using Tiff = std::unique_ptr<TIFF, void (*)(TIFF*)>;
    using Keys = std::unique_ptr<GTIF, void (*)(GTIF*)>;
};
