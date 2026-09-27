#pragma once

// spatialite.h uses SQLite's types without including sqlite3.h, so sqlite3.h comes first.
#include <sqlite3.h>
#include <spatialite.h>

#include <memory>
#include <stdexcept>
#include <string>

// Measurements of shapes written as WKT in longitude and latitude (EPSG:4326). SpatiaLite measures
// in the units of the coordinates, so the planar methods first transform the shape to the CRS they
// are given: a projected one such as UTM measures in metres.
class Measure {
public:
    Measure() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        cache = spatialite_alloc_connection();
        spatialite_init_ex(db, cache, 0);
        char* message = nullptr;
        if (sqlite3_exec(db, "SELECT InitSpatialMetaData(1, 'WGS84')", nullptr, nullptr, &message) == SQLITE_OK) return;
        const std::string reason = message ? message : sqlite3_errmsg(db);
        sqlite3_free(message);
        throw std::runtime_error(reason);
    }

    ~Measure() {
        sqlite3_close(db);
        spatialite_cleanup_ex(cache);
    }

    double area(const std::string& wkt, int srid) {
        Statement query = prepare("SELECT ST_Area(ST_Transform(GeomFromText(?1, 4326), ?2))");
        sqlite3_bind_text(query.get(), 1, wkt.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(query.get(), 2, srid);
        return number(query.get());
    }

    double distance(const std::string& a, const std::string& b, int srid) {
        Statement query = prepare("SELECT ST_Distance(ST_Transform(GeomFromText(?1, 4326), ?3), ST_Transform(GeomFromText(?2, 4326), ?3))");
        sqlite3_bind_text(query.get(), 1, a.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(query.get(), 2, b.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(query.get(), 3, srid);
        return number(query.get());
    }

    // On the WGS 84 ellipsoid, in metres, with no projection in between.
    double geodesicDistance(const std::string& a, const std::string& b) {
        Statement query = prepare("SELECT ST_Distance(GeomFromText(?1, 4326), GeomFromText(?2, 4326), 1)");
        sqlite3_bind_text(query.get(), 1, a.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(query.get(), 2, b.c_str(), -1, SQLITE_TRANSIENT);
        return number(query.get());
    }

private:
    using Statement = std::unique_ptr<sqlite3_stmt, int (*)(sqlite3_stmt*)>;

    Statement prepare(const char* sql) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
        return Statement(statement, sqlite3_finalize);
    }

    // SpatiaLite answers NULL, not an error, for WKT it cannot read or an SRID it does not know.
    double number(sqlite3_stmt* statement) {
        if (sqlite3_step(statement) != SQLITE_ROW) throw std::runtime_error(sqlite3_errmsg(db));
        if (sqlite3_column_type(statement, 0) == SQLITE_NULL) throw std::invalid_argument("cannot measure: check the WKT and the SRID");
        return sqlite3_column_double(statement, 0);
    }

    sqlite3* db = nullptr;
    void* cache = nullptr;
};
