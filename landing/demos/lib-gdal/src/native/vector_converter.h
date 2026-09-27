#pragma once

#include <cpl_error.h>
#include <cpl_string.h>
#include <cpl_vsi.h>
#include <gdal.h>
#include <gdal_utils.h>
#include <ogr_srs_api.h>
#include <ogrsf_frmts.h>

#include <cmath>
#include <stdexcept>
#include <string>

// Converts GeoJSON text to another vector format, reprojected, and reports what was written.
// It registers only the drivers it uses, so GDAL opens and writes these formats and no others.
class VectorConverter {
public:
    VectorConverter() {
        RegisterOGRGeoJSON();
        RegisterOGRGeoPackage();
        RegisterOGRFlatGeobuf();
        RegisterOGRShape();
    }

    std::string convert(const std::string& geojson, const std::string& format, const std::string& targetCrs,
                        const std::string& outputPath) {
        const char* input = "/vsimem/input.geojson";
        VSIFCloseL(VSIFileFromMemBuffer(input, reinterpret_cast<GByte*>(const_cast<char*>(geojson.data())), geojson.size(), FALSE));
        GDALDatasetH source = GDALOpenEx(input, GDAL_OF_VECTOR, nullptr, nullptr, nullptr);
        if (!source) fail(input);

        CPLStringList args;
        args.AddString("-f");
        args.AddString(format.c_str());
        args.AddString("-t_srs");
        args.AddString(targetCrs.c_str());
        GDALVectorTranslateOptions* options = GDALVectorTranslateOptionsNew(args.List(), nullptr);
        VSIUnlink(outputPath.c_str()); // replace the output of an earlier call
        GDALDatasetH written = GDALVectorTranslate(outputPath.c_str(), nullptr, 1, &source, options, nullptr);
        GDALVectorTranslateOptionsFree(options);
        GDALClose(source);
        if (!written) fail(input);

        OGRLayerH layer = GDALDatasetGetLayer(written, 0);
        OGREnvelope extent;
        OGR_L_GetExtent(layer, &extent, TRUE);
        OGRSpatialReferenceH crs = OGR_L_GetSpatialRef(layer);
        const char* authority = crs ? OSRGetAuthorityName(crs, nullptr) : nullptr;
        const char* code = crs ? OSRGetAuthorityCode(crs, nullptr) : nullptr;
        const std::string summary = format + ": " + std::to_string(OGR_L_GetFeatureCount(layer, TRUE)) + " features, " +
            (authority && code ? std::string(authority) + ":" + code : std::string("no CRS")) + ", extent " +
            std::to_string(std::llround(extent.MinX)) + " " + std::to_string(std::llround(extent.MinY)) + " " +
            std::to_string(std::llround(extent.MaxX)) + " " + std::to_string(std::llround(extent.MaxY));
        GDALClose(written);
        VSIUnlink(input);
        return summary;
    }

private:
    [[noreturn]] static void fail(const char* input) {
        const std::string reason = CPLGetLastErrorMsg();
        VSIUnlink(input);
        throw std::runtime_error(reason.empty() ? "GDAL could not convert the data" : reason);
    }
};
