#pragma once

#include <string>

#include "spatial_sql.h"

namespace geopackage {

// What a reader such as GDAL or QGIS finds in a GeoPackage, as JSON: SpatiaLite's metadata check,
// the two header fields that mark the file as a GeoPackage, and every feature layer with its
// geometry type, CRS, feature count, how many geometries are valid GeoPackage binaries, and extent.
inline std::string report(sqlite3* db) {
    const auto header = spatial::prepare(db, "SELECT CheckGeoPackageMetaData(), (SELECT application_id FROM pragma_application_id), (SELECT user_version FROM pragma_user_version)");
    spatial::step(db, header.get());
    std::string out = "{\"check\":" + std::to_string(sqlite3_column_int(header.get(), 0)) +
                      ",\"applicationId\":" + std::to_string(sqlite3_column_int64(header.get(), 1)) +
                      ",\"userVersion\":" + std::to_string(sqlite3_column_int(header.get(), 2)) + ",\"layers\":[";
    const auto layers = spatial::prepare(db,
        "SELECT c.table_name, g.column_name, g.geometry_type_name, s.organization || ':' || s.organization_coordsys_id, "
        "c.min_x, c.min_y, c.max_x, c.max_y FROM gpkg_contents AS c JOIN gpkg_geometry_columns AS g USING (table_name) "
        "JOIN gpkg_spatial_ref_sys AS s ON s.srs_id = c.srs_id WHERE c.data_type = 'features' ORDER BY c.table_name");
    spatial::ResultWriter writer(db);
    for (int index = 0; spatial::step(db, layers.get()); index += 1) {
        const std::string table = spatial::text(layers.get(), 0);
        const auto count = spatial::prepare(db, "SELECT count(*), coalesce(sum(IsValidGPB(" + spatial::identifier(spatial::text(layers.get(), 1)) +
                                                    ")), 0) FROM " + spatial::identifier(table));
        spatial::step(db, count.get());
        out += (index ? ",{" : "{") + std::string("\"name\":") + spatial::quote(table) + ",\"type\":" + spatial::quote(spatial::text(layers.get(), 2)) +
               ",\"crs\":" + spatial::quote(spatial::text(layers.get(), 3)) + ",\"features\":" + std::to_string(sqlite3_column_int(count.get(), 0)) +
               ",\"validGeometries\":" + std::to_string(sqlite3_column_int(count.get(), 1)) + ",\"extent\":[" + writer.cell(layers.get(), 4) + "," +
               writer.cell(layers.get(), 5) + "," + writer.cell(layers.get(), 6) + "," + writer.cell(layers.get(), 7) + "]}";
    }
    return out + "]}";
}

}  // namespace geopackage
