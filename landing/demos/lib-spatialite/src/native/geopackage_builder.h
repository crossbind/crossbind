#pragma once

#include <stdexcept>
#include <string>

#include "../support/geopackage_report.h"
#include "../support/sample_data.h"
#include "../support/spatial_sql.h"

// Writes GeoPackage files, the OGC format QGIS and GDAL open, with SpatiaLite's gpkg* functions: the
// generated points, their count per hexagon, and pins placed on the map, all in WGS 84.
class GeoPackageBuilder {
public:
    // Creates a new GeoPackage at `path` with the layers asked for; `pins` is a JSON array of objects
    // with a name, lon and lat, and an empty array adds no pins layer. Returns inspect(path).
    static std::string build(const std::string& path, bool pois, bool hexbins, const std::string& pins) {
        {
            spatial::Connection connection(path);
            sqlite3* db = connection.get();
            // gpkgCreateBaseTables() writes a GeoPackage 1.0 file: application_id 'GP10' and the base
            // tables. GDAL's validate_gpkg.py rejects two details of SpatiaLite 5.1.0's tables: the
            // undefined reference systems read 'Undefined' instead of 'undefined', and the empty
            // optional metadata and schema tables differ from the specification. The first is
            // corrected, the unused tables are dropped.
            spatial::exec(db, "SELECT gpkgCreateBaseTables()");
            spatial::exec(db, "UPDATE gpkg_spatial_ref_sys SET definition = 'undefined' WHERE srs_id IN (-1, 0)");
            spatial::exec(db, "DROP TABLE gpkg_metadata_reference; DROP TABLE gpkg_metadata; DROP TABLE gpkg_data_column_constraints; DROP TABLE gpkg_data_columns");
            spatial::exec(db, sample::ATTACHED);
            if (pois) {
                layer(db, "pois", "kind TEXT NOT NULL, city TEXT NOT NULL", "POINT", "Generated points of interest");
                spatial::exec(db, "INSERT INTO pois (fid, kind, city, geom) SELECT id, kind, city, AsGPB(geom) FROM sample.pois ORDER BY id");
            }
            if (hexbins) {
                layer(db, "hexbins", "pois INTEGER NOT NULL", "POLYGON", "Generated points per hexagon");
                spatial::exec(db,
                    "INSERT INTO hexbins (fid, pois, geom) SELECT h.id, count(*), AsGPB(h.geom) FROM sample.hexagons AS h "
                    "JOIN sample.pois AS p ON MbrContains(h.geom, p.geom) AND ST_Contains(h.geom, p.geom) GROUP BY h.id ORDER BY h.id");
            }
            if (countPins(db, pins) > 0) {
                layer(db, "pins", "name TEXT NOT NULL", "POINT", "Pins placed on the map");
                const auto insert = spatial::prepare(db,
                    "INSERT INTO pins (name, geom) SELECT json_extract(value, '$.name'), "
                    "gpkgMakePoint(json_extract(value, '$.lon'), json_extract(value, '$.lat'), 4326) FROM json_each(?1)");
                sqlite3_bind_text(insert.get(), 1, pins.c_str(), -1, SQLITE_TRANSIENT);
                spatial::step(db, insert.get());
            }
            spatial::exec(db, "DETACH DATABASE sample");
            extent(db, "pois");
            extent(db, "hexbins");
            extent(db, "pins");
        }
        return inspect(path);
    }

    // Opens a GeoPackage read-only and reports what GDAL or QGIS will find in it (geopackage::report).
    static std::string inspect(const std::string& path) {
        spatial::Connection connection(path, SQLITE_OPEN_READONLY);
        return geopackage::report(connection.get());
    }

private:
    // A feature table registered the GeoPackage way: in gpkg_contents first, then its geometry
    // column, the triggers that keep geometries well formed and the R*Tree spatial index.
    static void layer(sqlite3* db, const std::string& table, const std::string& columns, const std::string& type, const std::string& description) {
        spatial::exec(db, "CREATE TABLE " + table + " (fid INTEGER PRIMARY KEY AUTOINCREMENT, " + columns + ")");
        const auto contents = spatial::prepare(db, "INSERT INTO gpkg_contents (table_name, data_type, identifier, description, srs_id) VALUES (?1, 'features', ?1, ?2, 4326)");
        sqlite3_bind_text(contents.get(), 1, table.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(contents.get(), 2, description.c_str(), -1, SQLITE_TRANSIENT);
        spatial::step(db, contents.get());
        spatial::exec(db, "SELECT gpkgAddGeometryColumn('" + table + "', 'geom', '" + type + "', 0, 0, 4326)");
        spatial::exec(db, "SELECT gpkgAddGeometryTriggers('" + table + "', 'geom')");
        spatial::exec(db, "SELECT gpkgAddSpatialIndex('" + table + "', 'geom')");
    }

    // GDAL and QGIS read a layer's extent from gpkg_contents.
    static void extent(sqlite3* db, const std::string& table) {
        const auto exists = spatial::prepare(db, "SELECT count(*) FROM gpkg_contents WHERE table_name = ?1");
        sqlite3_bind_text(exists.get(), 1, table.c_str(), -1, SQLITE_TRANSIENT);
        if (!spatial::step(db, exists.get()) || sqlite3_column_int(exists.get(), 0) == 0) return;
        spatial::exec(db, "UPDATE gpkg_contents SET (min_x, min_y, max_x, max_y) = (SELECT Min(ST_MinX(g)), Min(ST_MinY(g)), Max(ST_MaxX(g)), Max(ST_MaxY(g)) "
                          "FROM (SELECT GeomFromGPB(geom) AS g FROM " + table + ")) WHERE table_name = '" + table + "'");
    }

    // How many pins the JSON array holds; each one needs a text name and numeric lon and lat.
    static int countPins(sqlite3* db, const std::string& pins) {
        const auto query = spatial::prepare(db,
            "SELECT count(*), sum(json_type(value, '$.name') = 'text' AND json_type(value, '$.lon') IN ('integer', 'real') "
            "AND json_type(value, '$.lat') IN ('integer', 'real')) FROM json_each(?1)");
        sqlite3_bind_text(query.get(), 1, pins.c_str(), -1, SQLITE_TRANSIENT);
        spatial::step(db, query.get());
        const int count = sqlite3_column_int(query.get(), 0);
        if (count > 0 && sqlite3_column_int(query.get(), 1) != count) throw std::invalid_argument("each pin needs a name, a lon and a lat");
        return count;
    }
};
