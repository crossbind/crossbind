#pragma once

// spatialite.h uses SQLite's types without including sqlite3.h, so sqlite3.h comes first.
#include <sqlite3.h>
#include <spatialite.h>

#include <memory>
#include <stdexcept>
#include <string>

// Features that arrive as GeoJSON geometries, stored as SpatiaLite geometries and read back as one
// GeoJSON FeatureCollection, the shape web map libraries load.
class GeoJsonLayer {
public:
    GeoJsonLayer() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        cache = spatialite_alloc_connection();
        spatialite_init_ex(db, cache, 0);
        run("SELECT InitSpatialMetaData(1, 'WGS84')");
        run("CREATE TABLE features (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
        run("SELECT AddGeometryColumn('features', 'geom', 4326, 'GEOMETRY', 'XY')");
    }

    ~GeoJsonLayer() {
        sqlite3_close(db);
        spatialite_cleanup_ex(cache);
    }

    // GeomFromGeoJSON returns NULL for text that is not a GeoJSON geometry, so nothing is inserted
    // then and the call throws. GeoJSON is longitude and latitude, EPSG:4326.
    int add(const std::string& name, const std::string& geometry) {
        Statement insert = prepare(
            "INSERT INTO features (name, geom) SELECT ?1, shape FROM "
            "(SELECT SetSRID(GeomFromGeoJSON(?2), 4326) AS shape) WHERE shape IS NOT NULL");
        sqlite3_bind_text(insert.get(), 1, name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(insert.get(), 2, geometry.c_str(), -1, SQLITE_TRANSIENT);
        if (sqlite3_step(insert.get()) != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
        if (sqlite3_changes(db) == 0) throw std::invalid_argument("not a GeoJSON geometry: " + name);
        return static_cast<int>(sqlite3_last_insert_rowid(db));
    }

    // Every feature in insertion order, coordinates rounded to `decimals`; SQLite's JSON functions
    // build the collection around the geometries AsGeoJSON writes.
    std::string featureCollection(int decimals) {
        Statement query = prepare(
            "SELECT json_object('type', 'FeatureCollection', 'features', json_group_array(json_object("
            "'type', 'Feature', 'properties', json_object('name', name), 'geometry', json(AsGeoJSON(geom, ?1))))) "
            "FROM (SELECT name, geom FROM features ORDER BY id)");
        sqlite3_bind_int(query.get(), 1, decimals);
        if (sqlite3_step(query.get()) != SQLITE_ROW) throw std::runtime_error(sqlite3_errmsg(db));
        return reinterpret_cast<const char*>(sqlite3_column_text(query.get(), 0));
    }

private:
    using Statement = std::unique_ptr<sqlite3_stmt, int (*)(sqlite3_stmt*)>;

    Statement prepare(const char* sql) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
        return Statement(statement, sqlite3_finalize);
    }

    void run(const char* sql) {
        char* message = nullptr;
        if (sqlite3_exec(db, sql, nullptr, nullptr, &message) == SQLITE_OK) return;
        const std::string reason = message ? message : sqlite3_errmsg(db);
        sqlite3_free(message);
        throw std::runtime_error(reason);
    }

    sqlite3* db = nullptr;
    void* cache = nullptr;
};
