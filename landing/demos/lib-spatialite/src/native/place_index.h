#pragma once

// spatialite.h uses SQLite's types without including sqlite3.h, so sqlite3.h comes first.
#include <sqlite3.h>
#include <spatialite.h>

#include <memory>
#include <stdexcept>
#include <string>

// Places in a SpatiaLite table with a spatial index: CreateSpatialIndex keeps an R*Tree of every
// geometry's bounding box, and queries reach it through the SpatialIndex and KNN2 virtual tables.
class PlaceIndex {
public:
    PlaceIndex() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        cache = spatialite_alloc_connection();
        spatialite_init_ex(db, cache, 0);
        run("SELECT InitSpatialMetaData(1, 'WGS84')");
        run("CREATE TABLE places (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
        run("SELECT AddGeometryColumn('places', 'geom', 4326, 'POINT', 'XY')");
        run("SELECT CreateSpatialIndex('places', 'geom')");
    }

    ~PlaceIndex() {
        sqlite3_close(db);
        spatialite_cleanup_ex(cache);
    }

    int add(const std::string& name, double lon, double lat) {
        Statement insert = prepare("INSERT INTO places (name, geom) VALUES (?1, MakePoint(?2, ?3, 4326))");
        sqlite3_bind_text(insert.get(), 1, name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_double(insert.get(), 2, lon);
        sqlite3_bind_double(insert.get(), 3, lat);
        if (sqlite3_step(insert.get()) != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
        return static_cast<int>(sqlite3_last_insert_rowid(db));
    }

    // The places inside a longitude/latitude box, by name: the rows the R*Tree finds in the box.
    std::string inView(double west, double south, double east, double north) {
        Statement query = prepare(
            "SELECT name FROM places WHERE ROWID IN (SELECT ROWID FROM SpatialIndex "
            "WHERE f_table_name = 'places' AND search_frame = BuildMbr(?1, ?2, ?3, ?4, 4326)) ORDER BY name");
        sqlite3_bind_double(query.get(), 1, west);
        sqlite3_bind_double(query.get(), 2, south);
        sqlite3_bind_double(query.get(), 3, east);
        sqlite3_bind_double(query.get(), 4, north);
        return lines(query.get());
    }

    // The `count` places nearest to a point, with their distance on the WGS 84 ellipsoid. KNN2 ranks
    // the places inside a square of plus or minus `radius` degrees around the point, so the radius
    // has to reach the farthest of them.
    std::string nearest(double lon, double lat, int count, double radius) {
        Statement query = prepare(
            "SELECT p.name || ' ' || CAST(Round(k.distance_m / 1000) AS INTEGER) || ' km' FROM KNN2 AS k "
            "JOIN places AS p ON p.id = k.fid WHERE k.f_table_name = 'places' "
            "AND k.ref_geometry = MakePoint(?1, ?2, 4326) AND k.radius = ?3 AND k.max_items = ?4 ORDER BY k.pos");
        sqlite3_bind_double(query.get(), 1, lon);
        sqlite3_bind_double(query.get(), 2, lat);
        sqlite3_bind_double(query.get(), 3, radius);
        sqlite3_bind_int(query.get(), 4, count);
        return lines(query.get());
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

    // The first column of every row, joined with commas.
    std::string lines(sqlite3_stmt* statement) {
        std::string joined;
        int result;
        while ((result = sqlite3_step(statement)) == SQLITE_ROW) {
            joined += (joined.empty() ? "" : ", ") + std::string(reinterpret_cast<const char*>(sqlite3_column_text(statement, 0)));
        }
        if (result != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
        return joined;
    }

    sqlite3* db = nullptr;
    void* cache = nullptr;
};
