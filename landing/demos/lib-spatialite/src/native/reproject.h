#pragma once

// spatialite.h uses SQLite's types without including sqlite3.h, so sqlite3.h comes first.
#include <sqlite3.h>
#include <spatialite.h>

#include <memory>
#include <stdexcept>
#include <string>

// Coordinates from one EPSG code to another with ST_Transform, which runs PROJ. InitSpatialMetaData(1)
// fills spatial_ref_sys with the 6,559 reference systems SpatiaLite knows; PROJ reads its proj.db for
// how to get from one to the other.
class Reprojector {
public:
    Reprojector() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        cache = spatialite_alloc_connection();
        spatialite_init_ex(db, cache, 0);
        char* message = nullptr;
        if (sqlite3_exec(db, "SELECT InitSpatialMetaData(1)", nullptr, nullptr, &message) == SQLITE_OK) return;
        const std::string reason = message ? message : sqlite3_errmsg(db);
        sqlite3_free(message);
        throw std::runtime_error(reason);
    }

    ~Reprojector() {
        sqlite3_close(db);
        spatialite_cleanup_ex(cache);
    }

    std::string transform(const std::string& wkt, int from, int to) {
        Statement query = prepare("SELECT AsText(ST_Transform(GeomFromText(?1, ?2), ?3))");
        sqlite3_bind_text(query.get(), 1, wkt.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(query.get(), 2, from);
        sqlite3_bind_int(query.get(), 3, to);
        return text(query.get(), "cannot transform: check the WKT and both EPSG codes");
    }

    std::string srsName(int srid) {
        Statement query = prepare("SELECT ref_sys_name FROM spatial_ref_sys WHERE srid = ?1");
        sqlite3_bind_int(query.get(), 1, srid);
        return text(query.get(), "unknown EPSG code");
    }

private:
    using Statement = std::unique_ptr<sqlite3_stmt, int (*)(sqlite3_stmt*)>;

    Statement prepare(const char* sql) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
        return Statement(statement, sqlite3_finalize);
    }

    // The first column of the only row; no row, or NULL, becomes `missing` as an exception.
    std::string text(sqlite3_stmt* statement, const char* missing) {
        const int result = sqlite3_step(statement);
        if (result != SQLITE_ROW && result != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
        const unsigned char* value = result == SQLITE_ROW ? sqlite3_column_text(statement, 0) : nullptr;
        if (!value) throw std::invalid_argument(missing);
        return reinterpret_cast<const char*>(value);
    }

    sqlite3* db = nullptr;
    void* cache = nullptr;
};
