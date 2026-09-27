#pragma once

#include "../support/drivers.h"
#include "../support/files.h"
#include "../support/json.h"

#include <cpl_conv.h>
#include <cpl_error.h>
#include <cpl_string.h>
#include <cpl_vsi.h>
#include <gdal.h>
#include <gdal_alg.h>
#include <gdal_utils.h>
#include <ogr_api.h>

#include <algorithm>
#include <cmath>
#include <functional>
#include <stdexcept>
#include <string>
#include <vector>

// Pixels to polygons on crossbind.dev/ports/gdal/: a painted mask traced into polygons, holes
// included, by GDALPolygonize, after GDALSieveFilter has removed specks, then simplified and saved
// as a vector file.
class Vectorizer {
public:
    Vectorizer() {
        GDALRegister_MEM();
        registerVectorDrivers();
    }

    // `maskPath` holds `width` x `height` bytes row by row, 0 for background. Regions of fewer than
    // `sieve` pixels merge into their neighbours first; `simplify` is a tolerance in pixels.
    static std::string trace(const std::string& maskPath, int width, int height, int sieve, double simplify) {
        GDALDatasetH shapes = polygons(maskPath, width, height, sieve, simplify);
        OGRLayerH layer = GDALDatasetGetLayer(shapes, 0);
        std::vector<double> areas;
        int holes = 0, vertices = 0;
        OGR_L_ResetReading(layer);
        for (OGRFeatureH feature; (feature = OGR_L_GetNextFeature(layer)) != nullptr; OGR_F_Destroy(feature)) {
            OGRGeometryH polygon = OGR_F_GetGeometryRef(feature);
            areas.push_back(OGR_G_Area(polygon));
            holes += OGR_G_GetGeometryCount(polygon) - 1;
            for (int ring = 0; ring < OGR_G_GetGeometryCount(polygon); ++ring) vertices += OGR_G_GetPointCount(OGR_G_GetGeometryRef(polygon, ring));
        }
        std::sort(areas.begin(), areas.end(), std::greater<double>());
        std::vector<std::string> rounded;
        for (const double area : areas) rounded.push_back(json::number(std::round(area * 10) / 10));
        const std::string geojson = asGeoJson(shapes);
        GDALClose(shapes);
        return json::Object()
            .number("polygons", static_cast<double>(areas.size()))
            .number("holes", holes)
            .number("vertices", vertices)
            .raw("areas", json::array(rounded))
            .raw("geojson", geojson)
            .str();
    }

    // The same polygons written by `format` ("GeoJSON", "GPKG", "ESRI Shapefile", "DXF", ...) to
    // `output`, which lies in a folder of its own; several files come back zipped.
    static std::string save(const std::string& maskPath, int width, int height, int sieve, double simplify, const std::string& format,
                            const std::string& output) {
        GDALDatasetH shapes = polygons(maskPath, width, height, sieve, simplify);
        CPLStringList args;
        args.AddString("-f");
        args.AddString(format.c_str());
        if (format == "DXF") {
            args.AddString("-select");
            args.AddString("");
        }
        GDALVectorTranslateOptions* options = GDALVectorTranslateOptionsNew(args.List(), nullptr);
        GDALDatasetH written = GDALVectorTranslate(output.c_str(), nullptr, 1, &shapes, options, nullptr);
        GDALVectorTranslateOptionsFree(options);
        GDALClose(shapes);
        if (!written) fail("GDAL could not write " + output);
        GDALClose(written);
        return files::package(CPLGetPathSafe(output.c_str()));
    }

private:
    // The polygons of one mask in an in-memory dataset: layer "shapes", field "value" (the pixel value).
    // Pixel (column, row) covers x column..column+1 and y height-row-1..height-row, so y points up
    // as GIS software expects.
    static GDALDatasetH polygons(const std::string& maskPath, int width, int height, int sieve, double simplify) {
        CPLErrorReset();
        std::vector<GByte> pixels(static_cast<size_t>(width) * height);
        VSILFILE* file = VSIFOpenL(maskPath.c_str(), "rb");
        const bool read = file && VSIFReadL(pixels.data(), 1, pixels.size(), file) == pixels.size();
        if (file) VSIFCloseL(file);
        if (!read) fail(maskPath + " does not hold " + std::to_string(pixels.size()) + " bytes");

        GDALDatasetH raster = GDALCreate(GDALGetDriverByName("MEM"), "", width, height, 1, GDT_Byte, nullptr);
        double transform[6] = {0, 1, 0, static_cast<double>(height), 0, -1};
        GDALSetGeoTransform(raster, transform);
        GDALRasterBandH band = GDALGetRasterBand(raster, 1);
        if (GDALRasterIO(band, GF_Write, 0, 0, width, height, pixels.data(), width, height, GDT_Byte, 0, 0) != CE_None) {
            GDALClose(raster);
            fail("GDAL could not take the mask");
        }
        if (sieve > 1) GDALSieveFilter(band, nullptr, band, sieve, 4, nullptr, nullptr, nullptr);

        GDALDatasetH store = GDALCreate(GDALGetDriverByName("MEM"), "", 0, 0, 0, GDT_Unknown, nullptr);
        OGRLayerH layer = GDALDatasetCreateLayer(store, "shapes", nullptr, wkbPolygon, nullptr);
        OGRFieldDefnH field = OGR_Fld_Create("value", OFTInteger);
        OGR_L_CreateField(layer, field, TRUE);
        OGR_Fld_Destroy(field);
        // The band is its own mask, so background pixels (0) make no polygon.
        const CPLErr error = GDALPolygonize(band, band, layer, 0, nullptr, nullptr, nullptr);
        GDALClose(raster);
        if (error != CE_None) {
            GDALClose(store);
            fail("GDAL could not trace the mask");
        }
        if (simplify <= 0) return store;

        // ogr2ogr -simplify: fewer vertices, each polygon kept valid.
        CPLStringList args;
        for (const char* arg : {"-f", "MEM", "-simplify"}) args.AddString(arg);
        args.AddString(json::number(simplify).c_str());
        GDALVectorTranslateOptions* options = GDALVectorTranslateOptionsNew(args.List(), nullptr);
        GDALDatasetH simplified = GDALVectorTranslate("", nullptr, 1, &store, options, nullptr);
        GDALVectorTranslateOptionsFree(options);
        GDALClose(store);
        if (!simplified) fail("GDAL could not simplify the polygons");
        return simplified;
    }

    static std::string asGeoJson(GDALDatasetH shapes) {
        const char* target = "/vsimem/traced.geojson";
        CPLStringList args;
        for (const char* arg : {"-f", "GeoJSON", "-lco", "COORDINATE_PRECISION=3"}) args.AddString(arg);
        GDALVectorTranslateOptions* options = GDALVectorTranslateOptionsNew(args.List(), nullptr);
        VSIUnlink(target);
        GDALDatasetH written = GDALVectorTranslate(target, nullptr, 1, &shapes, options, nullptr);
        GDALVectorTranslateOptionsFree(options);
        if (!written) fail("GDAL could not write GeoJSON");
        GDALClose(written);
        vsi_l_offset length = 0;
        GByte* bytes = VSIGetMemFileBuffer(target, &length, FALSE);
        const std::string text(reinterpret_cast<const char*>(bytes), static_cast<size_t>(length));
        VSIUnlink(target);
        return text;
    }

    [[noreturn]] static void fail(const std::string& fallback) {
        const std::string reason = CPLGetLastErrorMsg();
        throw std::runtime_error(reason.empty() ? fallback : reason);
    }
};
