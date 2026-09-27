#pragma once

#include <cpl_error.h>
#include <cpl_string.h>
#include <gdal.h>
#include <gdal_alg.h>
#include <gdal_frmts.h>
#include <gdal_utils.h>
#include <ogr_api.h>
#include <ogr_srs_api.h>

#include <algorithm>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

// Terrain products from an elevation model: the gdaldem tool's hillshade and slope, and the contour
// lines gdal_contour draws.
class DemTools {
public:
    DemTools() {
        GDALRegister_GTiff();
        GDALRegister_MEM();
    }

    // A round hill, 900 m at the centre of a 100 m plain, in whole metres.
    void createHill(const std::string& path, int size, double pixelSize) {
        GDALDatasetH dataset = GDALCreate(GDALGetDriverByName("GTiff"), path.c_str(), size, size, 1, GDT_Float32, nullptr);
        if (!dataset) fail();
        double transform[6] = {500000, pixelSize, 0, 4450000, 0, -pixelSize};
        GDALSetGeoTransform(dataset, transform);
        OGRSpatialReferenceH crs = OSRNewSpatialReference(nullptr);
        OSRImportFromEPSG(crs, 32635);
        GDALSetSpatialRef(dataset, crs);
        OSRDestroySpatialReference(crs);
        std::vector<float> row(size);
        const int centre = size / 2;
        for (int y = 0; y < size; ++y) {
            for (int x = 0; x < size; ++x) {
                const int dx = x - centre, dy = y - centre;
                row[x] = static_cast<float>(std::max(100, 900 - (dx * dx + dy * dy) / 4));
            }
            if (GDALRasterIO(GDALGetRasterBand(dataset, 1), GF_Write, 0, y, size, 1, row.data(), size, 1, GDT_Float32, 0, 0) != CE_None) {
                GDALClose(dataset);
                fail();
            }
        }
        GDALClose(dataset);
    }

    // gdaldem <processing>: "hillshade", "slope", "aspect", "roughness", "TRI" or "TPI". With
    // -compute_edges the border pixels get values too.
    std::string derive(const std::string& dem, const std::string& processing, const std::string& output) {
        GDALDatasetH source = open(dem);
        CPLStringList args;
        args.AddString("-compute_edges");
        GDALDEMProcessingOptions* options = GDALDEMProcessingOptionsNew(args.List(), nullptr);
        GDALDatasetH result = GDALDEMProcessing(output.c_str(), source, processing.c_str(), nullptr, options, nullptr);
        GDALDEMProcessingOptionsFree(options);
        GDALClose(source);
        if (!result) fail();
        GDALRasterBandH band = GDALGetRasterBand(result, 1);
        double min = 0, max = 0, mean = 0, deviation = 0;
        GDALComputeRasterStatistics(band, FALSE, &min, &max, &mean, &deviation, nullptr, nullptr);
        const int checksum = GDALChecksumImage(band, 0, 0, GDALGetRasterXSize(result), GDALGetRasterYSize(result));
        GDALClose(result);
        char line[160];
        std::snprintf(line, sizeof line, "%s: %.2f to %.2f, mean %.2f, checksum %d", processing.c_str(), min, max, mean, checksum);
        return line;
    }

    // gdal_contour -i <interval>: the lines go to an in-memory layer, one feature per line.
    std::string contours(const std::string& dem, double interval) {
        GDALDatasetH source = open(dem);
        GDALDatasetH store = GDALCreate(GDALGetDriverByName("MEM"), "", 0, 0, 0, GDT_Unknown, nullptr);
        OGRLayerH layer = GDALDatasetCreateLayer(store, "contours", GDALGetSpatialRef(source), wkbLineString, nullptr);
        OGRFieldDefnH field = OGR_Fld_Create("elevation", OFTReal);
        OGR_L_CreateField(layer, field, TRUE);
        OGR_Fld_Destroy(field);

        char value[32];
        std::snprintf(value, sizeof value, "%g", interval);
        CPLStringList options;
        options.SetNameValue("LEVEL_INTERVAL", value);
        options.SetNameValue("ELEV_FIELD", "0");
        const CPLErr error = GDALContourGenerateEx(GDALGetRasterBand(source, 1), layer, options.List(), nullptr, nullptr);
        GDALClose(source);
        if (error != CE_None) {
            GDALClose(store);
            fail();
        }

        int lines = 0;
        double lowest = 0, highest = 0, length = 0;
        OGR_L_ResetReading(layer);
        for (OGRFeatureH feature; (feature = OGR_L_GetNextFeature(layer)) != nullptr; OGR_F_Destroy(feature)) {
            const double elevation = OGR_F_GetFieldAsDouble(feature, 0);
            lowest = lines ? std::min(lowest, elevation) : elevation;
            highest = lines ? std::max(highest, elevation) : elevation;
            length += OGR_G_Length(OGR_F_GetGeometryRef(feature));
            ++lines;
        }
        GDALClose(store);
        char line[160];
        std::snprintf(line, sizeof line, "contours every %g m: %d lines from %g to %g m, %.1f km long", interval, lines, lowest, highest, length / 1000);
        return line;
    }

private:
    static GDALDatasetH open(const std::string& path) {
        GDALDatasetH dataset = GDALOpenEx(path.c_str(), GDAL_OF_RASTER, nullptr, nullptr, nullptr);
        if (!dataset) fail();
        return dataset;
    }

    [[noreturn]] static void fail() {
        const std::string reason = CPLGetLastErrorMsg();
        throw std::runtime_error(reason.empty() ? "GDAL could not process the elevation model" : reason);
    }
};
