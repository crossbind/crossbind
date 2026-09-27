#pragma once

#include <cpl_conv.h>
#include <cpl_error.h>
#include <cpl_vsi.h>
#include <gdal.h>
#include <ogr_api.h>
#include <ogrsf_frmts.h>

#include <stdexcept>
#include <string>

// Reads a layer with OGR: its schema, then the features that pass an attribute filter (a SQL WHERE
// clause) inside a rectangle, with their attributes and geometry.
class FeatureQuery {
public:
    FeatureQuery() { RegisterOGRCSV(); }

    // `csv` is text with lon and lat columns, which the CSV driver turns into point geometries.
    std::string select(const std::string& csv, const std::string& where, double west, double south, double east, double north) {
        const char* path = "/vsimem/sensors.csv";
        VSIFCloseL(VSIFileFromMemBuffer(path, reinterpret_cast<GByte*>(const_cast<char*>(csv.data())), csv.size(), FALSE));
        const char* const openOptions[] = {"X_POSSIBLE_NAMES=lon", "Y_POSSIBLE_NAMES=lat", "KEEP_GEOM_COLUMNS=NO", "AUTODETECT_TYPE=YES", nullptr};
        GDALDatasetH dataset = GDALOpenEx(path, GDAL_OF_VECTOR, nullptr, openOptions, nullptr);
        if (!dataset) fail(path);
        OGRLayerH layer = GDALDatasetGetLayer(dataset, 0);
        OGRFeatureDefnH schema = OGR_L_GetLayerDefn(layer);

        std::string text = std::string(OGR_L_GetName(layer)) + ": " + std::to_string(OGR_L_GetFeatureCount(layer, TRUE)) + " features of " +
            OGRGeometryTypeToName(OGR_L_GetGeomType(layer)) + ", fields";
        for (int i = 0; i < OGR_FD_GetFieldCount(schema); ++i) {
            OGRFieldDefnH field = OGR_FD_GetFieldDefn(schema, i);
            text += std::string(i ? ", " : " ") + OGR_Fld_GetNameRef(field) + " " + OGR_GetFieldTypeName(OGR_Fld_GetType(field));
        }

        if (OGR_L_SetAttributeFilter(layer, where.c_str()) != OGRERR_NONE) {
            GDALClose(dataset);
            fail(path);
        }
        OGR_L_SetSpatialFilterRect(layer, west, south, east, north);
        OGR_L_ResetReading(layer);
        for (OGRFeatureH feature; (feature = OGR_L_GetNextFeature(layer)) != nullptr; OGR_F_Destroy(feature)) {
            text += "\n";
            for (int i = 0; i < OGR_F_GetFieldCount(feature); ++i) text += std::string(OGR_F_GetFieldAsString(feature, i)) + " ";
            char* wkt = nullptr;
            OGR_G_ExportToWkt(OGR_F_GetGeometryRef(feature), &wkt);
            text += wkt ? wkt : "";
            CPLFree(wkt);
        }
        GDALClose(dataset);
        VSIUnlink(path);
        return text;
    }

private:
    [[noreturn]] static void fail(const char* path) {
        const std::string reason = CPLGetLastErrorMsg();
        VSIUnlink(path);
        throw std::runtime_error(reason.empty() ? "GDAL could not read the features" : reason);
    }
};
