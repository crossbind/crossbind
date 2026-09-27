#pragma once

#include <cpl_error.h>
#include <cpl_vsi.h>
#include <gdal.h>
#include <ogr_api.h>
#include <ogr_srs_api.h>

#include <initializer_list>
#include <stdexcept>
#include <string>
#include <utility>

// The converter's sample: a GeoPackage in WGS 84 with three layers. `cities` holds eight city
// centres (rounded to four decimals) with their vehicle registration code, `links` straight lines
// between some of them, and `regions` two polygons, each the convex hull of four cities.
namespace sample {

struct City {
    const char* name;
    int plate;
    double lon, lat;
};

constexpr City kCities[] = {
    {"Istanbul", 34, 28.9784, 41.0082}, {"Ankara", 6, 32.8597, 39.9334}, {"Izmir", 35, 27.1428, 38.4237},
    {"Bursa", 16, 29.0610, 40.1885},    {"Antalya", 7, 30.7133, 36.8969}, {"Konya", 42, 32.4846, 37.8746},
    {"Adana", 1, 35.3213, 37.0000},     {"Trabzon", 61, 39.7168, 41.0027},
};
constexpr int kLinks[][2] = {{0, 1}, {0, 3}, {3, 2}, {2, 4}, {4, 5}, {5, 1}, {1, 6}, {1, 7}};
constexpr int kRegions[][4] = {{0, 2, 3, 4}, {1, 5, 6, 7}};
constexpr const char* kRegionNames[] = {"west", "east"};

inline OGRLayerH layer(GDALDatasetH dataset, const char* name, OGRSpatialReferenceH crs, OGRwkbGeometryType type,
                       std::initializer_list<std::pair<const char*, OGRFieldType>> fields) {
    OGRLayerH created = GDALDatasetCreateLayer(dataset, name, crs, type, nullptr);
    if (!created) throw std::runtime_error(CPLGetLastErrorMsg());
    for (const auto& [fieldName, fieldType] : fields) {
        OGRFieldDefnH field = OGR_Fld_Create(fieldName, fieldType);
        OGR_L_CreateField(created, field, TRUE);
        OGR_Fld_Destroy(field);
    }
    return created;
}

inline void add(OGRLayerH target, OGRGeometryH geometry, const char* text, const char* secondText, int number) {
    OGRFeatureH feature = OGR_F_Create(OGR_L_GetLayerDefn(target));
    OGR_F_SetFieldString(feature, 0, text);
    if (secondText) OGR_F_SetFieldString(feature, 1, secondText);
    else OGR_F_SetFieldInteger(feature, 1, number);
    OGR_F_SetGeometryDirectly(feature, geometry);
    const OGRErr error = OGR_L_CreateFeature(target, feature);
    OGR_F_Destroy(feature);
    if (error != OGRERR_NONE) throw std::runtime_error(CPLGetLastErrorMsg());
}

inline OGRGeometryH point(const City& city) {
    OGRGeometryH geometry = OGR_G_CreateGeometry(wkbPoint);
    OGR_G_SetPoint_2D(geometry, 0, city.lon, city.lat);
    return geometry;
}

inline void write(const std::string& path) {
    VSIUnlink(path.c_str());
    GDALDatasetH dataset = GDALCreate(GDALGetDriverByName("GPKG"), path.c_str(), 0, 0, 0, GDT_Unknown, nullptr);
    if (!dataset) throw std::runtime_error(CPLGetLastErrorMsg());
    OGRSpatialReferenceH wgs84 = OSRNewSpatialReference(nullptr);
    OSRImportFromEPSG(wgs84, 4326);
    OSRSetAxisMappingStrategy(wgs84, OAMS_TRADITIONAL_GIS_ORDER);

    OGRLayerH cities = layer(dataset, "cities", wgs84, wkbPoint, {{"name", OFTString}, {"plate", OFTInteger}});
    for (const City& city : kCities) add(cities, point(city), city.name, nullptr, city.plate);

    OGRLayerH links = layer(dataset, "links", wgs84, wkbLineString, {{"origin", OFTString}, {"destination", OFTString}});
    for (const auto& link : kLinks) {
        OGRGeometryH line = OGR_G_CreateGeometry(wkbLineString);
        for (const int end : link) OGR_G_AddPoint_2D(line, kCities[end].lon, kCities[end].lat);
        add(links, line, kCities[link[0]].name, kCities[link[1]].name, 0);
    }

    OGRLayerH regions = layer(dataset, "regions", wgs84, wkbPolygon, {{"name", OFTString}, {"cities", OFTInteger}});
    for (int region = 0; region < 2; ++region) {
        OGRGeometryH members = OGR_G_CreateGeometry(wkbMultiPoint);
        for (const int city : kRegions[region]) OGR_G_AddGeometryDirectly(members, point(kCities[city]));
        OGRGeometryH hull = OGR_G_ConvexHull(members);
        OGR_G_DestroyGeometry(members);
        add(regions, hull, kRegionNames[region], nullptr, 4);
    }

    OSRDestroySpatialReference(wgs84);
    GDALClose(dataset);
}

}  // namespace sample
