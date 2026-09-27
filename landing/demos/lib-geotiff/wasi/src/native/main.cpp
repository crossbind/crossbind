// geotiff-tool: writes a small GeoTIFF, and says where any GeoTIFF is: its size, its coordinate
// system and its corners in map units and in degrees. GTIFGetDefn reads PROJ's proj.db, so the
// commands mount the data folder the build puts next to the .wasm and point PROJ_DATA at it.
#include <geo_normalize.h>
#include <geotiff.h>
#include <geovalues.h>
#include <xtiffio.h>

#include <sys/stat.h>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

using Tiff = std::unique_ptr<TIFF, void (*)(TIFF*)>;
using Keys = std::unique_ptr<GTIF, void (*)(GTIF*)>;

static std::string taken(char* text) {
    const std::string value = text ? text : "unknown";
    GTIFFreeMemory(text);
    return value;
}

// A blank 100 x 100 8-bit image in the projected system `epsg`, upper-left corner at (x, y).
static int write(const char* path, int epsg, double x, double y, double pixel) {
    Tiff tif(XTIFFOpen(path, "w"), XTIFFClose);
    if (!tif) return std::fprintf(stderr, "cannot create %s\n", path), 1;
    const int side = 100;
    TIFFSetField(tif.get(), TIFFTAG_IMAGEWIDTH, side);
    TIFFSetField(tif.get(), TIFFTAG_IMAGELENGTH, side);
    TIFFSetField(tif.get(), TIFFTAG_BITSPERSAMPLE, 8);
    TIFFSetField(tif.get(), TIFFTAG_SAMPLESPERPIXEL, 1);
    TIFFSetField(tif.get(), TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK);
    TIFFSetField(tif.get(), TIFFTAG_ROWSPERSTRIP, side);
    const double tiepoint[6] = {0, 0, 0, x, y, 0};
    const double scale[3] = {pixel, pixel, 0};
    TIFFSetField(tif.get(), TIFFTAG_GEOTIEPOINTS, 6, tiepoint);
    TIFFSetField(tif.get(), TIFFTAG_GEOPIXELSCALE, 3, scale);
    Keys keys(GTIFNew(tif.get()), GTIFFree);
    GTIFKeySet(keys.get(), GTModelTypeGeoKey, TYPE_SHORT, 1, ModelTypeProjected);
    GTIFKeySet(keys.get(), GTRasterTypeGeoKey, TYPE_SHORT, 1, RasterPixelIsArea);
    GTIFKeySet(keys.get(), ProjectedCSTypeGeoKey, TYPE_SHORT, 1, epsg);
    GTIFWriteKeys(keys.get());
    keys.reset();
    std::vector<unsigned char> row(side, 0);
    for (int line = 0; line < side; line += 1) {
        if (TIFFWriteScanline(tif.get(), row.data(), line, 0) < 0) return std::fprintf(stderr, "cannot write %s\n", path), 1;
    }
    tif.reset();
    struct stat info;
    stat(path, &info);
    std::printf("libgeotiff %s write: %s, %d x %d pixels in EPSG:%d, %lld B\n", LIBGEOTIFF_STRING_VERSION, path, side, side, epsg, static_cast<long long>(info.st_size));
    return 0;
}

static int describe(const char* path) {
    Tiff tif(XTIFFOpen(path, "r"), XTIFFClose);
    if (!tif) return std::fprintf(stderr, "%s is not a TIFF file\n", path), 1;
    Keys keys(GTIFNew(tif.get()), GTIFFree);
    GTIFDefn defn;
    if (!keys || !GTIFGetDefn(keys.get(), &defn)) return std::fprintf(stderr, "%s has no GeoTIFF coordinate system\n", path), 1;
    uint32_t width = 0;
    uint32_t height = 0;
    uint16_t bits = 8;
    uint16_t bands = 1;
    TIFFGetField(tif.get(), TIFFTAG_IMAGEWIDTH, &width);
    TIFFGetField(tif.get(), TIFFTAG_IMAGELENGTH, &height);
    TIFFGetFieldDefaulted(tif.get(), TIFFTAG_BITSPERSAMPLE, &bits);
    TIFFGetFieldDefaulted(tif.get(), TIFFTAG_SAMPLESPERPIXEL, &bands);
    std::printf("%s: %u x %u pixels, %u band%s, %u bits per sample\n", path, width, height, bands, bands == 1 ? "" : "s", bits);

    const bool projected = defn.Model == ModelTypeProjected;
    char* name = nullptr;
    if (projected) GTIFGetPCSInfo(defn.PCS, &name, nullptr, nullptr, nullptr);
    else GTIFGetGCSInfo(defn.GCS, &name, nullptr, nullptr, nullptr);
    const std::string crs = taken(name);
    GTIFGetDatumInfo(defn.Datum, &name, nullptr);
    const std::string datum = taken(name);
    std::printf("EPSG:%d %s, datum %s\n", projected ? defn.PCS : defn.GCS, crs.c_str(), datum.c_str());

    const char* labels[2] = {"upper left", "lower right"};
    for (int corner = 0; corner < 2; corner += 1) {
        double x = corner ? width : 0;
        double y = corner ? height : 0;
        if (!GTIFImageToPCS(keys.get(), &x, &y)) return std::fprintf(stderr, "%s has no tiepoint and pixel scale\n", path), 1;
        double lon = x;
        double lat = y;
        if (projected && !GTIFProj4ToLatLong(&defn, 1, &lon, &lat)) return std::fprintf(stderr, "PROJ could not unproject %s\n", labels[corner]), 1;
        std::printf("%s %.3f %.3f = lon %.6f, lat %.6f\n", labels[corner], x, y, lon, lat);
    }
    return 0;
}

int main(int argc, char** argv) {
    const std::string command = argc > 1 ? argv[1] : "";
    if (command == "write" && argc == 7) return write(argv[2], std::atoi(argv[3]), std::atof(argv[4]), std::atof(argv[5]), std::atof(argv[6]));
    if (command == "info" && argc == 3) return describe(argv[2]);
    std::fprintf(stderr, "usage: geotiff-tool write <file.tif> <epsg> <x> <y> <pixel size>\n       geotiff-tool info <file.tif>\n");
    return 2;
}
