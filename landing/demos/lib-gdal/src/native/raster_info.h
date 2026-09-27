#pragma once

#include <cpl_error.h>
#include <cpl_string.h>
#include <gdal.h>
#include <gdal_frmts.h>
#include <gdal_utils.h>
#include <ogr_srs_api.h>

#include <cstdio>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Writes a GeoTIFF with a coordinate system, then opens it the way any raster is opened and reads
// what GDAL knows about it: the size, the bands, where the pixels lie (the geotransform) and in which CRS.
class RasterInfo {
public:
    RasterInfo() { GDALRegister_GTiff(); }

    // Elevations in metres that rise by 1 m a pixel to the east and 2 m a pixel to the south.
    void create(const std::string& path, int width, int height, double west, double north, double pixelSize, int epsg) {
        char** options = CSLSetNameValue(nullptr, "COMPRESS", "DEFLATE");
        GDALDatasetH dataset = GDALCreate(GDALGetDriverByName("GTiff"), path.c_str(), width, height, 1, GDT_Float32, options);
        CSLDestroy(options);
        if (!dataset) fail();
        double transform[6] = {west, pixelSize, 0, north, 0, -pixelSize};
        GDALSetGeoTransform(dataset, transform);
        OGRSpatialReferenceH crs = OSRNewSpatialReference(nullptr);
        OSRImportFromEPSG(crs, epsg);
        GDALSetSpatialRef(dataset, crs);
        OSRDestroySpatialReference(crs);
        GDALRasterBandH band = GDALGetRasterBand(dataset, 1);
        std::vector<float> row(width);
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) row[x] = static_cast<float>(100 + x + 2 * y);
            if (GDALRasterIO(band, GF_Write, 0, y, width, 1, row.data(), width, 1, GDT_Float32, 0, 0) != CE_None) {
                GDALClose(dataset);
                fail();
            }
        }
        GDALClose(dataset);
    }

    std::string describe(const std::string& path) {
        GDALDatasetH dataset = GDALOpenEx(path.c_str(), GDAL_OF_RASTER, nullptr, nullptr, nullptr);
        if (!dataset) fail();
        GDALRasterBandH band = GDALGetRasterBand(dataset, 1);
        double t[6];
        GDALGetGeoTransform(dataset, t);
        OGRSpatialReferenceH crs = GDALGetSpatialRef(dataset);
        double range[2];
        GDALComputeRasterMinMax(band, FALSE, range);

        char line[160];
        std::string text = std::string(GDALGetDriverShortName(GDALGetDatasetDriver(dataset))) + ", " +
            std::to_string(GDALGetRasterXSize(dataset)) + " x " + std::to_string(GDALGetRasterYSize(dataset)) + " pixels, " +
            std::to_string(GDALGetRasterCount(dataset)) + " band of " + GDALGetDataTypeName(GDALGetRasterDataType(band)) + "\n";
        std::snprintf(line, sizeof line, "origin %.0f, %.0f; pixel size %.0f x %.0f\n", t[0], t[3], t[1], t[5]);
        text += line;
        text += std::string(OSRGetName(crs)) + ", " + OSRGetAuthorityName(crs, nullptr) + ":" + OSRGetAuthorityCode(crs, nullptr) + "\n";
        std::snprintf(line, sizeof line, "values %.0f to %.0f\n", range[0], range[1]);
        text += line;

        // GDALInfo returns the report the gdalinfo tool prints; keep its corner coordinates.
        char* report = GDALInfo(dataset, nullptr);
        std::istringstream lines(report ? report : "");
        CPLFree(report);
        GDALClose(dataset);
        for (std::string entry; std::getline(lines, entry);) {
            if (entry.rfind("Upper Left", 0) == 0 || entry.rfind("Lower Right", 0) == 0) text += entry + "\n";
        }
        return text.substr(0, text.size() - 1);
    }

private:
    [[noreturn]] static void fail() {
        const std::string reason = CPLGetLastErrorMsg();
        throw std::runtime_error(reason.empty() ? "GDAL could not read the raster" : reason);
    }
};
