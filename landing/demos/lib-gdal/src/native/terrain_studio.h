#pragma once

#include "../support/drivers.h"
#include "../support/json.h"
#include "../support/terrain.h"

#include <cpl_conv.h>
#include <cpl_error.h>
#include <cpl_string.h>
#include <cpl_vsi.h>
#include <gdal.h>
#include <gdal_alg.h>
#include <gdal_utils.h>
#include <ogr_api.h>
#include <ogr_srs_api.h>

#include <stdexcept>
#include <string>
#include <vector>

// The terrain studio on crossbind.dev/ports/gdal/: a generated elevation model and what gdaldem,
// gdal_contour and gdal_viewshed make of it, drawn for a canvas.
class TerrainStudio {
public:
    TerrainStudio() {
        registerRasterDrivers();
        RegisterOGRGeoJSON();
    }

    // A landscape of `size` x `size` pixels of 30 m from `seed`, written as a GeoTIFF in UTM zone 35N.
    static std::string create(const std::string& path, int size, int seed) {
        CPLErrorReset();
        char** options = CSLSetNameValue(nullptr, "COMPRESS", "DEFLATE");
        GDALDatasetH dataset = GDALCreate(GDALGetDriverByName("GTiff"), path.c_str(), size, size, 1, GDT_Float32, options);
        CSLDestroy(options);
        if (!dataset) fail("GDAL could not create " + path);
        double transform[6] = {500000, 30, 0, 4450000, 0, -30};
        GDALSetGeoTransform(dataset, transform);
        OGRSpatialReferenceH crs = OSRNewSpatialReference(nullptr);
        OSRImportFromEPSG(crs, 32635);
        GDALSetSpatialRef(dataset, crs);
        OSRDestroySpatialReference(crs);
        GDALRasterBandH band = GDALGetRasterBand(dataset, 1);
        std::vector<float> row(size);
        for (int y = 0; y < size; ++y) {
            for (int x = 0; x < size; ++x) row[x] = terrain::elevation(x, y, size, static_cast<std::uint32_t>(seed));
            if (GDALRasterIO(band, GF_Write, 0, y, size, 1, row.data(), size, 1, GDT_Float32, 0, 0) != CE_None) {
                GDALClose(dataset);
                fail("GDAL could not write " + path);
            }
        }
        double min = 0, max = 0, mean = 0, deviation = 0;
        GDALComputeRasterStatistics(band, FALSE, &min, &max, &mean, &deviation, nullptr, nullptr);
        GDALClose(dataset);
        std::vector<std::string> geoTransform;
        for (const double value : transform) geoTransform.push_back(json::number(value));
        return json::Object().number("size", size).raw("geoTransform", json::array(geoTransform)).number("min", min).number("max", max).number("mean", mean).str();
    }

    // `product` as RGBA bytes in `target`, shaded by a hillshade lit from `azimuth` degrees:
    // "hillshade", "relief" (colour by height), "slope", "aspect", "roughness" or "TPI".
    static std::string render(const std::string& dem, const std::string& product, double azimuth, const std::string& target) {
        GDALDatasetH source = open(dem);
        GDALDatasetH shade = process(source, "hillshade", nullptr, {"-az", std::to_string(azimuth), "-alt", "45"});
        GDALDatasetH values = product == "relief" || product == "hillshade" ? nullptr : process(source, product.c_str(), nullptr, {});
        GDALDatasetH coloured = product == "hillshade" ? nullptr : colour(product == "relief" ? source : values, product);

        const int width = GDALGetRasterXSize(source), height = GDALGetRasterYSize(source);
        std::vector<GByte> light(static_cast<size_t>(width) * height), rgba(static_cast<size_t>(width) * height * 4);
        const bool lit = GDALRasterIO(GDALGetRasterBand(shade, 1), GF_Read, 0, 0, width, height, light.data(), width, height, GDT_Byte, 0, 0) == CE_None;
        const bool painted = !coloured || GDALDatasetRasterIO(coloured, GF_Read, 0, 0, width, height, rgba.data(), width, height, GDT_Byte, 4, nullptr, 4, 4 * width, 1) == CE_None;
        if (!lit || !painted) fail("GDAL could not read the " + product);
        // Colour times light: relief strongly, the measured products lightly, so their colours stay readable.
        const int ambient = product == "relief" ? 64 : 150;
        for (size_t i = 0; i < light.size(); ++i) {
            const int level = ambient + light[i] * (255 - ambient) / 255;
            for (int c = 0; c < 3; ++c) rgba[i * 4 + c] = static_cast<GByte>(coloured ? rgba[i * 4 + c] * level / 255 : light[i]);
            rgba[i * 4 + 3] = 255;
        }
        write(target, rgba);

        GDALDatasetH measured = values ? values : (product == "relief" ? source : shade);
        double range[2] = {0, 0};
        GDALComputeRasterMinMax(GDALGetRasterBand(measured, 1), FALSE, range);
        const int checksum = GDALChecksumImage(GDALGetRasterBand(measured, 1), 0, 0, width, height);
        for (GDALDatasetH dataset : {coloured, values, shade, source}) {
            if (dataset) GDALClose(dataset);
        }
        return json::Object().text("product", product).number("width", width).number("height", height).number("min", range[0]).number("max", range[1]).number("checksum", checksum).str();
    }

    // gdal_contour -i `interval`: GeoJSON lines with an elevation property, in the model's coordinates.
    static std::string contours(const std::string& dem, double interval) {
        GDALDatasetH source = open(dem);
        const char* target = "/vsimem/contours.geojson";
        VSIUnlink(target);
        GDALDatasetH store = GDALCreate(GDALGetDriverByName("GeoJSON"), target, 0, 0, 0, GDT_Unknown, nullptr);
        char** layerOptions = CSLSetNameValue(nullptr, "COORDINATE_PRECISION", "1");
        OGRLayerH layer = GDALDatasetCreateLayer(store, "contours", GDALGetSpatialRef(source), wkbLineString, layerOptions);
        CSLDestroy(layerOptions);
        OGRFieldDefnH field = OGR_Fld_Create("elevation", OFTReal);
        OGR_L_CreateField(layer, field, TRUE);
        OGR_Fld_Destroy(field);
        CPLStringList options;
        options.SetNameValue("LEVEL_INTERVAL", json::number(interval).c_str());
        options.SetNameValue("ELEV_FIELD", "0");
        const CPLErr error = GDALContourGenerateEx(GDALGetRasterBand(source, 1), layer, options.List(), nullptr, nullptr);
        GDALClose(store);
        GDALClose(source);
        if (error != CE_None) fail("GDAL could not draw contours");
        return take(target);
    }

    // gdal_viewshed from the centre of pixel (column, row), `height` metres above the ground, with the
    // Earth's curvature and refraction. Writes one byte per pixel to `target`, 255 where the ground is seen.
    static std::string viewshed(const std::string& dem, int column, int row, double height, const std::string& target) {
        GDALDatasetH source = open(dem);
        double t[6];
        GDALGetGeoTransform(source, t);
        const double x = t[0] + (column + 0.5) * t[1], y = t[3] + (row + 0.5) * t[5];
        GDALDatasetH seen = GDALViewshedGenerate(GDALGetRasterBand(source, 1), "MEM", "", nullptr, x, y, height, 0, 255, 0, 0, -1, 0.85714,
                                                 GVM_Edge, 0, nullptr, nullptr, GVOT_NORMAL, nullptr);
        if (!seen) {
            GDALClose(source);
            fail("GDAL could not compute the viewshed");
        }
        const int width = GDALGetRasterXSize(seen), rows = GDALGetRasterYSize(seen);
        std::vector<GByte> mask(static_cast<size_t>(width) * rows);
        if (GDALRasterIO(GDALGetRasterBand(seen, 1), GF_Read, 0, 0, width, rows, mask.data(), width, rows, GDT_Byte, 0, 0) != CE_None) fail("GDAL could not read the viewshed");
        const int checksum = GDALChecksumImage(GDALGetRasterBand(seen, 1), 0, 0, width, rows);
        GDALClose(seen);
        GDALClose(source);
        write(target, mask);
        size_t visible = 0;
        for (const GByte value : mask) visible += value == 255;
        return json::Object().number("visible", static_cast<double>(visible)).number("cells", static_cast<double>(mask.size())).number("x", x).number("y", y).number("checksum", checksum).str();
    }

    // The model or one product as a GeoTIFF at `target`, for other GIS software.
    static std::string save(const std::string& dem, const std::string& product, const std::string& target) {
        GDALDatasetH source = open(dem);
        VSIUnlink(target.c_str());
        GDALDatasetH saved = nullptr;
        if (product == "dem") {
            saved = GDALCreateCopy(GDALGetDriverByName("GTiff"), target.c_str(), source, FALSE, nullptr, nullptr, nullptr);
        } else {
            GDALDatasetH values = product == "relief" ? colour(source, product) : process(source, product.c_str(), nullptr, {});
            saved = GDALCreateCopy(GDALGetDriverByName("GTiff"), target.c_str(), values, FALSE, nullptr, nullptr, nullptr);
            GDALClose(values);
        }
        GDALClose(source);
        if (!saved) fail("GDAL could not write " + target);
        GDALClose(saved);
        VSIStatBufL stat;
        if (VSIStatL(target.c_str(), &stat) != 0) fail("GDAL wrote no " + target);
        return json::Object().text("download", target).number("bytes", static_cast<double>(stat.st_size)).str();
    }

private:
    static GDALDatasetH open(const std::string& path) {
        CPLErrorReset();
        GDALDatasetH dataset = GDALOpenEx(path.c_str(), GDAL_OF_RASTER, nullptr, nullptr, nullptr);
        if (!dataset) fail("GDAL could not open " + path);
        return dataset;
    }

    // gdaldem <processing> into memory, with -compute_edges so the border pixels get values too.
    static GDALDatasetH process(GDALDatasetH source, const char* processing, const char* colours, std::vector<std::string> extra) {
        CPLStringList args;
        for (const char* arg : {"-of", "MEM", "-compute_edges"}) args.AddString(arg);
        for (const std::string& arg : extra) args.AddString(arg.c_str());
        GDALDEMProcessingOptions* options = GDALDEMProcessingOptionsNew(args.List(), nullptr);
        GDALDatasetH result = GDALDEMProcessing("", source, processing, colours, options, nullptr);
        GDALDEMProcessingOptionsFree(options);
        if (!result) fail(std::string("gdaldem ") + processing + " failed");
        return result;
    }

    // gdaldem color-relief with the product's colour table and an alpha band.
    static GDALDatasetH colour(GDALDatasetH values, const std::string& product) {
        const std::string table = product == "relief" ? terrain::reliefColours()
            : product == "slope"                      ? terrain::slopeColours()
            : product == "aspect"                     ? terrain::aspectColours()
            : product == "TPI"                        ? terrain::tpiColours()
                                                      : terrain::roughnessColours();
        const char* path = "/vsimem/colours.txt";
        VSILFILE* file = VSIFOpenL(path, "wb");
        VSIFWriteL(table.data(), 1, table.size(), file);
        VSIFCloseL(file);
        return process(values, "color-relief", path, {"-alpha"});
    }

    static void write(const std::string& path, const std::vector<GByte>& bytes) {
        VSIUnlink(path.c_str());
        VSILFILE* file = VSIFOpenL(path.c_str(), "wb");
        if (!file || VSIFWriteL(bytes.data(), 1, bytes.size(), file) != bytes.size()) fail("could not write " + path);
        VSIFCloseL(file);
    }

    static std::string take(const char* path) {
        vsi_l_offset length = 0;
        GByte* bytes = VSIGetMemFileBuffer(path, &length, FALSE);
        const std::string text(reinterpret_cast<const char*>(bytes), static_cast<size_t>(length));
        VSIUnlink(path);
        return text;
    }

    [[noreturn]] static void fail(const std::string& fallback) {
        const std::string reason = CPLGetLastErrorMsg();
        throw std::runtime_error(reason.empty() ? fallback : reason);
    }
};
